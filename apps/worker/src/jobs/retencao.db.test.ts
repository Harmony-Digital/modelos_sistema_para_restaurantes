import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createDb, DEFAULT_RETENTION, QUEUES, schema } from '@atd/db'
import { getTestBoss, getTestDb, resetDb, seedRestaurant, setupPgbossRoles, WORKER_URL } from '@atd/db/test-utils'
import { createLogger } from '../logger.ts'
import { agendarRetencao, aplicarRetencaoDiaria, executarRetencaoDiaria, RETENCAO_CRON, RETENCAO_TZ } from './retencao.ts'

/** Retenção roda com o role de produção (worker_app); o admin só semeia e confere. */
const admin = getTestDb()
let worker: ReturnType<typeof createDb>
const log = createLogger('silent')
const AGORA = new Date('2026-10-06T06:00:00Z') // 03:00 em São Paulo
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000)

beforeAll(async () => {
  await setupPgbossRoles()
  worker = createDb(WORKER_URL, { max: 2 })
})
beforeEach(() => resetDb(admin.sql))
afterAll(async () => {
  await (await getTestBoss()).stop({ graceful: false })
  await Promise.all([worker.sql.end(), admin.sql.end()])
})

async function restauranteCom(mensagensVelhas: number, mensagensNovas = 1) {
  const { restaurantId } = await seedRestaurant(admin.db)
  await admin.db.insert(schema.retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId })))
  const [c] = await admin.db.insert(schema.customers).values({
    restaurantId, waIdHash: `h-${Math.random()}`, telefoneCifrado: 'cifrado', nomePerfil: 'Maria', ultimaInteracaoAt: diasAtras(1),
  }).returning()
  const [conv] = await admin.db.insert(schema.conversations)
    .values({ restaurantId, customerId: c!.id, estado: 'humano', lastMessageAt: diasAtras(1) }).returning()
  const msg = (createdAt: Date) => ({
    restaurantId, conversationId: conv!.id, direcao: 'in' as const, autor: 'cliente' as const, tipo: 'texto' as const, texto: 'oi', createdAt,
  })
  const linhas = [
    ...Array.from({ length: mensagensVelhas }, () => msg(diasAtras(200))),
    ...Array.from({ length: mensagensNovas }, () => msg(diasAtras(2))),
  ]
  if (linhas.length) await admin.db.insert(schema.messages).values(linhas)
  return restaurantId
}

const mensagens = (restaurantId: string) =>
  admin.db.select().from(schema.messages).where(eq(schema.messages.restaurantId, restaurantId))
const auditorias = () =>
  admin.db.select().from(schema.auditLog).where(eq(schema.auditLog.acao, 'retencao.executada')).orderBy(asc(schema.auditLog.id))

describe('retenção diária (worker)', () => {
  it('agenda retencao.diaria às 03:00 de São Paulo (idempotente: reagendar não duplica)', async () => {
    const boss = await getTestBoss()
    await agendarRetencao(boss)
    await agendarRetencao(boss)
    const s = await boss.getSchedules(QUEUES.retencao)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ name: QUEUES.retencao, cron: RETENCAO_CRON, timezone: RETENCAO_TZ })
    expect(RETENCAO_CRON).toBe('0 3 * * *')
    expect(RETENCAO_TZ).toBe('America/Sao_Paulo')
  })

  it('aplica por restaurante, em lotes até zerar, e audita retencao.executada só com contagens', async () => {
    const a = await restauranteCom(5)
    const b = await restauranteCom(2)
    const r = await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA }, { lote: 2 })
    expect(r.falhas).toBe(0)
    expect(await mensagens(a)).toHaveLength(1)
    expect(await mensagens(b)).toHaveLength(1)

    const audit = await auditorias()
    expect(audit.map((x) => [x.restaurantId, x.atorTipo, x.entidade, x.entidadeId])).toEqual(
      [a, b].sort().map((id) => [id, 'sistema', 'restaurant', id]),
    )
    const deA = audit.find((x) => x.restaurantId === a)!.diff as Record<string, unknown>
    expect(deA).toMatchObject({ mensagens: 5, pendente: false })
    expect(deA.iteracoes).toBeGreaterThanOrEqual(3) // 2 + 2 + 1 (o lote menor que o tamanho encerra)
    // só números e booleanos: nada de texto do cliente
    expect(Object.values(deA).every((v) => typeof v === 'number' || typeof v === 'boolean')).toBe(true)
  })

  it('rodar duas vezes no mesmo dia é idempotente (a segunda não apaga nada a mais)', async () => {
    const a = await restauranteCom(3, 2)
    await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA })
    const r2 = await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA })
    expect(r2.falhas).toBe(0)
    expect(await mensagens(a)).toHaveLength(2)
    const audit = await auditorias()
    expect(audit).toHaveLength(2)
    expect(audit[1]!.diff).toMatchObject({ mensagens: 0, pendente: false })
  })

  it('teto de iterações: para no meio, audita pendente = true e a próxima execução continua', async () => {
    const a = await restauranteCom(5)
    await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA }, { lote: 1, maxIteracoes: 2 })
    expect(await mensagens(a)).toHaveLength(4)
    expect((await auditorias())[0]!.diff).toMatchObject({ mensagens: 2, iteracoes: 2, pendente: true })
    await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA })
    expect(await mensagens(a)).toHaveLength(1)
  })

  /** `db` que falha nas `n` primeiras chamadas de `app.aplicar_retencao` DESTE restaurante (pelo parâmetro, não pela ordem). */
  function falhandoPara(restaurantId: string, n = Infinity) {
    let falhas = 0
    return new Proxy(worker.db, {
      get(alvo, prop, recv) {
        if (prop === 'execute') {
          return (...args: Parameters<typeof alvo.execute>) => {
            const { params } = worker.db.dialect.sqlToQuery(args[0] as Parameters<typeof worker.db.dialect.sqlToQuery>[0])
            if (params.includes(restaurantId) && falhas < n) {
              falhas++
              return Promise.reject(new Error('falha simulada'))
            }
            return alvo.execute(...args)
          }
        }
        return Reflect.get(alvo, prop, recv)
      },
    })
  }

  it('falha de um restaurante não impede os outros (e é contada)', async () => {
    const a = await restauranteCom(1)
    const b = await restauranteCom(1)
    const r = await aplicarRetencaoDiaria({ db: falhandoPara(a), log, now: () => AGORA })
    expect(r).toMatchObject({ falhas: 1, falharam: [a] })
    expect((await mensagens(a)).length).toBe(2) // o que falhou ficou intacto
    expect((await mensagens(b)).length).toBe(1)
    expect((await auditorias()).map((x) => x.restaurantId)).toEqual([b])
  })

  it('só os restaurantes indicados', async () => {
    const a = await restauranteCom(1)
    const b = await restauranteCom(1)
    const r = await aplicarRetencaoDiaria({ db: worker.db, log, now: () => AGORA }, { restaurantes: [b] })
    expect(r).toMatchObject({ restaurantes: 1, falhas: 0 })
    expect((await mensagens(a)).length).toBe(2)
  })

  it('job: retenta só quem falhou, uma vez, e nunca relança (sem retentar o job inteiro nem duplicar auditoria)', async () => {
    const a = await restauranteCom(1)
    const b = await restauranteCom(1)
    // falha passageira: a segunda tentativa de `a` passa
    expect(await executarRetencaoDiaria({ db: falhandoPara(a, 1), log, now: () => AGORA })).toMatchObject({ falhas: 0 })
    expect((await auditorias()).map((x) => x.restaurantId).sort()).toEqual([a, b].sort())
    expect((await mensagens(a)).length).toBe(1)
    // falha persistente: resolve (não relança), conta a falha e não audita `a` de novo
    const c = await restauranteCom(1)
    await expect(executarRetencaoDiaria({ db: falhandoPara(c), log, now: () => AGORA })).resolves.toMatchObject({ falhas: 1, falharam: [c] })
    const porRestaurante = (await auditorias()).map((x) => x.restaurantId)
    expect(porRestaurante.filter((x) => x === c)).toEqual([])
    expect(porRestaurante.filter((x) => x === b)).toHaveLength(2) // uma por execução, nunca repetida dentro da mesma
  })
})
