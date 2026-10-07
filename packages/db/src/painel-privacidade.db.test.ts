import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { encryptPhone } from '@atd/core'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  concluirAcesso, concluirCorrecao, executarExclusao, lerRetencao, listarPedidosTitular, negarPedido, resumoAcessoTitular, revelarTelefoneTitular,
  salvarRetencao,
} from './painel-privacidade.ts'
import {
  attendanceNotices, auditLog, conversations, customers, dataSubjectRequests, eventRequests, messages, retentionSettings,
} from './schema/index.ts'
import { DEFAULT_RETENTION } from './bootstrap.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const KEY = randomBytes(32)
const TELEFONE = '5561988887777'

async function cenario() {
  const { restaurantId, unitId } = await seedRestaurant(db)
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [cli] = await db.insert(customers).values({
    restaurantId, waIdHash: 'h1', telefoneCifrado: encryptPhone(TELEFONE, KEY), nomePerfil: 'Maria',
    createdAt: new Date('2026-08-01T12:00:00Z'), ultimaInteracaoAt: new Date('2026-10-05T12:00:00Z'),
  }).returning()
  const [cv] = await db.insert(conversations).values({ restaurantId, customerId: cli!.id, estado: 'humano' }).returning()
  await db.insert(messages).values([1, 2, 3].map((i) => ({
    restaurantId, conversationId: cv!.id, direcao: 'in' as const, autor: 'cliente' as const, tipo: 'texto' as const, texto: `msg ${i}`,
  })))
  await db.insert(attendanceNotices).values({ restaurantId, unitId, customerId: cli!.id, nome: 'Maria', data: '2026-10-10', pessoas: 4, origem: 'ia' })
  await db.insert(eventRequests).values({
    restaurantId, unitId, customerId: cli!.id, nome: 'Maria', data: '2026-11-20', convidados: 40, tipo: 'aniversario',
    notasInternas: 'cliente difícil', status: 'confirmado',
  })
  const [anterior] = await db.insert(dataSubjectRequests).values({
    restaurantId, customerId: cli!.id, tipo: 'correcao', status: 'concluido', createdAt: new Date('2026-09-01T12:00:00Z'),
    prazo: new Date('2026-09-16T12:00:00Z'),
  }).returning()
  const [acesso] = await db.insert(dataSubjectRequests).values({ restaurantId, customerId: cli!.id, tipo: 'acesso', prazo: new Date('2026-10-10T12:00:00Z') }).returning()
  const [exclusao] = await db.insert(dataSubjectRequests).values({ restaurantId, customerId: cli!.id, tipo: 'exclusao', prazo: new Date('2026-10-08T12:00:00Z') }).returning()
  return { restaurantId, unitId, dono, gerente, atendente, cli: cli!, cv: cv!, anterior: anterior!, acesso: acesso!, exclusao: exclusao! }
}
const logs = (acao: string) => db.select().from(auditLog).where(eq(auditLog.acao, acao))

describe('fila do titular', () => {
  it('lista por prazo, filtra por status; atendente e outro restaurante não veem', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    await db.insert(dataSubjectRequests).values({ restaurantId: b.restaurantId, tipo: 'acesso' })
    const todos = await listarPedidosTitular(db, as(c.gerente), {})
    expect(todos.map((p) => p.tipo)).toEqual(['correcao', 'exclusao', 'acesso'])
    expect(todos[1]).toEqual({
      id: c.exclusao.id, tipo: 'exclusao', status: 'aberto', prazo: new Date('2026-10-08T12:00:00Z'), criadoEm: expect.any(Date),
      temCliente: true, resposta: null, resolvidoPor: null,
    })
    expect((await listarPedidosTitular(db, as(c.dono), { status: ['aberto', 'em_andamento'] })).map((p) => p.id)).toEqual([c.exclusao.id, c.acesso.id])
    expect(await listarPedidosTitular(db, as(c.atendente, 'aal1'), {})).toEqual([])
    expect(await listarPedidosTitular(db, as(c.dono, 'aal1'), {})).toEqual([])
  })
})

describe('acesso', () => {
  it('resumo completo sem telefone nem notas internas; auditado sem PII', async () => {
    const c = await cenario()
    const r = await resumoAcessoTitular(db, as(c.gerente), c.acesso.id)
    expect(r).toEqual({
      pedidoId: c.acesso.id,
      nomePerfil: 'Maria',
      primeiraInteracao: '2026-08-01T12:00:00Z',
      ultimaInteracao: '2026-10-05T12:00:00Z',
      conversas: 1,
      mensagens: 3,
      avisos: [{ data: '2026-10-10', pessoas: 4, status: 'confirmada', unidade: 'Asa Sul' }],
      eventos: [{ data: '2026-11-20', convidados: 40, tipo: 'aniversario', status: 'confirmado', unidade: 'Asa Sul' }],
      pedidos: [
        { tipo: 'correcao', status: 'concluido', criadoEm: '2026-09-01T12:00:00Z' },
        { tipo: 'acesso', status: 'aberto', criadoEm: expect.any(String) },
        { tipo: 'exclusao', status: 'aberto', criadoEm: expect.any(String) },
      ],
    })
    expect(JSON.stringify(r)).not.toContain('difícil')
    expect(JSON.stringify(r)).not.toContain(TELEFONE)
    const [log] = await logs('lgpd.resumo_gerado')
    expect(log).toMatchObject({ entidade: 'data_subject_request', entidadeId: c.acesso.id, diff: null })
  })

  it('resumo: atendente, pedido de outro restaurante ou sem cliente ⇒ null', async () => {
    const c = await cenario()
    expect(await resumoAcessoTitular(db, as(c.atendente, 'aal1'), c.acesso.id)).toBeNull()
    const [semCliente] = await db.insert(dataSubjectRequests).values({ restaurantId: c.restaurantId, tipo: 'acesso' }).returning()
    expect(await resumoAcessoTitular(db, as(c.dono), semCliente!.id)).toBeNull()
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    expect(await resumoAcessoTitular(db, as(donoB), c.acesso.id)).toBeNull()
    expect(await logs('lgpd.resumo_gerado')).toHaveLength(0)
  })

  it('mostrar telefone: só dono/gerente, auditado sem o número', async () => {
    const c = await cenario()
    expect(await revelarTelefoneTitular(db, as(c.dono), c.acesso.id, KEY)).toEqual({ ok: true, valor: { telefone: TELEFONE } })
    expect(await revelarTelefoneTitular(db, as(c.atendente, 'aal1'), c.acesso.id, KEY)).toEqual({ ok: false, erro: 'nao_encontrada' })
    const [log] = await logs('lgpd.telefone_visualizado')
    expect(JSON.stringify(log)).not.toContain(TELEFONE)
  })

  it('concluirAcesso: marca concluído com resolvido_por; só pedido de acesso aberto; atendente não', async () => {
    const c = await cenario()
    expect(await concluirAcesso(db, as(c.atendente, 'aal1'), c.acesso.id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await concluirAcesso(db, as(c.gerente), c.exclusao.id)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await concluirAcesso(db, as(c.gerente), c.acesso.id)).toEqual({ ok: true, valor: null })
    const [p] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, c.acesso.id))
    expect(p).toMatchObject({ status: 'concluido', resolvidoPor: c.gerente })
    expect(await concluirAcesso(db, as(c.gerente), c.acesso.id)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect((await logs('lgpd.acesso_concluido')).map((l) => l.diff)).toEqual([null])
  })
})

describe('exclusão', () => {
  it('apaga em cascata, conclui o pedido e audita só contagens; conversa humana e evento confirmado não quebram', async () => {
    const c = await cenario()
    const r = await executarExclusao(db, as(c.gerente), c.exclusao.id)
    expect(r).toEqual({ ok: true, valor: { contagens: { mensagens: 3, conversas: 1, avisos: 1, eventos: 1 } } })
    expect(await db.select().from(customers)).toHaveLength(0)
    expect(await db.select().from(conversations)).toHaveLength(0)
    const [ev] = await db.select().from(eventRequests)
    expect(ev).toMatchObject({ nome: null, customerId: null, notasInternas: null, anonimizado: true, status: 'confirmado' })
    const [p] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, c.exclusao.id))
    expect(p).toMatchObject({ status: 'concluido', resolvidoPor: c.gerente, customerId: null })
    const [log] = await logs('lgpd.exclusao_executada')
    expect(log!.diff).toEqual({ mensagens: 3, conversas: 1, avisos: 1, eventos: 1 })
    expect(JSON.stringify(log)).not.toContain('Maria')
    // os outros pedidos do mesmo cliente perdem o vínculo e seguem na fila
    const [acesso] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, c.acesso.id))
    expect(acesso).toMatchObject({ status: 'aberto', customerId: null })
  })

  it('cliente já inexistente: conclui sem erro; pedido já concluído ou de outro tipo: transicao_invalida', async () => {
    const c = await cenario()
    const [outro] = await db.insert(dataSubjectRequests).values({ restaurantId: c.restaurantId, tipo: 'exclusao' }).returning()
    expect(await executarExclusao(db, as(c.dono), outro!.id)).toEqual({ ok: true, valor: { contagens: {} } })
    expect(await executarExclusao(db, as(c.dono), outro!.id)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await executarExclusao(db, as(c.dono), c.acesso.id)).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await db.select().from(customers)).toHaveLength(1)
  })

  it('atendente, dono sem MFA ou de outro restaurante não excluem', async () => {
    const c = await cenario()
    const b = await seedRestaurant(db)
    const donoB = await seedStaff(db, sql, { restaurantId: b.restaurantId, papel: 'dono' })
    expect(await executarExclusao(db, as(c.atendente, 'aal1'), c.exclusao.id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await executarExclusao(db, as(c.dono, 'aal1'), c.exclusao.id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await executarExclusao(db, as(donoB), c.exclusao.id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await db.select().from(customers)).toHaveLength(1)
  })
})

describe('correção', () => {
  it('concluirCorrecao: só pedido de correção em aberto; resposta curta obrigatória; auditoria sem o texto', async () => {
    const c = await cenario()
    const [cor] = await db.insert(dataSubjectRequests).values({ restaurantId: c.restaurantId, customerId: c.cli.id, tipo: 'correcao' }).returning()
    expect(await concluirCorrecao(db, as(c.gerente), cor!.id, ' ')).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await concluirCorrecao(db, as(c.gerente), cor!.id, 'x'.repeat(301))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await concluirCorrecao(db, as(c.gerente), c.acesso.id, 'Nome corrigido')).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await concluirCorrecao(db, as(c.atendente, 'aal1'), cor!.id, 'Nome corrigido')).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await concluirCorrecao(db, as(c.gerente), cor!.id, ' Nome de perfil corrigido ')).toEqual({ ok: true, valor: null })
    const [p] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, cor!.id))
    expect(p).toMatchObject({ status: 'concluido', resposta: 'Nome de perfil corrigido', resolvidoPor: c.gerente })
    expect(await concluirCorrecao(db, as(c.gerente), cor!.id, 'de novo')).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect((await logs('lgpd.correcao_concluida')).map((l) => l.diff)).toEqual([null])
  })
})

describe('negar', () => {
  it('marca negado com resposta curta; auditoria sem o texto', async () => {
    const c = await cenario()
    expect(await negarPedido(db, as(c.dono), c.acesso.id, 'Identidade não confirmada')).toEqual({ ok: true, valor: null })
    const [p] = await db.select().from(dataSubjectRequests).where(eq(dataSubjectRequests.id, c.acesso.id))
    expect(p).toMatchObject({ status: 'negado', resposta: 'Identidade não confirmada', resolvidoPor: c.dono })
    expect((await logs('lgpd.pedido_negado'))[0]!.diff).toBeNull()
    expect(await negarPedido(db, as(c.dono), c.acesso.id, 'de novo')).toEqual({ ok: false, erro: 'transicao_invalida' })
    expect(await negarPedido(db, as(c.dono), c.exclusao.id, ' ')).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await negarPedido(db, as(c.dono), c.exclusao.id, 'x'.repeat(301))).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await negarPedido(db, as(c.atendente, 'aal1'), c.exclusao.id, 'não')).toEqual({ ok: false, erro: 'nao_encontrada' })
  })
})

describe('retenção (prazos)', () => {
  it('lerRetencao: dono/gerente veem os prazos; salvarRetencao: só o dono, com mínimos, auditado', async () => {
    const c = await cenario()
    await db.insert(retentionSettings).values(DEFAULT_RETENTION.map((r) => ({ ...r, restaurantId: c.restaurantId })))
    const l = await lerRetencao(db, as(c.gerente))
    expect(l.map((r) => [r.dado, r.dias, r.acao])).toEqual([
      ['messages', 90, 'apagar'], ['attendance_notices', 30, 'anonimizar'], ['event_requests', 730, 'anonimizar'],
      ['ai_runs', 395, 'apagar'], ['customers_inativos', 365, 'apagar'], ['audit_log', 730, 'apagar'],
    ])
    expect(await lerRetencao(db, as(c.atendente, 'aal1'))).toEqual([])
    expect(await salvarRetencao(db, as(c.dono), { dado: 'messages', dias: 7 })).toEqual({ ok: true, valor: null })
    expect(await salvarRetencao(db, as(c.dono), { dado: 'messages', dias: 6 })).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRetencao(db, as(c.dono), { dado: 'audit_log', dias: 29 })).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRetencao(db, as(c.dono), { dado: 'audit_log', dias: 3651 })).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRetencao(db, as(c.dono), { dado: 'audio' as never, dias: 30 })).toEqual({ ok: false, erro: 'valor_invalido' })
    expect(await salvarRetencao(db, as(c.gerente), { dado: 'messages', dias: 60 })).toEqual({ ok: false, erro: 'sem_permissao' })
    const [log] = await logs('retencao.prazo_alterado')
    expect(log!.diff).toEqual({ dado: 'messages', de: 90, para: 7 })
  })
})
