import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { withRole, withUserContext, type JwtClaims } from './rls.ts'
import {
  aiRuns, attendanceNotices, auditLog, conversations, customers, dataSubjectRequests, eventRequests, messages, retentionSettings,
  staff,
} from './schema/index.ts'
import { DEFAULT_RETENTION } from './bootstrap.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const negado = { cause: { code: '42501' } }
const as = (sub: string): JwtClaims => ({ sub, role: 'authenticated', aal: 'aal2' })
const AGORA = new Date('2026-10-06T15:00:00Z') // 12:00 em São Paulo
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000)

async function novoCliente(restaurantId: string, o: Partial<typeof customers.$inferInsert> = {}) {
  const [c] = await db.insert(customers).values({
    restaurantId, waIdHash: `h-${Math.random()}`, telefoneCifrado: 'cifrado', nomePerfil: 'Maria', ...o,
  }).returning()
  return c!
}

async function novaConversa(restaurantId: string, customerId: string, o: Partial<typeof conversations.$inferInsert> = {}) {
  const [c] = await db.insert(conversations).values({ restaurantId, customerId, ...o }).returning()
  return c!
}

async function novaMensagem(restaurantId: string, conversationId: string, criada = AGORA, texto = 'oi, sou a Maria') {
  const [m] = await db.insert(messages).values({
    restaurantId, conversationId, direcao: 'in', autor: 'cliente', tipo: 'texto', texto, createdAt: criada,
  }).returning()
  return m!
}

const excluir = (customerId: string, ator: string) =>
  withRole(db, 'web_app', (tx) => tx.execute<{ r: Record<string, unknown> }>(dsql`select app.excluir_titular(${customerId}::uuid, ${ator}::uuid) as r`))
    .then((rows) => rows[0]!.r)

const reter = (restaurantId: string, lote?: number) =>
  withRole(db, 'worker_app', (tx) => tx.execute<{ r: Record<string, number | boolean> }>(lote === undefined
    ? dsql`select app.aplicar_retencao(${restaurantId}::uuid, ${AGORA.toISOString()}::timestamptz) as r`
    : dsql`select app.aplicar_retencao(${restaurantId}::uuid, ${AGORA.toISOString()}::timestamptz, ${lote}::int) as r`))
    .then((rows) => rows[0]!.r)

describe('app.excluir_titular', () => {
  async function cenario() {
    const a = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
    const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    const alvo = await novoCliente(a.restaurantId)
    const outro = await novoCliente(a.restaurantId, { nomePerfil: 'João' })
    // conversa aberta em atendimento humano + uma encerrada
    const aberta = await novaConversa(a.restaurantId, alvo.id, { estado: 'humano', atendenteId: atendente, resumo: 'quer festa' })
    const velha = await novaConversa(a.restaurantId, alvo.id, { estado: 'encerrada' })
    await novaMensagem(a.restaurantId, aberta.id)
    await novaMensagem(a.restaurantId, aberta.id)
    await novaMensagem(a.restaurantId, velha.id)
    const convOutro = await novaConversa(a.restaurantId, outro.id)
    await novaMensagem(a.restaurantId, convOutro.id)
    const [run] = await db.insert(aiRuns).values({ restaurantId: a.restaurantId, conversationId: aberta.id, etapa: 'triagem', modelo: 'm', promptVersion: 'v1', costUsd: '0.01' }).returning()
    await db.insert(attendanceNotices).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: alvo.id, nome: 'Maria', data: '2026-10-10', pessoas: 4, origem: 'ia' },
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: outro.id, nome: 'João', data: '2026-10-10', pessoas: 2, origem: 'ia' },
    ])
    const [ev] = await db.insert(eventRequests).values({
      restaurantId: a.restaurantId, unitId: a.unitId, customerId: alvo.id, nome: 'Maria', data: '2026-11-20', convidados: 40,
      tipo: 'outro', tipoTexto: 'chá de bebê da Maria', observacoes: 'alergia a camarão', notasInternas: 'ligar 61 9999', status: 'confirmado',
    }).returning()
    const [dsr] = await db.insert(dataSubjectRequests).values({ restaurantId: a.restaurantId, customerId: alvo.id, tipo: 'exclusao' }).returning()
    return { ...a, dono, gerente, atendente, alvo, outro, aberta, run: run!, ev: ev!, dsr: dsr!, convOutro }
  }

  it('apaga mensagens/conversas/cliente e anonimiza avisos e eventos; o outro cliente fica intacto', async () => {
    const c = await cenario()
    const r = await excluir(c.alvo.id, c.gerente)
    expect(r).toEqual({ mensagens: 3, conversas: 2, avisos: 1, eventos: 1 })
    expect(await db.select().from(customers).where(eq(customers.id, c.alvo.id))).toHaveLength(0)
    expect(await db.select().from(conversations).where(eq(conversations.customerId, c.alvo.id))).toHaveLength(0)
    expect(await db.select().from(messages)).toHaveLength(1) // só a do outro cliente
    const avisos = await db.select().from(attendanceNotices).orderBy(attendanceNotices.pessoas)
    expect(avisos.map((x) => [x.customerId, x.nome, x.anonimizado])).toEqual([[c.outro.id, 'João', false], [null, null, true]])
    const [ev] = await db.select().from(eventRequests).where(eq(eventRequests.id, c.ev.id))
    expect(ev).toMatchObject({ customerId: null, nome: null, notasInternas: null, tipoTexto: null, observacoes: null, anonimizado: true, status: 'confirmado' })
    const [run] = await db.select().from(aiRuns).where(eq(aiRuns.id, c.run.id))
    expect(run).toMatchObject({ conversationId: null, costUsd: '0.010000' }) // o custo fica, sem vínculo
    const [dsr] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, c.dsr.id))
    expect(dsr).toMatchObject({ customerId: null, status: 'aberto' })
    expect(await db.select().from(customers).where(eq(customers.id, c.outro.id))).toHaveLength(1)
    expect(await db.select().from(conversations).where(eq(conversations.id, c.convOutro.id))).toHaveLength(1)
  })

  it('cliente já apagado: devolve ja_inexistente sem erro', async () => {
    const c = await cenario()
    await excluir(c.alvo.id, c.dono)
    expect(await excluir(c.alvo.id, c.dono)).toEqual({ ja_inexistente: true })
  })

  it('sem permissão: atendente, dono inativo ou de outro restaurante; nada muda', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    await expect(excluir(c.alvo.id, c.atendente)).rejects.toMatchObject(negado)
    await expect(excluir(c.alvo.id, donoB)).rejects.toMatchObject(negado)
    await db.update(staff).set({ ativo: false }).where(eq(staff.userId, c.dono))
    await expect(excluir(c.alvo.id, c.dono)).rejects.toMatchObject(negado)
    expect(await db.select().from(customers).where(eq(customers.id, c.alvo.id))).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(4)
  })

  it('só web_app executa (nem authenticated, nem worker_app, nem public)', async () => {
    const c = await cenario()
    await expect(withUserContext(db, as(c.dono), (tx) =>
      tx.execute(dsql`select app.excluir_titular(${c.alvo.id}::uuid, ${c.dono}::uuid)`))).rejects.toMatchObject(negado)
    await expect(withRole(db, 'worker_app', (tx) =>
      tx.execute(dsql`select app.excluir_titular(${c.alvo.id}::uuid, ${c.dono}::uuid)`))).rejects.toMatchObject(negado)
    const [f] = await sql<{ def: boolean; path: string[] }[]>`
      select prosecdef as def, proconfig as path from pg_proc where proname = 'excluir_titular'`
    expect(f).toEqual({ def: true, path: ['search_path=""'] })
  })
})

describe('app.aplicar_retencao', () => {
  async function base() {
    const a = await seedRestaurant(db)
    await db.insert(retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId: a.restaurantId })))
    return a
  }

  it('mensagens > 90 dias somem (em lotes); conversa encerrada vazia some; as recentes ficam; idempotente', async () => {
    const a = await base()
    const cli = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(1) })
    const enc = await novaConversa(a.restaurantId, cli.id, { estado: 'encerrada', lastMessageAt: diasAtras(100) })
    const viva = await novaConversa(a.restaurantId, cli.id, { estado: 'humano', lastMessageAt: diasAtras(1) })
    await novaMensagem(a.restaurantId, enc.id, diasAtras(100))
    await novaMensagem(a.restaurantId, enc.id, diasAtras(95))
    await novaMensagem(a.restaurantId, viva.id, diasAtras(91))
    const recente = await novaMensagem(a.restaurantId, viva.id, diasAtras(89))
    const r1 = await reter(a.restaurantId, 2)
    expect(r1).toMatchObject({ mensagens: 2, conversas: 1, pendente: true }) // a encerrada esvaziou e venceu
    const r2 = await reter(a.restaurantId, 2)
    expect(r2).toMatchObject({ mensagens: 1, conversas: 0, pendente: false })
    expect((await db.select().from(messages)).map((m) => m.id)).toEqual([recente.id])
    expect((await db.select().from(conversations)).map((c) => c.id)).toEqual([viva.id])
    const r3 = await reter(a.restaurantId)
    expect(r3).toMatchObject({ mensagens: 0, conversas: 0, simulacoes: 0, avisos: 0, eventos: 0, aiRuns: 0, clientes: 0, auditoria: 0, pendente: false })
  })

  it('simulações > 7 dias somem por inteiro; as recentes ficam', async () => {
    const a = await base()
    const velho = await novoCliente(a.restaurantId, { simulado: true, ultimaInteracaoAt: diasAtras(8) })
    const novo = await novoCliente(a.restaurantId, { simulado: true, ultimaInteracaoAt: diasAtras(6) })
    const cv = await novaConversa(a.restaurantId, velho.id, { simulada: true })
    await novaMensagem(a.restaurantId, cv.id, diasAtras(8))
    const cn = await novaConversa(a.restaurantId, novo.id, { simulada: true })
    await novaMensagem(a.restaurantId, cn.id, diasAtras(6))
    await db.insert(attendanceNotices).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: velho.id, data: '2026-09-28', pessoas: 2, origem: 'ia', simulado: true, createdAt: diasAtras(8) },
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: novo.id, data: '2026-10-01', pessoas: 3, origem: 'ia', simulado: true, createdAt: diasAtras(6) },
    ])
    await db.insert(eventRequests).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: velho.id, data: '2026-12-01', convidados: 10, tipo: 'aniversario', simulado: true, createdAt: diasAtras(8) },
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: novo.id, data: '2026-12-01', convidados: 10, tipo: 'aniversario', simulado: true, createdAt: diasAtras(6) },
    ])
    await db.insert(aiRuns).values([
      { restaurantId: a.restaurantId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', simulado: true, createdAt: diasAtras(8) },
      { restaurantId: a.restaurantId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', simulado: true, createdAt: diasAtras(6) },
    ])
    const r = await reter(a.restaurantId)
    expect(r.simulacoes).toBe(4) // cliente + aviso + evento + ai_run
    expect((await db.select().from(customers)).map((c) => c.id)).toEqual([novo.id])
    expect(await db.select().from(conversations)).toHaveLength(1)
    expect(await db.select().from(messages)).toHaveLength(1)
    expect(await db.select().from(attendanceNotices)).toHaveLength(1)
    expect(await db.select().from(eventRequests)).toHaveLength(1)
    expect(await db.select().from(aiRuns)).toHaveLength(1)
  })

  it('avisos e eventos vencidos (pela data) são anonimizados; os não vencidos não', async () => {
    const a = await base()
    const cli = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(1) })
    // hoje = 2026-10-06 em São Paulo; avisos: 30 dias; eventos: 730 dias
    await db.insert(attendanceNotices).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: cli.id, nome: 'Velho', data: '2026-09-05', pessoas: 2, origem: 'ia' },
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: cli.id, nome: 'Limite', data: '2026-09-06', pessoas: 3, origem: 'ia' },
    ])
    await db.insert(eventRequests).values([
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: cli.id, nome: 'Velho', data: '2024-10-05', convidados: 10, tipo: 'outro', tipoTexto: 'x', observacoes: 'y', notasInternas: 'z' },
      { restaurantId: a.restaurantId, unitId: a.unitId, customerId: cli.id, nome: 'Limite', data: '2024-10-06', convidados: 20, tipo: 'aniversario' },
    ])
    expect(await reter(a.restaurantId)).toMatchObject({ avisos: 1, eventos: 1 })
    const av = await db.select().from(attendanceNotices).orderBy(attendanceNotices.pessoas)
    expect(av.map((x) => [x.nome, x.customerId, x.anonimizado])).toEqual([[null, null, true], ['Limite', cli.id, false]])
    const ev = await db.select().from(eventRequests).orderBy(eventRequests.convidados)
    expect(ev[0]).toMatchObject({ nome: null, customerId: null, tipoTexto: null, observacoes: null, notasInternas: null, anonimizado: true })
    expect(ev[1]).toMatchObject({ nome: 'Limite', customerId: cli.id, anonimizado: false })
    expect(await reter(a.restaurantId)).toMatchObject({ avisos: 0, eventos: 0 })
  })

  it('ai_runs > 395 dias e auditoria > 730 dias são apagados', async () => {
    const a = await base()
    await db.insert(aiRuns).values([
      { restaurantId: a.restaurantId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', createdAt: diasAtras(396) },
      { restaurantId: a.restaurantId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', createdAt: diasAtras(394) },
    ])
    await db.insert(auditLog).values([
      { restaurantId: a.restaurantId, atorTipo: 'sistema', acao: 'velha', entidade: 'x', createdAt: diasAtras(731) },
      { restaurantId: a.restaurantId, atorTipo: 'sistema', acao: 'nova', entidade: 'x', createdAt: diasAtras(729) },
    ])
    expect(await reter(a.restaurantId)).toMatchObject({ aiRuns: 1, auditoria: 1 })
    expect((await db.select().from(aiRuns)).length).toBe(1)
    expect((await db.select().from(auditLog)).map((l) => l.acao)).toEqual(['nova'])
  })

  it('clientes inativos > 365 dias somem em cascata, salvo conversa aberta, pedido do titular ou evento em aberto', async () => {
    const a = await base()
    const inativo = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(366) })
    const conv = await novaConversa(a.restaurantId, inativo.id, { estado: 'encerrada', lastMessageAt: diasAtras(366) })
    await novaMensagem(a.restaurantId, conv.id, diasAtras(30))
    await db.insert(attendanceNotices).values({ restaurantId: a.restaurantId, unitId: a.unitId, customerId: inativo.id, nome: 'Maria', data: '2026-10-01', pessoas: 2, origem: 'ia' })
    const ativo = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(364) })
    const comConversa = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(400) })
    await novaConversa(a.restaurantId, comConversa.id, { estado: 'humano' })
    const comPedido = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(400) })
    await db.insert(dataSubjectRequests).values({ restaurantId: a.restaurantId, customerId: comPedido.id, tipo: 'acesso' })
    const comEvento = await novoCliente(a.restaurantId, { ultimaInteracaoAt: diasAtras(400) })
    await db.insert(eventRequests).values({ restaurantId: a.restaurantId, unitId: a.unitId, customerId: comEvento.id, data: '2026-12-20', convidados: 30, tipo: 'casamento', status: 'confirmado' })
    const r = await reter(a.restaurantId)
    expect(r).toMatchObject({ clientes: 1 })
    const restantes = (await db.select().from(customers)).map((c) => c.id).sort()
    expect(restantes).toEqual([ativo.id, comConversa.id, comPedido.id, comEvento.id].sort())
    expect(await db.select().from(messages)).toHaveLength(0)
    const [av] = await db.select().from(attendanceNotices)
    expect(av).toMatchObject({ customerId: null, nome: null, anonimizado: true })
  })

  it('só toca o restaurante pedido; só worker_app executa', async () => {
    const a = await base()
    const b = await seedRestaurant(db)
    await db.insert(retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId: b.restaurantId })))
    const cb = await novoCliente(b.restaurantId, { ultimaInteracaoAt: diasAtras(1) })
    const convB = await novaConversa(b.restaurantId, cb.id)
    await novaMensagem(b.restaurantId, convB.id, diasAtras(200))
    expect(await reter(a.restaurantId)).toMatchObject({ mensagens: 0 })
    expect(await db.select().from(messages)).toHaveLength(1)
    await expect(withRole(db, 'web_app', (tx) =>
      tx.execute(dsql`select app.aplicar_retencao(${a.restaurantId}::uuid, now())`))).rejects.toMatchObject(negado)
    const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
    await expect(withUserContext(db, as(dono), (tx) =>
      tx.execute(dsql`select app.aplicar_retencao(${a.restaurantId}::uuid, now())`))).rejects.toMatchObject(negado)
  })

  it('restaurante inexistente: sem erro', async () => {
    expect(await reter('00000000-0000-0000-0000-000000000000')).toEqual({ ja_inexistente: true })
  })
})
