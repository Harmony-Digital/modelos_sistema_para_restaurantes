import { hostname } from 'node:os'
import { loadEnv, workerEnvSchema } from '@atd/config'
import { createBoss, createDb, ensureQueues } from '@atd/db'
import { startHeartbeat } from './heartbeat.ts'
import { createLogger } from './logger.ts'
import { initSentry, Sentry } from './sentry.ts'

const VERSION = process.env.APP_VERSION ?? 'dev'
const env = loadEnv(workerEnvSchema)
const log = createLogger(env.LOG_LEVEL)
initSentry(env.SENTRY_DSN, VERSION)

// Conexão de sessão/direta: o pg-boss usa LISTEN/NOTIFY.
const { db, sql } = createDb(env.DATABASE_URL, { max: 10 })
const boss = createBoss(env.DATABASE_URL, 'worker', (err) => {
  log.error({ err }, 'pg-boss erro')
  Sentry.captureException(err)
})

await boss.start()
await ensureQueues(boss)
const heartbeat = startHeartbeat(db, `${hostname()}-${process.pid}`, VERSION)
await heartbeat.beat()
log.info({ version: VERSION }, 'worker iniciado')

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'encerrando: aguardando jobs em andamento')
  heartbeat.stop()
  await boss.stop({ graceful: true, timeout: 30_000 })
  await sql.end({ timeout: 5 })
  await Sentry.flush(2_000)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
