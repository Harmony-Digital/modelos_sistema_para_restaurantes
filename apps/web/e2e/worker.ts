import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSql } from './helpers'

const PASTA_WORKER = fileURLToPath(new URL('../../worker/', import.meta.url))
const chave = () => randomBytes(32).toString('base64')

/** Sobe o worker de verdade apontando para o OpenRouter falso. Para com erro se já houver outro worker no banco. */
export async function iniciarWorkerE2e(openrouterUrl: string): Promise<ChildProcess> {
  if (!existsSync(`${PASTA_WORKER}src/main.ts`)) throw new Error(`worker não encontrado em ${PASTA_WORKER}`)
  const outros = await getSql()`select worker_id from worker_heartbeats where last_seen_at > now() - interval '90 seconds'`
  if (outros.length > 0) {
    throw new Error('Há um worker rodando neste banco. Pare o "pnpm --filter @atd/worker dev" antes do e2e: ele chamaria a IA de verdade.')
  }
  const env = process.env
  const filho = spawn(process.execPath, ['src/main.ts'], {
    cwd: PASTA_WORKER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      DATABASE_URL: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      PHONE_ENC_KEY: env.PHONE_ENC_KEY ?? chave(),
      WA_ID_PEPPER: env.WA_ID_PEPPER ?? chave(),
      WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET ?? 'e2e',
      WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN ?? 'e2e',
      WHATSAPP_ACCESS_TOKEN: 'e2e', // simulação nunca chama a Meta; token inválido de propósito
      WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID ?? '1',
      OPENROUTER_API_KEY: 'e2e',
      OPENROUTER_BASE_URL: openrouterUrl,
      AI_TRIAGE_MODELS: 'e2e/falso',
      LOG_LEVEL: 'info',
      SENTRY_DSN: '',
    },
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
