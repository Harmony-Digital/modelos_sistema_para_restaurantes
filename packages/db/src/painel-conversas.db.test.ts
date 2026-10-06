import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  assumirConversa, contarAguardando, devolverConversa, encerrarConversa, lerConversa, listarInbox,
  listarRespostasRapidas, reenviarMensagem, responderConversa, salvarHorarioHumano, salvarRespostaRapida,
  tempoAteAssumirHoje,
} from './painel-conversas.ts'
import { auditLog, conversations, customers, messages, quickReplies, restaurants, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const minutos = (m: number) => new Date(Date.now() - m * 60_000)
const emHoras = (h: number) => new Date(Date.now() + h * 3_600_000)

async function cenario() {
  const a = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId: a.restaurantId, nome: 'Norte', slug: 'norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId], nome: 'Gerente Sul' }).where(eq(staff.userId, gerente))
  const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId], nome: 'Ana' }).where(eq(staff.userId, atendente))
  const atendente2 = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
  await db.update(staff).set({ unidadesPermitidas: [a.unitId], nome: 'Bia' }).where(eq(staff.userId, atendente2))
  return { ...a, u2: u2!.id, dono, gerente, atendente, atendente2 }
}

type Conv = {
  restaurantId: string
  unitId?: string | null
  estado?: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'
  nome?: string
  simulada?: boolean
  atendenteId?: string | null
  aguardandoDesde?: Date
  lastMessageAt?: Date
  janela?: Date | null
}
async function conversa(p: Conv) {
  const [c] = await db.insert(customers).values({
    restaurantId: p.restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: p.nome ?? 'Maria', simulado: p.simulada ?? false,
  }).returning()
  const [conv] = await db.insert(conversations).values({
    restaurantId: p.restaurantId, customerId: c!.id, estado: p.estado ?? 'aguardando_humano', unidadeContextoId: p.unitId ?? null,
    simulada: p.simulada ?? false, atendenteId: p.atendenteId ?? null, windowExpiresAt: p.janela === undefined ? emHoras(20) : p.janela,
    ...(p.aguardandoDesde && { aguardandoDesde: p.aguardandoDesde }), ...(p.lastMessageAt && { lastMessageAt: p.lastMessageAt }),
  }).returning()
  return conv!.id
}
async function msg(restaurantId: string, conversationId: string, texto: string, extra: Partial<typeof messages.$inferInsert> = {}) {
  const [m] = await db.insert(messages).values({ restaurantId, conversationId, direcao: 'in', autor: 'cliente', tipo: 'texto', texto, ...extra }).returning()
  return m!.id
}

describe('listarInbox', () => {
  it('Aguardando: espera mais antiga primeiro, trecho da última mensagem (≤ 80), unidade; simuladas só com o filtro', async () => {
    const c = await cenario()
    const nova = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Nova', aguardandoDesde: minutos(1) })
    const antiga = await conversa({ restaurantId: c.restaurantId, unitId: c.u2, nome: 'Antiga', aguardandoDesde: minutos(30) })
    await conversa({ restaurantId: c.restaurantId, nome: 'Sim', simulada: true, aguardandoDesde: minutos(40) })
    await conversa({ restaurantId: c.restaurantId, nome: 'Com IA', estado: 'ia' })
    await msg(c.restaurantId, nova, 'primeira')
    await msg(c.restaurantId, nova, 'x'.repeat(200))
    const r = await listarInbox(db, as(c.dono), { aba: 'aguardando' })
    expect(r.itens.map((i) => i.nome)).toEqual(['Antiga', 'Nova'])
    expect(r.proximo).toBeNull()
    const n = r.itens[1]!
    expect(n).toMatchObject({ id: nova, unidade: 'Asa Sul', estado: 'aguardando_humano', simulada: false, atendente: null })
    expect(n.trecho).toHaveLength(80)
    expect(n.aguardandoDesde).toBeInstanceOf(Date)
    expect(r.itens[0]!.id).toBe(antiga)
    const comSim = await listarInbox(db, as(c.dono), { aba: 'aguardando', simulacoes: true })
    expect(comSim.itens.map((i) => [i.nome, i.simulada])).toEqual([['Sim', true], ['Antiga', false], ['Nova', false]])
    const soSul = await listarInbox(db, as(c.dono), { aba: 'aguardando', unitId: c.unitId })
    expect(soSul.itens.map((i) => i.nome)).toEqual(['Nova'])
  })

  it('Em atendimento (todas em humano visíveis, as minhas primeiro), Com a IA e Encerradas (30 dias)', async () => {
    const c = await cenario()
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Minha', estado: 'humano', atendenteId: c.atendente, lastMessageAt: minutos(30) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Da Bia', estado: 'humano', atendenteId: c.atendente2, lastMessageAt: minutos(1) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Da Bia velha', estado: 'humano', atendenteId: c.atendente2, lastMessageAt: minutos(40) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.u2, nome: 'Do Norte', estado: 'humano', atendenteId: c.dono })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'IA velha', estado: 'ia', lastMessageAt: minutos(50) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'IA nova', estado: 'ia', lastMessageAt: minutos(5) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Fechada', estado: 'encerrada', lastMessageAt: minutos(60) })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Antiquíssima', estado: 'encerrada', lastMessageAt: minutos(60 * 24 * 31) })
    const eu = as(c.atendente, 'aal1')
    const emAtendimento = await listarInbox(db, eu, { aba: 'em_atendimento' })
    expect(emAtendimento.itens.map((i) => [i.nome, i.atendente, i.atendenteId])).toEqual([
      ['Minha', 'Ana', c.atendente], ['Da Bia', 'Bia', c.atendente2], ['Da Bia velha', 'Bia', c.atendente2],
    ])
    expect((await listarInbox(db, as(c.dono), { aba: 'em_atendimento' })).itens.map((i) => i.nome))
      .toEqual(['Do Norte', 'Da Bia', 'Minha', 'Da Bia velha'])
    expect((await listarInbox(db, eu, { aba: 'ia' })).itens.map((i) => i.nome)).toEqual(['IA nova', 'IA velha'])
    expect((await listarInbox(db, eu, { aba: 'encerradas' })).itens.map((i) => i.nome)).toEqual(['Fechada'])
  })

  it('paginação por cursor de 50 sem repetir nem pular', async () => {
    const c = await cenario()
    for (let i = 0; i < 55; i++) await conversa({ restaurantId: c.restaurantId, nome: `C${i}`, aguardandoDesde: minutos(100 - i) })
    const p1 = await listarInbox(db, as(c.dono), { aba: 'aguardando' })
    expect(p1.itens).toHaveLength(50)
    expect(p1.proximo).not.toBeNull()
    const p2 = await listarInbox(db, as(c.dono), { aba: 'aguardando', cursor: p1.proximo! })
    expect(p2.itens).toHaveLength(5)
    expect(p2.proximo).toBeNull()
    expect([...p1.itens, ...p2.itens].map((i) => i.nome)).toEqual(Array.from({ length: 55 }, (_, i) => `C${i}`))
    for (let i = 0; i < 55; i++) await conversa({ restaurantId: c.restaurantId, nome: `I${i}`, estado: 'ia', lastMessageAt: minutos(i) })
    const q1 = await listarInbox(db, as(c.dono), { aba: 'ia' })
    const q2 = await listarInbox(db, as(c.dono), { aba: 'ia', cursor: q1.proximo! })
    expect([...q1.itens, ...q2.itens].map((i) => i.nome)).toEqual(Array.from({ length: 55 }, (_, i) => `I${i}`))
    // em atendimento: as minhas primeiro, atravessando a página
    for (let i = 0; i < 55; i++) {
      await conversa({ restaurantId: c.restaurantId, nome: `H${i}`, estado: 'humano', atendenteId: i % 2 ? c.dono : c.gerente, lastMessageAt: minutos(i) })
    }
    const h1 = await listarInbox(db, as(c.dono), { aba: 'em_atendimento' })
    const h2 = await listarInbox(db, as(c.dono), { aba: 'em_atendimento', cursor: h1.proximo! })
    expect(h2.proximo).toBeNull()
    const esperado = [...Array.from({ length: 55 }, (_, i) => i).filter((i) => i % 2), ...Array.from({ length: 55 }, (_, i) => i).filter((i) => !(i % 2))]
    expect([...h1.itens, ...h2.itens].map((i) => i.nome)).toEqual(esperado.map((i) => `H${i}`))
    await expect(listarInbox(db, as(c.dono), { aba: 'ia', cursor: 'lixo' })).resolves.toMatchObject({ itens: expect.any(Array) })
  })

  it('gerente e atendente restritos não veem conversa de outra unidade nem sem unidade', async () => {
    const c = await cenario()
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Sul' })
    const norte = await conversa({ restaurantId: c.restaurantId, unitId: c.u2, nome: 'Norte' })
    const sem = await conversa({ restaurantId: c.restaurantId, nome: 'Sem unidade' })
    for (const quem of [as(c.gerente), as(c.atendente, 'aal1')]) {
      expect((await listarInbox(db, quem, { aba: 'aguardando' })).itens.map((i) => i.nome)).toEqual(['Sul'])
      expect(await lerConversa(db, quem, norte)).toBeNull()
      expect(await lerConversa(db, quem, sem)).toBeNull()
      expect(await assumirConversa(db, quem, norte, { forcar: true })).toEqual({ ok: false, erro: 'nao_encontrada' })
      expect(await encerrarConversa(db, quem, sem)).toEqual({ ok: false, erro: 'nao_encontrada' })
      expect(await devolverConversa(db, quem, norte)).toEqual({ ok: false, erro: 'nao_encontrada' })
    }
    expect((await listarInbox(db, as(c.dono), { aba: 'aguardando' })).itens).toHaveLength(3)
    // outro restaurante não vê nada
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    expect((await listarInbox(db, as(donoB), { aba: 'aguardando' })).itens).toHaveLength(0)
    expect(await assumirConversa(db, as(donoB), sem, {})).toEqual({ ok: false, erro: 'nao_encontrada' })
    // dono sem MFA não vê nem age
    expect((await listarInbox(db, as(c.dono, 'aal1'), { aba: 'aguardando' })).itens).toHaveLength(0)
    expect(await assumirConversa(db, as(c.dono, 'aal1'), sem, {})).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('contarAguardando conta só conversas reais visíveis', async () => {
    const c = await cenario()
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId })
    await conversa({ restaurantId: c.restaurantId, unitId: c.u2 })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, simulada: true })
    await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'ia' })
    expect(await contarAguardando(db, as(c.dono))).toBe(2)
    expect(await contarAguardando(db, as(c.atendente, 'aal1'))).toBe(1)
  })
})

describe('lerConversa', () => {
  it('histórico em ordem cronológica, 50 por página para cima, com nome do atendente', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    const ids: number[] = []
    for (let i = 0; i < 60; i++) ids.push(await msg(c.restaurantId, id, `m${i}`))
    await msg(c.restaurantId, id, 'resposta', { direcao: 'out', autor: 'humano', atendenteId: c.atendente, statusEnvio: 'enviado' })
    const r = await lerConversa(db, as(c.dono), id)
    expect(r!.conversa).toMatchObject({ id, estado: 'humano', atendenteId: c.atendente, atendente: 'Ana', unidade: 'Asa Sul' })
    expect(r!.conversa.janelaAte).toBeInstanceOf(Date)
    expect(r!.mensagens).toHaveLength(50)
    expect(r!.mensagens.at(-1)).toMatchObject({ texto: 'resposta', autor: 'humano', atendente: 'Ana', statusEnvio: 'enviado', transcrito: false })
    expect(r!.mensagens[0]!.texto).toBe('m11')
    for (const antesDe of [Number.NaN, 1.5, -1, Number.MAX_SAFE_INTEGER + 2]) {
      const x = await lerConversa(db, as(c.dono), id, { antesDe })
      expect(x!.mensagens, String(antesDe)).toEqual([])
    }
    const antes = await lerConversa(db, as(c.dono), id, { antesDe: r!.mensagens[0]!.id })
    expect(antes!.mensagens.map((m) => m.texto)).toEqual(Array.from({ length: 11 }, (_, i) => `m${i}`))
  })
})

describe('assumirConversa', () => {
  it('assume conversa livre, zera a espera, cancela respostas pendentes da IA e audita sem PII', async () => {
    const c = await cenario()
    const desde = minutos(10)
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, nome: 'Maria Secreta', aguardandoDesde: desde })
    const pendIa = await msg(c.restaurantId, id, 'resposta da IA', { direcao: 'out', autor: 'ia', statusEnvio: 'pendente' })
    const pendSis = await msg(c.restaurantId, id, 'aviso', { direcao: 'out', autor: 'sistema', statusEnvio: 'pendente' })
    expect(await assumirConversa(db, as(c.atendente, 'aal1'), id, {})).toEqual({ ok: true })
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv).toMatchObject({ estado: 'humano', atendenteId: c.atendente, aguardandoDesde: null })
    const st = await db.select({ id: messages.id, s: messages.statusEnvio }).from(messages).where(eq(messages.conversationId, id))
    expect(Object.fromEntries(st.map((x) => [x.id, x.s]))).toEqual({ [pendIa]: 'cancelado', [pendSis]: 'pendente' })
    const [a] = await db.select().from(auditLog)
    expect(a).toMatchObject({ acao: 'conversa.assumida', atorId: c.atendente, entidade: 'conversation', entidadeId: id })
    expect(new Date((a!.diff as { aguardandoDesde: string }).aguardandoDesde).getTime()).toBe(desde.getTime())
    expect(JSON.stringify(a!.diff)).not.toContain('Maria')
    // assumir de novo a própria conversa é idempotente
    expect(await assumirConversa(db, as(c.atendente, 'aal1'), id, {})).toEqual({ ok: true })
    expect(await db.select().from(auditLog)).toHaveLength(1)
  })

  it('já atendida ⇒ ja_atendida com o nome; atendente não força; gerente/dono forçam', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    expect(await assumirConversa(db, as(c.atendente2, 'aal1'), id, {})).toEqual({ ok: false, erro: 'ja_atendida', atendente: 'Ana' })
    expect(await assumirConversa(db, as(c.atendente2, 'aal1'), id, { forcar: true })).toEqual({ ok: false, erro: 'ja_atendida', atendente: 'Ana' })
    expect(await assumirConversa(db, as(c.gerente), id, {})).toEqual({ ok: false, erro: 'ja_atendida', atendente: 'Ana' })
    expect(await assumirConversa(db, as(c.gerente), id, { forcar: true })).toEqual({ ok: true })
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv!.atendenteId).toBe(c.gerente)
    const [a] = await db.select().from(auditLog)
    expect(a!.diff).toMatchObject({ forcado: true })
  })

  it('humano sem atendente (usuário removido) é livre: qualquer um com acesso assume sem forçar, devolve ou encerra', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: null })
    expect(await assumirConversa(db, as(c.atendente, 'aal1'), id, {})).toEqual({ ok: true })
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv).toMatchObject({ estado: 'humano', atendenteId: c.atendente })
    const [a] = await db.select().from(auditLog)
    expect(a!.diff).toMatchObject({ estadoAnterior: 'humano' })
    expect(a!.diff).not.toHaveProperty('forcado')
    const outra = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: null })
    expect(await devolverConversa(db, as(c.atendente2, 'aal1'), outra)).toEqual({ ok: true })
    const terceira = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: null })
    expect(await encerrarConversa(db, as(c.atendente2, 'aal1'), terceira)).toEqual({ ok: true })
    // sem acesso à unidade continua sem acesso
    const doNorte = await conversa({ restaurantId: c.restaurantId, unitId: c.u2, estado: 'humano', atendenteId: null })
    expect(await assumirConversa(db, as(c.atendente, 'aal1'), doNorte, {})).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('encerrada não pode ser assumida', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'encerrada' })
    expect(await assumirConversa(db, as(c.dono), id, { forcar: true })).toEqual({ ok: false, erro: 'transicao_invalida' })
  })

  it('dois atendentes ao mesmo tempo: um vence, o outro vê quem está atendendo', async () => {
    const c = await cenario()
    for (let rodada = 0; rodada < 5; rodada++) {
      const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId })
      const r = await Promise.all([
        assumirConversa(db, as(c.atendente, 'aal1'), id, {}),
        assumirConversa(db, as(c.atendente2, 'aal1'), id, {}),
      ])
      expect(r.filter((x) => x.ok)).toHaveLength(1)
      const perdeu = r.find((x) => !x.ok)
      expect(perdeu).toMatchObject({ ok: false, erro: 'ja_atendida' })
      expect(['Ana', 'Bia']).toContain((perdeu as { atendente: string }).atendente)
      const audit = await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))
      expect(audit).toHaveLength(1)
    }
  })
})

describe('responderConversa', () => {
  it('só quem assumiu, em humano, dentro da janela, texto 1–4096', async () => {
    const c = await cenario()
    const minha = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    const eu = as(c.atendente, 'aal1')
    expect(await responderConversa(db, as(c.atendente2, 'aal1'), minha, 'oi')).toEqual({ ok: false, erro: 'nao_e_seu' })
    expect(await responderConversa(db, as(c.dono), minha, 'oi')).toEqual({ ok: false, erro: 'nao_e_seu' })
    expect(await responderConversa(db, eu, minha, '   ')).toEqual({ ok: false, erro: 'texto_invalido' })
    expect(await responderConversa(db, eu, minha, 'x'.repeat(4097))).toEqual({ ok: false, erro: 'texto_invalido' })
    // régua em code points: 4096 emojis cabem, 4097 não
    expect(await responderConversa(db, eu, minha, '😀'.repeat(4097))).toEqual({ ok: false, erro: 'texto_invalido' })

    const aguardando = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId })
    expect(await responderConversa(db, eu, aguardando, 'oi')).toEqual({ ok: false, erro: 'transicao_invalida' })
    const vencida = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente, janela: minutos(1) })
    expect(await responderConversa(db, eu, vencida, 'oi')).toEqual({ ok: false, erro: 'fora_da_janela' })
    const semJanela = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente, janela: null })
    expect(await responderConversa(db, eu, semJanela, 'oi')).toEqual({ ok: false, erro: 'fora_da_janela' })
    expect(await db.select().from(messages)).toHaveLength(0)

    const r = await responderConversa(db, eu, minha, 'Olá, Maria! Já verifico.')
    expect(r.ok).toBe(true)
    const [m] = await db.select().from(messages).where(eq(messages.id, (r as { messageId: number }).messageId))
    expect(m).toMatchObject({
      conversationId: minha, restaurantId: c.restaurantId, direcao: 'out', autor: 'humano', atendenteId: c.atendente,
      tipo: 'texto', texto: 'Olá, Maria! Já verifico.', statusEnvio: 'pendente',
    })
    const audit = await db.select().from(auditLog).where(eq(auditLog.acao, 'conversa.respondida'))
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0]!.diff)).not.toContain('Maria')
    expect((await responderConversa(db, eu, minha, '😀'.repeat(4096))).ok).toBe(true)
  })

  it('conversa devolvida no meio: recusa', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    expect(await devolverConversa(db, as(c.gerente), id)).toEqual({ ok: true })
    expect(await responderConversa(db, as(c.atendente, 'aal1'), id, 'oi')).toEqual({ ok: false, erro: 'transicao_invalida' })
  })
})

describe('reenviarMensagem', () => {
  it('só mensagem humana com falhou:* volta a pendente', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    const falhou = await msg(c.restaurantId, id, 'a', { direcao: 'out', autor: 'humano', atendenteId: c.atendente, statusEnvio: 'falhou:131047' })
    const enviada = await msg(c.restaurantId, id, 'b', { direcao: 'out', autor: 'humano', atendenteId: c.atendente, statusEnvio: 'enviado' })
    const daIa = await msg(c.restaurantId, id, 'c', { direcao: 'out', autor: 'ia', statusEnvio: 'falhou:x' })
    const eu = as(c.atendente, 'aal1')
    expect(await reenviarMensagem(db, eu, enviada)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await reenviarMensagem(db, eu, daIa)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await reenviarMensagem(db, as(c.atendente2, 'aal1'), falhou)).toEqual({ ok: false, erro: 'nao_e_seu' })
    expect(await reenviarMensagem(db, eu, 999_999)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await reenviarMensagem(db, eu, falhou)).toEqual({ ok: true, conversationId: id })
    const [m] = await db.select().from(messages).where(eq(messages.id, falhou))
    expect(m!.statusEnvio).toBe('pendente')
    expect(await reenviarMensagem(db, eu, falhou)).toEqual({ ok: false, erro: 'transicao_invalida' })
  })

  it('linha antiga do webhook (failed:<código>) também volta a pendente', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    const antiga = await msg(c.restaurantId, id, 'a', { direcao: 'out', autor: 'humano', atendenteId: c.atendente, statusEnvio: 'failed:131026' })
    expect(await reenviarMensagem(db, as(c.atendente, 'aal1'), antiga)).toEqual({ ok: true, conversationId: id })
    const [m] = await db.select().from(messages).where(eq(messages.id, antiga))
    expect(m!.statusEnvio).toBe('pendente')
  })
})

describe('devolver e encerrar', () => {
  it('devolver: quem assumiu ou gestão; zera atendente e falhas; transições inválidas recusadas', async () => {
    const c = await cenario()
    const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    await db.update(conversations).set({ falhasConsecutivas: 2, handoffMotivo: 'falhas' }).where(eq(conversations.id, id))
    expect(await devolverConversa(db, as(c.atendente2, 'aal1'), id)).toEqual({ ok: false, erro: 'nao_e_seu' })
    expect(await devolverConversa(db, as(c.atendente, 'aal1'), id)).toEqual({ ok: true })
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv).toMatchObject({ estado: 'ia', atendenteId: null, falhasConsecutivas: 0, handoffMotivo: null })
    expect(await devolverConversa(db, as(c.atendente, 'aal1'), id)).toEqual({ ok: false, erro: 'transicao_invalida' })
    const aguardando = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId })
    expect(await devolverConversa(db, as(c.atendente2, 'aal1'), aguardando)).toEqual({ ok: true })
    const acoes = await db.select({ acao: auditLog.acao }).from(auditLog)
    expect(acoes.map((a) => a.acao)).toEqual(['conversa.devolvida_ia', 'conversa.devolvida_ia'])
  })

  it('encerrar: de qualquer estado aberto; de novo ⇒ transicao_invalida; atendente não encerra a de outro', async () => {
    const c = await cenario()
    const daAna = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    expect(await encerrarConversa(db, as(c.atendente2, 'aal1'), daAna)).toEqual({ ok: false, erro: 'nao_e_seu' })
    expect(await encerrarConversa(db, as(c.gerente), daAna)).toEqual({ ok: true })
    expect(await encerrarConversa(db, as(c.gerente), daAna)).toEqual({ ok: false, erro: 'transicao_invalida' })
    const comIa = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'ia' })
    const pendIa = await msg(c.restaurantId, comIa, 'resposta', { direcao: 'out', autor: 'ia', statusEnvio: 'pendente' })
    const enviada = await msg(c.restaurantId, comIa, 'antes', { direcao: 'out', autor: 'ia', statusEnvio: 'enviado' })
    expect(await encerrarConversa(db, as(c.atendente, 'aal1'), comIa)).toEqual({ ok: true })
    const st = await db.select({ id: messages.id, s: messages.statusEnvio }).from(messages).where(eq(messages.conversationId, comIa))
    expect(Object.fromEntries(st.map((x) => [x.id, x.s]))).toEqual({ [pendIa]: 'cancelado', [enviada]: 'enviado' })
    // a despedida do atendente que ainda não saiu continua pendente (o deliver a envia depois de encerrar)
    const minha = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'humano', atendenteId: c.atendente })
    const despedida = await msg(c.restaurantId, minha, 'Obrigado, até mais!', { direcao: 'out', autor: 'humano', atendenteId: c.atendente, statusEnvio: 'pendente' })
    const daIa = await msg(c.restaurantId, minha, 'resposta', { direcao: 'out', autor: 'ia', statusEnvio: 'pendente' })
    expect(await encerrarConversa(db, as(c.atendente, 'aal1'), minha)).toEqual({ ok: true })
    const st2 = await db.select({ id: messages.id, s: messages.statusEnvio }).from(messages).where(eq(messages.conversationId, minha))
    expect(Object.fromEntries(st2.map((x) => [x.id, x.s]))).toEqual({ [despedida]: 'pendente', [daIa]: 'cancelado' })
    const est = await db.select({ e: conversations.estado }).from(conversations).where(and(eq(conversations.restaurantId, c.restaurantId)))
    expect(est.every((x) => x.e === 'encerrada')).toBe(true)
    expect((await db.select().from(auditLog).where(eq(auditLog.acao, 'conversa.encerrada')))).toHaveLength(3)
  })
})

describe('tempoAteAssumirHoje', () => {
  it('mediana em segundos das conversas reais assumidas hoje; nulo sem dados', async () => {
    const c = await cenario()
    expect(await tempoAteAssumirHoje(db, as(c.dono))).toBeNull()
    for (const m of [1, 3, 10]) {
      const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, aguardandoDesde: minutos(m) })
      await assumirConversa(db, as(c.dono), id, {})
    }
    const sim = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, simulada: true, aguardandoDesde: minutos(500) })
    await assumirConversa(db, as(c.dono), sim, {})
    const daIa = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, estado: 'ia' })
    await assumirConversa(db, as(c.dono), daIa, {})
    const t = await tempoAteAssumirHoje(db, as(c.gerente))
    expect(t).toBeGreaterThan(175)
    expect(t).toBeLessThan(190)
  })

  it('gerente restrito vê só as suas unidades; dono vê tudo (inclusive sem unidade)', async () => {
    const c = await cenario()
    for (const m of [1, 3, 10]) {
      const id = await conversa({ restaurantId: c.restaurantId, unitId: c.unitId, aguardandoDesde: minutos(m) })
      await assumirConversa(db, as(c.dono), id, {})
    }
    const doNorte = await conversa({ restaurantId: c.restaurantId, unitId: c.u2, aguardandoDesde: minutos(60) })
    await assumirConversa(db, as(c.dono), doNorte, {})
    const semUnidade = await conversa({ restaurantId: c.restaurantId, unitId: null, aguardandoDesde: minutos(120) })
    await assumirConversa(db, as(c.dono), semUnidade, {})
    const doGerente = await tempoAteAssumirHoje(db, as(c.gerente))
    expect(doGerente).toBeGreaterThan(175)
    expect(doGerente).toBeLessThan(190)
    const doDono = await tempoAteAssumirHoje(db, as(c.dono))
    expect(doDono).toBeGreaterThan(595)
    expect(doDono).toBeLessThan(610)
  })
})

describe('respostas rápidas', () => {
  const v = (titulo: string, ativo = true) => ({ titulo, texto: 'Um momento, vou verificar', ordem: 0, ativo })

  it('gestão cria e edita; atendente só lê; limite de 30 ativas', async () => {
    const c = await cenario()
    const r = await salvarRespostaRapida(db, as(c.gerente), null, v('Um momento'))
    expect(r.ok).toBe(true)
    const id = (r as { valor: { id: string } }).valor.id
    expect(await salvarRespostaRapida(db, as(c.atendente, 'aal1'), null, v('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarRespostaRapida(db, as(c.atendente, 'aal1'), id, v('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarRespostaRapida(db, as(c.dono), id, { ...v('Aguarde'), ordem: 2 })).toEqual({ ok: true, valor: { id } })
    expect(await salvarRespostaRapida(db, as(c.dono), crypto.randomUUID(), v('Y'))).toEqual({ ok: false, erro: 'nao_encontrada' })
    const lidas = await listarRespostasRapidas(db, as(c.atendente, 'aal1'))
    expect(lidas).toEqual([{ id, titulo: 'Aguarde', texto: 'Um momento, vou verificar', ordem: 2, ativo: true }])
    for (let i = 0; i < 29; i++) await salvarRespostaRapida(db, as(c.dono), null, v(`R${i}`))
    expect(await salvarRespostaRapida(db, as(c.dono), null, v('A mais'))).toEqual({ ok: false, erro: 'limite' })
    expect((await salvarRespostaRapida(db, as(c.dono), null, v('Inativa', false))).ok).toBe(true)
    // reeditar uma ativa não conta ela mesma
    expect((await salvarRespostaRapida(db, as(c.dono), id, v('Aguarde 2'))).ok).toBe(true)
    expect(await db.select().from(quickReplies)).toHaveLength(31)
    const audit = await db.select().from(auditLog).where(eq(auditLog.entidade, 'quick_reply'))
    expect(audit.length).toBeGreaterThan(0)
  })
})

describe('horário de atendimento humano', () => {
  it('só o dono salva; grava o jsonb e audita', async () => {
    const c = await cenario()
    const h = { dias: { seg: [{ inicio: '09:00', fim: '18:00' }] } }
    expect(await salvarHorarioHumano(db, as(c.gerente), h)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarioHumano(db, as(c.atendente, 'aal1'), h)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarioHumano(db, as(c.dono, 'aal1'), h)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarioHumano(db, as(c.dono), h)).toEqual({ ok: true, valor: null })
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, c.restaurantId))
    expect(r!.horarioAtendimentoHumano).toEqual(h)
    expect(await db.select().from(auditLog).where(eq(auditLog.acao, 'horario_humano.atualizado'))).toHaveLength(1)
  })
})
