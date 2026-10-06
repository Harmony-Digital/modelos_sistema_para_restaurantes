import { hostname } from 'node:os'
import { createOpenRouterClient } from '@atd/ai'
import { loadEnv, workerEnvSchema } from '@atd/config'
import { keyFromBase64 } from '@atd/core'
import { createBoss, createDb, ensureQueues, QUEUES, type ProcessJob } from '@atd/db'
import { createWhatsAppClient } from '@atd/whatsapp'
import { processConversation, type ProcessDeps } from './jobs/process-conversation.ts'
import { startHeartbeat } from './heartbeat.ts'
import { sanitizeJobError } from './job-error.ts'
import { createLogger } from './logger.ts'
import { initSentry, Sentry } from './sentry.ts'

const VERSION = process.env.APP_VERSION ?? 'dev'
const env = loadEnv(workerEnvSchema)
const log = createLogger(env.LOG_LEVEL)
if (env.OPENROUTER_DEV_SEM_ZDR) log.warn('OPENROUTER_DEV_SEM_ZDR=1: chamadas à IA SEM ZDR (só desenvolvimento local, dados inventados)')
initSentry(env.SENTRY_DSN, VERSION)

// Session pooler (IPv4) ou conexão direta: processo de longa duração com prepared statements (o modo
// transaction não os suporta). O pg-boss 12 não usa LISTEN/NOTIFY por padrão (só polling + advisory
// xact locks), então isso não exige sessão. Pools: drizzle 6 + pg-boss 3 = 9 conexões no máximo.
const { db, sql } = createDb(env.DATABASE_URL, { max: 6 })
const boss = createBoss(env.DATABASE_URL, 'worker', (err) => {
  log.error({ err }, 'pg-boss erro')
  Sentry.captureException(err)
})

let heartbeat: ReturnType<typeof startHeartbeat> | undefined
try {
  await boss.start()
  await ensureQueues(boss)

  const deps: ProcessDeps = {
    db,
    llm: createOpenRouterClient({
      apiKey: env.OPENROUTER_API_KEY,
      appTitle: 'ia-atendimento',
      ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
      ...(env.OPENROUTER_DEV_SEM_ZDR ? { semZdrDev: true } : {}),
    }),
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

  await boss.work<ProcessJob>(QUEUES.process, { localConcurrency: 4 }, async (jobs) => {
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
