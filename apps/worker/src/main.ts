import { hostname } from 'node:os'
import { createOpenRouterClient } from '@atd/ai'
import { loadEnv, workerEnvSchema } from '@atd/config'
import { keyFromBase64 } from '@atd/core'
import { createBoss, createDb, ensureQueues, QUEUES, type DeliverJob, type IngestJob, type ProcessJob } from '@atd/db'
import { createWhatsAppClient } from '@atd/whatsapp'
import { CONCORRENCIA, POOL_DRIZZLE_WORKER } from './concorrencia.ts'
import { entregarRespostaHumana } from './jobs/deliver.ts'
import { ingestDocument } from './jobs/ingest-document.ts'
import { processConversation, type ProcessDeps } from './jobs/process-conversation.ts'
import { startHeartbeat } from './heartbeat.ts'
import { sanitizeJobError } from './job-error.ts'
import { createLogger } from './logger.ts'
import { initSentry, Sentry } from './sentry.ts'
import { createStorage } from './storage.ts'

const VERSION = process.env.APP_VERSION ?? 'dev'
const env = loadEnv(workerEnvSchema)
const log = createLogger(env.LOG_LEVEL)
if (env.OPENROUTER_DEV_SEM_ZDR) log.warn('OPENROUTER_DEV_SEM_ZDR=1: chamadas à IA SEM ZDR (só desenvolvimento local, dados inventados)')
initSentry(env.SENTRY_DSN, VERSION)

// Session pooler (IPv4) ou conexão direta: processo de longa duração com prepared statements (o modo
// transaction não os suporta). O pg-boss 12 não usa LISTEN/NOTIFY por padrão (só polling + advisory
// xact locks), então isso não exige sessão. Pools: drizzle 9 (4 process + 2 deliver + 1 ingest + heartbeat
// + folga; ver concorrencia.ts) + pg-boss 3 = 12 conexões no máximo.
const { db, sql } = createDb(env.DATABASE_URL, { max: POOL_DRIZZLE_WORKER })
const boss = createBoss(env.DATABASE_URL, 'worker', (err) => {
  log.error({ err }, 'pg-boss erro')
  Sentry.captureException(err)
})

let heartbeat: ReturnType<typeof startHeartbeat> | undefined
try {
  await boss.start()
  await ensureQueues(boss)

  const llm = createOpenRouterClient({
    apiKey: env.OPENROUTER_API_KEY,
    appTitle: 'ia-atendimento',
    ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
    ...(env.OPENROUTER_DEV_SEM_ZDR ? { semZdrDev: true } : {}),
  })
  // chave de serviço só aqui (processo do worker); nunca em log
  const storage = createStorage({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
  const deps: ProcessDeps = {
    db,
    llm,
    storage,
    wa: createWhatsAppClient({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      graphVersion: env.WHATSAPP_GRAPH_VERSION,
    }),
    phoneKey: keyFromBase64(env.PHONE_ENC_KEY),
    triageModels: env.AI_TRIAGE_MODELS,
    log,
    requeue: (conversationId) =>
      boss.send(QUEUES.process, { conversationId } satisfies ProcessJob, { singletonKey: conversationId, startAfter: 1 }),
  }

  await boss.work<ProcessJob>(QUEUES.process, { localConcurrency: CONCORRENCIA.process }, async (jobs) => {
    for (const job of jobs) {
      try {
        const outcome = await processConversation(deps, job.data.conversationId)
        log.info({ conversationId: job.data.conversationId, outcome }, 'conversa processada')
      } catch (err) {
        log.error({ err, conversationId: job.data.conversationId }, 'falha ao processar conversa')
        Sentry.captureException(err, { extra: { conversationId: job.data.conversationId } })
        // pg-boss retenta (retryLimit 3, backoff) e depois manda para a DLQ; o erro lançado vai para
        // pgboss.job.output, então nunca o erro bruto (params do drizzle com dados do cliente).
        throw sanitizeJobError(err)
      }
    }
  })

  // resposta do atendente (painel): a action grava a mensagem `pendente` e enfileira; a entrega é a mesma da IA
  // na última tentativa, a resposta que não saiu vira `falhou:temporaria` ("Tentar de novo" no painel) em vez de ir à DLQ
  const opcoesDeliver = { localConcurrency: CONCORRENCIA.deliver, includeMetadata: true } as const
  await boss.work<DeliverJob, unknown, typeof opcoesDeliver>(QUEUES.deliver, opcoesDeliver, async (jobs) => {
    for (const job of jobs) {
      try {
        const outcome = await entregarRespostaHumana(deps, job.data.conversationId, { ultimaTentativa: job.retryCount >= job.retryLimit })
        log.info({ conversationId: job.data.conversationId, outcome }, 'entrega processada')
      } catch (err) {
        log.error({ err, conversationId: job.data.conversationId }, 'falha ao entregar mensagens da conversa')
        Sentry.captureException(err, { extra: { conversationId: job.data.conversationId } })
        throw sanitizeJobError(err)
      }
    }
  })

  if (!env.AI_INGEST_MODELS) log.warn('AI_INGEST_MODELS vazio: importação de cardápio por IA desligada (só CSV)')
  await boss.work<IngestJob>(QUEUES.ingest, { localConcurrency: CONCORRENCIA.ingest }, async (jobs) => {
    for (const job of jobs) {
      try {
        const outcome = await ingestDocument({ db, llm, storage, ingestModels: env.AI_INGEST_MODELS, log }, job.data.importacaoId)
        log.info({ importacaoId: job.data.importacaoId, outcome }, 'importação processada')
      } catch (err) {
        // só falha antes de marcar `processando` chega aqui (depois disso o job grava `erro` e não lança)
        log.error({ err, importacaoId: job.data.importacaoId }, 'falha ao processar importação')
        Sentry.captureException(err, { extra: { importacaoId: job.data.importacaoId } })
        throw sanitizeJobError(err)
      }
    }
  })

  heartbeat = startHeartbeat(db, `${hostname()}-${process.pid}`, VERSION)
  await heartbeat.beat()
  log.info({ version: VERSION }, 'worker iniciado')
} catch (err) {
  log.error({ err }, 'falha ao iniciar o worker')
  Sentry.captureException(err)
  await Sentry.flush(2_000).catch(() => undefined)
  process.exit(1)
}

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  try {
    log.info({ signal }, 'encerrando: aguardando jobs em andamento')
    heartbeat?.stop()
    await boss.stop({ graceful: true, timeout: 30_000 })
    await sql.end({ timeout: 5 })
    await Sentry.flush(2_000)
    process.exit(0)
  } catch (err) {
    log.error({ err }, 'falha ao encerrar o worker')
    Sentry.captureException(err)
    process.exit(1)
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
