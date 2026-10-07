import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { decryptPhone } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { customers } from './schema/conversation.ts'
import { dataSubjectRequests, retentionSettings } from './schema/ops.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'

const GESTAO = ['dono', 'gerente'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FINAIS = ['concluido', 'negado'] as const

export type StatusDsr = 'aberto' | 'em_andamento' | 'concluido' | 'negado'
export type TipoDsr = 'acesso' | 'exclusao' | 'correcao'
export type PedidoTitular = {
  id: string
  tipo: TipoDsr
  status: StatusDsr
  prazo: Date
  criadoEm: Date
  /** false: o cliente já foi apagado (ou o pedido nasceu sem vínculo). */
  temCliente: boolean
  resposta: string | null
  resolvidoPor: string | null
}
/** Resumo para o titular: sem telefone (só sob clique, auditado) nem notas internas. Datas em ISO UTC. */
export type ResumoTitular = {
  pedidoId: string
  nomePerfil: string | null
  primeiraInteracao: string
  ultimaInteracao: string
  conversas: number
  mensagens: number
  /**
   * Reservas com nome e horário (null nos avisos antigos); `contatoInformado`: há um telefone de contato informado
   * (guardado cifrado) — o número em si nunca sai no resumo.
   */
  avisos: {
    data: string; pessoas: number; status: string; unidade: string; nome: string | null; horario: string | null; contatoInformado: boolean
  }[]
  eventos: { data: string; convidados: number; tipo: string; status: string; unidade: string }[]
  pedidos: { tipo: TipoDsr; status: StatusDsr; criadoEm: string }[]
}
export const DADOS_RETENCAO = ['messages', 'attendance_notices', 'event_requests', 'ai_runs', 'customers_inativos', 'audit_log'] as const
export type DadoRetencao = (typeof DADOS_RETENCAO)[number]
export type RetencaoPainel = { dado: DadoRetencao; dias: number; acao: 'apagar' | 'anonimizar'; minimo: number }
export type ErroPrivacidade = ErroPainel | 'transicao_invalida' | 'valor_invalido'
export type ResultadoPrivacidade<T = null> = ResultadoPainel<T> | { ok: false; erro: ErroPrivacidade }

/** Mínimos de retenção (mesma regra do check `retention_dias_minimo`); máximo de 10 anos. */
export const minimoRetencao = (dado: DadoRetencao) => (dado === 'messages' ? 7 : 30)
export const MAXIMO_RETENCAO = 3650

const comoApp = (tx: Tx) => tx.execute(sql`set local role web_app`)
const comoUsuario = (tx: Tx) => tx.execute(sql`set local role authenticated`)
const nada = <T>(): Promise<T> => Promise.resolve({ ok: false, erro: 'nao_encontrada' } as T)

/** Fila de pedidos do titular por prazo (dono/gerente com MFA; os demais recebem lista vazia pela RLS). */
export function listarPedidosTitular(db: Db, claims: JwtClaims, p: { status?: StatusDsr[] }): Promise<PedidoTitular[]> {
  if (p.status && p.status.length === 0) return Promise.resolve([])
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: dataSubjectRequests.id, tipo: dataSubjectRequests.tipo, status: dataSubjectRequests.status, prazo: dataSubjectRequests.prazo,
        criadoEm: dataSubjectRequests.createdAt, temCliente: sql<boolean>`(${dataSubjectRequests.customerId} is not null)`,
        resposta: dataSubjectRequests.resposta, resolvidoPor: dataSubjectRequests.resolvidoPor,
      })
      .from(dataSubjectRequests)
      .where(and(
        sql`${dataSubjectRequests.restaurantId} = (select app.my_restaurant_id())`,
        p.status ? inArray(dataSubjectRequests.status, p.status) : undefined,
      ))
      .orderBy(asc(dataSubjectRequests.prazo), asc(dataSubjectRequests.createdAt)),
  )
}

type PedidoAtual = { restaurantId: string; customerId: string | null; tipo: TipoDsr; status: StatusDsr }
async function pedidoVisivel(tx: Tx, id: string, travar: boolean): Promise<PedidoAtual | null> {
  const q = tx
    .select({
      restaurantId: dataSubjectRequests.restaurantId, customerId: dataSubjectRequests.customerId, tipo: dataSubjectRequests.tipo,
      status: dataSubjectRequests.status,
    })
    .from(dataSubjectRequests)
    .where(eq(dataSubjectRequests.id, id)) // RLS: só dono/gerente com MFA do restaurante
  const [p] = travar ? await q.for('update') : await q
  return p ?? null
}

/**
 * Monta o resumo de acesso do cliente do pedido (tudo do cliente no restaurante, pela função `app.resumo_titular`).
 * Pedido invisível, sem cliente ou cliente apagado ⇒ null. Auditado sem PII.
 */
export function resumoAcessoTitular(db: Db, claims: JwtClaims, pedidoId: string): Promise<ResumoTitular | null> {
  if (!UUID.test(pedidoId)) return Promise.resolve(null)
  return withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return null
    const p = await pedidoVisivel(tx, pedidoId, false)
    if (!p?.customerId) return null
    await comoApp(tx)
    const [r] = await tx.execute<{ r: Omit<ResumoTitular, 'pedidoId'> | null }>(
      sql`select app.resumo_titular(${p.customerId}::uuid, ${p.restaurantId}::uuid) as r`)
    await comoUsuario(tx)
    if (!r?.r) return null
    await registrarAuditoria(tx, claims, {
      restaurantId: p.restaurantId, acao: 'lgpd.resumo_gerado', entidade: 'data_subject_request', entidadeId: pedidoId,
    })
    return { pedidoId, ...r.r }
  })
}

/** "Mostrar telefone" do cliente do pedido: dono/gerente, auditado (sem o número). Nunca logar o número. */
export function revelarTelefoneTitular(
  db: Db,
  claims: JwtClaims,
  pedidoId: string,
  phoneKey: Buffer,
): Promise<ResultadoPainel<{ telefone: string }>> {
  if (!UUID.test(pedidoId)) return nada()
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ restaurantId: dataSubjectRequests.restaurantId, cifrado: customers.telefoneCifrado })
      .from(dataSubjectRequests)
      .innerJoin(customers, eq(customers.id, dataSubjectRequests.customerId))
      .where(eq(dataSubjectRequests.id, pedidoId))
    if (!r || r.cifrado === TELEFONE_SIMULADO) return falha('nao_encontrada')
    const telefone = decryptPhone(r.cifrado, phoneKey)
    await registrarAuditoria(tx, claims, {
      restaurantId: r.restaurantId, acao: 'lgpd.telefone_visualizado', entidade: 'data_subject_request', entidadeId: pedidoId,
    })
    return ok({ telefone })
  })
}

/** Conclui o pedido de acesso (depois de entregar o resumo). Só pedido de acesso em aberto. */
export function concluirAcesso(db: Db, claims: JwtClaims, pedidoId: string): Promise<ResultadoPrivacidade> {
  if (!UUID.test(pedidoId)) return nada()
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoPrivacidade> => {
    const p = await pedidoVisivel(tx, pedidoId, true)
    if (!p) return falha('nao_encontrada')
    if (p.tipo !== 'acesso' || (FINAIS as readonly string[]).includes(p.status)) return { ok: false, erro: 'transicao_invalida' }
    await tx.update(dataSubjectRequests).set({ status: 'concluido', resolvidoPor: claims.sub }).where(eq(dataSubjectRequests.id, pedidoId))
    await registrarAuditoria(tx, claims, {
      restaurantId: p.restaurantId, acao: 'lgpd.acesso_concluido', entidade: 'data_subject_request', entidadeId: pedidoId,
    })
    return ok(null)
  }))
}

/**
 * Executa a exclusão do titular (confirmação dupla na tela): `app.excluir_titular` apaga/anonimiza em cascata, o
 * pedido fica `concluido` e a auditoria guarda só as contagens. Cliente já inexistente ⇒ conclui com contagens vazias.
 */
export function executarExclusao(
  db: Db,
  claims: JwtClaims,
  pedidoId: string,
): Promise<ResultadoPrivacidade<{ contagens: Record<string, number> }>> {
  if (!UUID.test(pedidoId)) return nada()
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoPrivacidade<{ contagens: Record<string, number> }>> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('nao_encontrada')
    const p = await pedidoVisivel(tx, pedidoId, true)
    if (!p) return falha('nao_encontrada')
    if (p.tipo !== 'exclusao' || (FINAIS as readonly string[]).includes(p.status)) return { ok: false, erro: 'transicao_invalida' }
    let contagens: Record<string, number> = {}
    if (p.customerId) {
      await comoApp(tx)
      const [r] = await tx.execute<{ r: Record<string, number | boolean> }>(
        sql`select app.excluir_titular(${p.customerId}::uuid, ${claims.sub}::uuid) as r`)
      await comoUsuario(tx)
      if (r && !('ja_inexistente' in r.r)) contagens = r.r as Record<string, number>
    }
    await tx.update(dataSubjectRequests).set({ status: 'concluido', resolvidoPor: claims.sub }).where(eq(dataSubjectRequests.id, pedidoId))
    await registrarAuditoria(tx, claims, {
      restaurantId: p.restaurantId, acao: 'lgpd.exclusao_executada', entidade: 'data_subject_request', entidadeId: pedidoId,
      diff: contagens,
    })
    return ok({ contagens })
  }))
}

/**
 * Conclui o pedido de correção (a equipe corrige o dado por fora, p.ex. o nome do perfil) com resposta curta
 * (1–300 caracteres, sem PII — a tela orienta). A resposta não vai para a auditoria.
 */
export function concluirCorrecao(db: Db, claims: JwtClaims, pedidoId: string, resposta: string): Promise<ResultadoPrivacidade> {
  const texto = resposta.trim()
  if (texto.length === 0 || [...texto].length > 300) return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  if (!UUID.test(pedidoId)) return nada()
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoPrivacidade> => {
    const p = await pedidoVisivel(tx, pedidoId, true)
    if (!p) return falha('nao_encontrada')
    if (p.tipo !== 'correcao' || (FINAIS as readonly string[]).includes(p.status)) return { ok: false, erro: 'transicao_invalida' }
    await tx.update(dataSubjectRequests).set({ status: 'concluido', resposta: texto, resolvidoPor: claims.sub }).where(eq(dataSubjectRequests.id, pedidoId))
    await registrarAuditoria(tx, claims, {
      restaurantId: p.restaurantId, acao: 'lgpd.correcao_concluida', entidade: 'data_subject_request', entidadeId: pedidoId,
    })
    return ok(null)
  }))
}

/** Nega o pedido com resposta curta (1–300 caracteres, sem PII — a tela orienta). A resposta não vai para a auditoria. */
export function negarPedido(db: Db, claims: JwtClaims, pedidoId: string, resposta: string): Promise<ResultadoPrivacidade> {
  const texto = resposta.trim()
  if (texto.length === 0 || [...texto].length > 300) return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  if (!UUID.test(pedidoId)) return nada()
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoPrivacidade> => {
    const p = await pedidoVisivel(tx, pedidoId, true)
    if (!p) return falha('nao_encontrada')
    if ((FINAIS as readonly string[]).includes(p.status)) return { ok: false, erro: 'transicao_invalida' }
    await tx.update(dataSubjectRequests).set({ status: 'negado', resposta: texto, resolvidoPor: claims.sub }).where(eq(dataSubjectRequests.id, pedidoId))
    await registrarAuditoria(tx, claims, {
      restaurantId: p.restaurantId, acao: 'lgpd.pedido_negado', entidade: 'data_subject_request', entidadeId: pedidoId,
    })
    return ok(null)
  }))
}

/** Prazos de retenção editáveis (o áudio é fixo: descartado após transcrever). Dono/gerente; atendente: vazio. */
export function lerRetencao(db: Db, claims: JwtClaims): Promise<RetencaoPainel[]> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select({ dado: retentionSettings.dado, dias: retentionSettings.dias, acao: retentionSettings.acao })
      .from(retentionSettings)
      .where(and(sql`${retentionSettings.restaurantId} = (select app.my_restaurant_id())`, inArray(retentionSettings.dado, [...DADOS_RETENCAO])))
    const ordem = (d: string) => DADOS_RETENCAO.indexOf(d as DadoRetencao)
    return rows
      .sort((a, b) => ordem(a.dado) - ordem(b.dado))
      .map((r) => ({ ...r, dado: r.dado as DadoRetencao, minimo: minimoRetencao(r.dado as DadoRetencao) }))
  })
}

/** Só o dono. Dias inteiros entre o mínimo do dado e 10 anos. Auditado (antigo/novo). */
export function salvarRetencao(db: Db, claims: JwtClaims, v: { dado: DadoRetencao; dias: number }): Promise<ResultadoPrivacidade> {
  if (!DADOS_RETENCAO.includes(v.dado) || !Number.isInteger(v.dias) || v.dias < minimoRetencao(v.dado) || v.dias > MAXIMO_RETENCAO) {
    return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  }
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoPrivacidade> => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [atual] = await tx
      .select({ restaurantId: retentionSettings.restaurantId, dias: retentionSettings.dias })
      .from(retentionSettings)
      .where(and(sql`${retentionSettings.restaurantId} = (select app.my_restaurant_id())`, eq(retentionSettings.dado, v.dado)))
      .for('update')
    if (!atual) return falha('nao_encontrada')
    await tx.update(retentionSettings).set({ dias: v.dias, updatedAt: sql`now()` })
      .where(and(eq(retentionSettings.restaurantId, atual.restaurantId), eq(retentionSettings.dado, v.dado)))
    await registrarAuditoria(tx, claims, {
      restaurantId: atual.restaurantId, acao: 'retencao.prazo_alterado', entidade: 'retention_setting', entidadeId: v.dado,
      diff: { dado: v.dado, de: atual.dias, para: v.dias },
    })
    return ok(null)
  }))
}
