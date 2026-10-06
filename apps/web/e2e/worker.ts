import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSql } from './helpers'

const PASTA_WORKER = fileURLToPath(new URL('../../worker/', import.meta.url))
const chave = () => randomBytes(32).toString('base64')

/** Heartbeat gravado pelo teste de banco do worker (`heartbeat.db.test.ts`): não é worker rodando. */
const WORKER_DO_TESTE_DE_BANCO = 'worker-teste'

/** Workers vivos que impedem o e2e (um worker de verdade chamaria a IA paga). */
export function workersQueBloqueiam(vivos: readonly { worker_id: string }[]): string[] {
  return vivos.map((w) => w.worker_id).filter((id) => id !== WORKER_DO_TESTE_DE_BANCO)
}

/**
 * Env do worker do e2e: o caminho de PRODUÇÃO (`AI_PROVIDER=openai`) com a base da OpenAI no servidor falso e modelos
 * da tabela de preços (o custo é calculado como em produção). Nada do OpenRouter do `.env` local passa adiante.
 */
export function ambienteDoWorkerE2e(env: Record<string, string | undefined>, iaUrl: string): Record<string, string | undefined> {
  return {
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    PHONE_ENC_KEY: env.PHONE_ENC_KEY ?? chave(),
    WA_ID_PEPPER: env.WA_ID_PEPPER ?? chave(),
    WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET ?? 'e2e',
    WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN ?? 'e2e',
    WHATSAPP_ACCESS_TOKEN: 'e2e', // simulação nunca chama a Meta; token inválido de propósito
    WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID ?? '1',
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'e2e',
    OPENAI_BASE_URL: iaUrl, // o servidor falso confere store:false e json_schema estrito
    OPENROUTER_API_KEY: '',
    OPENROUTER_BASE_URL: '',
    OPENROUTER_DEV_SEM_ZDR: '0',
    AI_TRIAGE_MODELS: 'gpt-4.1-mini',
    SUPABASE_URL: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    AI_INGEST_MODELS: 'gpt-4.1-mini,gpt-4.1', // leitura de PDF/foto também vai ao servidor falso (nunca a um modelo de verdade)
    LOG_LEVEL: 'info',
    SENTRY_DSN: '',
  }
}

/** Sobe o worker de verdade apontando para o servidor de IA falso. Para com erro se já houver outro worker no banco. */
export async function iniciarWorkerE2e(iaUrl: string): Promise<ChildProcess> {
  if (!existsSync(`${PASTA_WORKER}src/main.ts`)) throw new Error(`worker não encontrado em ${PASTA_WORKER}`)
  const vivos = await getSql()<{ worker_id: string }[]>`select worker_id from worker_heartbeats where last_seen_at > now() - interval '90 seconds'`
  if (workersQueBloqueiam(vivos).length > 0) {
    throw new Error('Há um worker rodando neste banco. Pare o "pnpm --filter @atd/worker dev" antes do e2e: ele chamaria a IA de verdade.')
  }
  const env = process.env
  // Storage do worker: a chave de serviço vem do shell (`pnpm exec supabase status -o env` → SERVICE_ROLE_KEY); nunca em arquivo
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY no shell antes do e2e (valor de SERVICE_ROLE_KEY em "pnpm exec supabase status -o env").')
  }
  const filho = spawn(process.execPath, ['src/main.ts'], {
    cwd: PASTA_WORKER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, ...ambienteDoWorkerE2e(env, iaUrl) },
  })
  // erros do worker aparecem na saída do e2e (e o pipe nunca enche e trava o processo)
  filho.stderr!.pipe(process.stderr)
  try {
    await new Promise<void>((ok, falha) => {
      const prazo = setTimeout(() => falha(new Error('worker do e2e não iniciou em 30 s')), 30_000)
      filho.stdout!.on('data', (b: Buffer) => {
        if (b.toString().includes('worker iniciado')) {
          clearTimeout(prazo)
          ok()
        }
      })
      filho.once('error', (e) => {
        clearTimeout(prazo)
        falha(e)
      })
      filho.on('exit', (codigo) => {
        clearTimeout(prazo)
        falha(new Error(`worker do e2e saiu com código ${codigo}`))
      })
    })
  } catch (erro) {
    // o filho já existe: sem isso ele ficaria vivo (e com heartbeat) e bloquearia o próximo e2e
    await pararWorkerE2e(filho)
    throw erro
  }
  return filho
}

export async function pararWorkerE2e(filho: ChildProcess | undefined) {
  if (!filho) return
  if (filho.exitCode === null && filho.signalCode === null) {
    await new Promise<void>((ok) => {
      // se o desligamento travar, força depois de 10 s
      const forcar = setTimeout(() => filho.kill('SIGKILL'), 10_000)
      filho.once('exit', () => {
        clearTimeout(forcar)
        ok()
      })
      filho.kill('SIGTERM')
    })
  }
  // o heartbeat dele ficaria "vivo" por 90 s e bloquearia o próximo e2e
  await getSql()`delete from worker_heartbeats where worker_id like ${'%-' + filho.pid}`
}
