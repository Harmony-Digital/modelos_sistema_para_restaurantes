import { Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, schema } from '@atd/db'
import { createAuthUser, getTestDb, resetDb, seedRestaurant, seedStaff, setupPgbossRoles, WORKER_URL } from '@atd/db/test-utils'
import { createLogger } from '../logger.ts'
import { createAuthAdmin, processarConvite } from './convite.ts'

/** O job roda com o role de produção (worker_app); o admin só semeia e confere. */
const admin = getTestDb()
let worker: ReturnType<typeof createDb>
const URL_SUPABASE = 'http://127.0.0.1:54321'
const CHAVE = 'sb_secret_chave-de-teste-nao-real'

beforeAll(async () => {
  await setupPgbossRoles()
  worker = createDb(WORKER_URL, { max: 2 })
})
beforeEach(() => resetDb(admin.sql))
afterAll(async () => {
  await Promise.all([worker.sql.end(), admin.sql.end()])
})

type Pedido = { url: string; metodo: string; corpo: Record<string, unknown>; cabecalhos: Record<string, string> }
type Resposta = { status: number; corpo: unknown } | 'rede'

/** Supabase Auth falso: responde por caminho (`/auth/v1/invite`, `/auth/v1/admin/generate_link`). */
function authFalso(respostas: Record<string, Resposta>) {
  const pedidos: Pedido[] = []
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const url = String(entrada)
    pedidos.push({
      url, metodo: init?.method ?? 'GET', corpo: JSON.parse(String(init?.body ?? '{}')),
      cabecalhos: Object.fromEntries(new Headers(init?.headers).entries()),
    })
    const r = respostas[new URL(url).pathname]
    if (!r) throw new Error(`rota inesperada ${url}`)
    if (r === 'rede') throw new TypeError('fetch failed')
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  return { pedidos, auth: createAuthAdmin({ url: URL_SUPABASE, serviceRoleKey: CHAVE, fetch: fetchFalso }) }
}

function logCapturado() {
  const linhas: string[] = []
  const destino = new Writable({ write(chunk, _enc, cb) { linhas.push(String(chunk)); cb() } })
  return { linhas, log: createLogger('debug', destino) }
}

const EMAIL = 'nova.atendente@teste.local'

async function cenario(o: { papel?: 'gerente' | 'atendente' } = {}) {
  const { restaurantId, unitId } = await seedRestaurant(admin.db)
  const dono = await seedStaff(admin.db, admin.sql, { restaurantId, papel: 'dono' })
  const [c] = await admin.db.insert(schema.staffInvites).values({
    restaurantId, email: EMAIL, nome: 'Ana', papel: o.papel ?? 'atendente', unidades: [unitId], createdBy: dono,
  }).returning()
  return { restaurantId, unitId, conviteId: c!.id }
}

const convite = async (id: string) => (await admin.db.select().from(schema.staffInvites).where(eq(schema.staffInvites.id, id)))[0]!
const membro = async (userId: string) => (await admin.db.select().from(schema.staff).where(eq(schema.staff.userId, userId)))[0]

describe('equipe.convite (worker)', () => {
  it('sucesso: convida pelo Auth (chave de serviço), cria o staff com papel e unidades e marca enviado', async () => {
    const { restaurantId, unitId, conviteId } = await cenario()
    const userId = await createAuthUser(admin.sql, EMAIL)
    const { auth, pedidos } = authFalso({ '/auth/v1/invite': { status: 200, corpo: { id: userId, email: EMAIL } } })
    const { log, linhas } = logCapturado()

    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('enviado')
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]).toMatchObject({ url: `${URL_SUPABASE}/auth/v1/invite`, metodo: 'POST', corpo: { email: EMAIL } })
    expect(pedidos[0]!.cabecalhos.apikey).toBe(CHAVE)
    expect(pedidos[0]!.cabecalhos.authorization).toBeUndefined() // chave nova (sb_secret_) não vai como Bearer
    expect(await convite(conviteId)).toMatchObject({ status: 'enviado', erro: null, userId })
    expect(await membro(userId)).toMatchObject({ restaurantId, nome: 'Ana', papel: 'atendente', unidadesPermitidas: [unitId] })
    expect(linhas.join('')).not.toContain(EMAIL)
    expect(linhas.join('')).not.toContain(CHAVE)
  })

  it('reenvio para quem ainda não entrou: o /invite do Auth reenvia o e-mail ao usuário não confirmado (mesmo caminho)', async () => {
    const { conviteId } = await cenario()
    const userId = await createAuthUser(admin.sql, EMAIL)
    const { auth } = authFalso({ '/auth/v1/invite': { status: 200, corpo: { id: userId, email: EMAIL } } })
    const { log } = logCapturado()
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('enviado')
    // o dono reenvia: o convite volta a pendente e o job roda de novo sem duplicar o staff
    await admin.db.update(schema.staffInvites).set({ status: 'pendente' }).where(eq(schema.staffInvites.id, conviteId))
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('enviado')
    expect(await admin.db.select().from(schema.staff).where(eq(schema.staff.userId, userId))).toHaveLength(1)
  })

  it('e-mail de usuário que já tem conta (email_exists): não convida de novo; acha o usuário pelo generate_link e vincula', async () => {
    const { restaurantId, conviteId } = await cenario({ papel: 'gerente' })
    const userId = await createAuthUser(admin.sql, EMAIL)
    const { auth, pedidos } = authFalso({
      '/auth/v1/invite': { status: 422, corpo: { code: 422, error_code: 'email_exists', msg: `A user with this email ${EMAIL} has already been registered` } },
      '/auth/v1/admin/generate_link': { status: 200, corpo: { id: userId, email: EMAIL, action_link: 'http://x', hashed_token: 'h' } },
    })
    const { log, linhas } = logCapturado()
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('enviado')
    expect(pedidos.map((p) => new URL(p.url).pathname)).toEqual(['/auth/v1/invite', '/auth/v1/admin/generate_link'])
    expect(pedidos[1]!.corpo).toEqual({ type: 'magiclink', email: EMAIL })
    expect(await membro(userId)).toMatchObject({ restaurantId, papel: 'gerente' })
    expect(linhas.join('')).not.toContain(EMAIL)
  })

  it('usuário existente que é de outro restaurante: não é movido (erro outro_restaurante)', async () => {
    const { conviteId } = await cenario()
    const outro = await seedRestaurant(admin.db)
    const userId = await seedStaff(admin.db, admin.sql, { restaurantId: outro.restaurantId, papel: 'atendente' })
    const { auth } = authFalso({
      '/auth/v1/invite': { status: 422, corpo: { error_code: 'email_exists', msg: 'already registered' } },
      '/auth/v1/admin/generate_link': { status: 200, corpo: { id: userId } },
    })
    const { log } = logCapturado()
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('erro')
    expect(await convite(conviteId)).toMatchObject({ status: 'erro', erro: 'outro_restaurante' })
    expect(await membro(userId)).toMatchObject({ restaurantId: outro.restaurantId })
  })

  it.each([
    [{ status: 429, corpo: { error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' } }, 'limite_envio'],
    [{ status: 400, corpo: { error_code: 'email_address_invalid', msg: `Email address "${EMAIL}" is invalid` } }, 'email_invalido'],
    [{ status: 500, corpo: { msg: 'Internal error' } }, 'indisponivel'],
    ['rede', 'indisponivel'],
    [{ status: 403, corpo: { error_code: 'not_admin', msg: 'User not allowed' } }, 'falha_convite'],
  ] as const)('erro do Auth vira código amigável, sem e-mail no log (%#)', async (resposta, codigo) => {
    const { conviteId } = await cenario()
    const { auth } = authFalso({ '/auth/v1/invite': resposta as Resposta })
    const { log, linhas } = logCapturado()
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('erro')
    expect(await convite(conviteId)).toMatchObject({ status: 'erro', erro: codigo, userId: null })
    expect(await admin.db.select().from(schema.staff).where(eq(schema.staff.restaurantId, (await convite(conviteId)).restaurantId))).toHaveLength(1) // só o dono
    expect(linhas.join('')).not.toContain(EMAIL)
    expect(linhas.join('')).not.toContain('nova.atendente')
  })

  it('convite que não está pendente (ou inexistente) não chama o Auth', async () => {
    const { conviteId } = await cenario()
    await admin.db.update(schema.staffInvites).set({ status: 'enviado' }).where(eq(schema.staffInvites.id, conviteId))
    const { auth, pedidos } = authFalso({})
    const { log } = logCapturado()
    expect(await processarConvite({ db: worker.db, auth, log }, conviteId)).toBe('nada')
    expect(await processarConvite({ db: worker.db, auth, log }, randomUUID())).toBe('nada')
    expect(pedidos).toEqual([])
  })
})
