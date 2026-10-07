import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { agoraLocal, decryptPhone } from '@atd/core'
import { ocupadasNoDia, registrarReserva, travarUnidade, vagasSeNaoCouber } from './avisos.ts'
import type { Db } from './client.ts'
import {
  exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel,
} from './painel-comum.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { customers } from './schema/conversation.ts'
import { attendanceNotices } from './schema/s2.ts'
import { TELEFONE_SIMULADO } from './simulador.ts'

const GESTAO = ['dono', 'gerente'] as const
const FUSO_PADRAO = 'America/Sao_Paulo'

export type AvisoPainel = {
  id: string
  unitId: string
  nome: string | null
  pessoas: number
  horarioAprox: string | null
  /** HH:MM:SS da reserva (nulo nos avisos antigos). */
  horario: string | null
  origem: 'ia' | 'painel'
  status: StatusReserva
  simulado: boolean
  /**
   * Há número para o "ver contato": o informado na reserva ou o WhatsApp de um cliente real (o do simulador não é número
   * de verdade). O número em si nunca vem aqui.
   */
  temContato: boolean
}
export type StatusReserva = 'confirmada' | 'cancelada' | 'nao_veio'
/** Erros das ações de reserva no painel: `lotado` traz as vagas que restam. */
export type ErroReservaPainel = ErroPainel | 'transicao_invalida' | 'duplicada'
export type ResultadoReservaPainel<T = null> =
  | ResultadoPainel<T>
  | { ok: false; erro: Exclude<ErroReservaPainel, ErroPainel> }
  | { ok: false; erro: 'lotado'; vagas: number }
export type PrevisaoUnidade = {
  unitId: string
  unidade: string
  totalPessoas: number
  /** Lotação máxima de pessoas por dia; null = sem limite. */
  capacidade: number | null
  /** Pessoas das reservas confirmadas reais (as que contam na lotação real). */
  ocupadas: number
  /** Pessoas das confirmadas do simulador (só aparecem com o modo demonstração; contam lotação só entre si). */
  ocupadasSimulacao: number
  avisos: AvisoPainel[]
}

/** Previsão do dia por unidade ativa visível (mesma ordem do S1). Simulados só no modo demonstração; o total é só de ativos. */
export function previsaoDoDia(
  db: Db,
  claims: JwtClaims,
  p: { data: string; incluirCancelados: boolean },
): Promise<PrevisaoUnidade[]> {
  return withUserContext(db, claims, async (tx) => {
    const us = await tx
      .select({ id: units.id, nome: units.nome, capacidade: units.capacidadePessoas })
      .from(units)
      .where(eq(units.ativo, true))
      .orderBy(asc(units.ordem), asc(units.nome))
    if (us.length === 0) return []
    const modo = await lerModoDemonstracao(tx)
    const rows = await tx
      .select({
        id: attendanceNotices.id, unitId: attendanceNotices.unitId, nome: attendanceNotices.nome,
        pessoas: attendanceNotices.pessoas, horarioAprox: attendanceNotices.horarioAprox, horario: attendanceNotices.horario,
        origem: attendanceNotices.origem, status: attendanceNotices.status, simulado: attendanceNotices.simulado,
        temContato: sql<boolean>`(${attendanceNotices.contatoCifrado} is not null
          or (${attendanceNotices.customerId} is not null and not ${attendanceNotices.simulado}))`,
      })
      .from(attendanceNotices)
      .where(and(
        inArray(attendanceNotices.unitId, us.map((u) => u.id)),
        eq(attendanceNotices.data, p.data),
        filtroSimulacao(attendanceNotices.simulado, modo),
        p.incluirCancelados ? undefined : eq(attendanceNotices.status, 'confirmada'),
      ))
      .orderBy(asc(attendanceNotices.createdAt), asc(attendanceNotices.id))
    const soma = (avisos: AvisoPainel[], f: (a: AvisoPainel) => boolean) =>
      avisos.reduce((s, a) => s + (a.status === 'confirmada' && f(a) ? a.pessoas : 0), 0)
    return us.map((u) => {
      const avisos = rows.filter((r) => r.unitId === u.id)
      return {
        unitId: u.id,
        unidade: u.nome,
        totalPessoas: soma(avisos, () => true),
        capacidade: u.capacidade,
        ocupadas: soma(avisos, (a) => !a.simulado),
        ocupadasSimulacao: soma(avisos, (a) => a.simulado),
        avisos,
      }
    })
  })
}

/** Total de pessoas previstas hoje (fuso do restaurante) nas unidades visíveis ao usuário. */
export function totalPrevistoHoje(db: Db, claims: JwtClaims, agora: Date = new Date()): Promise<number> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
    const hoje = agoraLocal(agora, r?.tz ?? FUSO_PADRAO).data
    const [t] = await tx
      .select({ total: sql<number>`coalesce(sum(${attendanceNotices.pessoas}), 0)::int` })
      .from(attendanceNotices)
      .innerJoin(units, and(eq(units.id, attendanceNotices.unitId), eq(units.ativo, true)))
      .where(and(
        eq(attendanceNotices.data, hoje),
        eq(attendanceNotices.status, 'confirmada'),
        filtroSimulacao(attendanceNotices.simulado, await lerModoDemonstracao(tx)),
      ))
    return t?.total ?? 0
  })
}

/**
 * Cria a reserva pelo painel (dono/gerente da unidade), com nome e horário, passando pela lotação do dia com a unidade
 * travada (só reservas reais contam: o painel cria `simulado = false`).
 */
export function criarAvisoPainel(
  db: Db,
  claims: JwtClaims,
  p: { unitId: string; data: string; pessoas: number; horario: string; nome: string; contatoCifrado?: string | null },
): Promise<ResultadoReservaPainel<{ id: string }>> {
  return semPermissaoVira<ResultadoReservaPainel<{ id: string }>, never>(() => withUserContext(db, claims, async (tx): Promise<ResultadoReservaPainel<{ id: string }>> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const rows = await tx.execute<{ rid: string | null }>(sql`select app.my_restaurant_id() as rid`)
    const restaurantId = rows[0]?.rid
    if (!restaurantId) return falha('sem_permissao')
    // unidade fora do acesso do usuário: a trava não acha a linha, porque o FOR UPDATE do authenticated passa pela policy
    // `gestao_write` de units (0016: restaurante, papel dono/gerente e acesso à unidade) ⇒ sem permissão, antes de
    // qualquer conta de lotação (a capacidade de outra unidade nunca vaza)
    if (!(await travarUnidade(tx, restaurantId, p.unitId))) return falha('sem_permissao')
    const r = await registrarReserva(tx, {
      restaurantId, unitId: p.unitId, customerId: null, data: p.data, pessoas: p.pessoas, horario: p.horario, nome: p.nome,
      contatoCifrado: p.contatoCifrado ?? null, simulado: false, origem: 'painel', criadoPor: claims.sub,
    })
    if (!r.ok && r.motivo === 'lotado') return { ok: false, erro: 'lotado', vagas: r.vagas }
    if (!r.ok) throw new Error(r.motivo) // sem cliente nem reservaId: só pode ser lotado
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'aviso.criado_painel', entidade: 'attendance_notice', entidadeId: r.id,
      diff: { unitId: p.unitId, data: p.data, pessoas: p.pessoas, horario: p.horario },
    })
    return ok({ id: r.id })
  }))
}

/**
 * Muda o status da reserva (dono/gerente da unidade, auditado `reserva.status` sem PII). `cancelada` e `nao_veio` liberam a
 * vaga na hora; reconfirmar passa pela lotação com a unidade travada (só reservas com o mesmo `simulado`). Confirmar e
 * cancelar valem de hoje em diante (fuso do restaurante); "não veio" só no dia ou depois, e um "não veio" marcado por
 * engano volta a Confirmada mesmo num dia passado (pela lotação). Simulada só com o modo demonstração ligado.
 * Travas na mesma ordem do worker: a unidade antes da linha da reserva (ordem oposta faria deadlock).
 */
export function mudarStatusReserva(
  db: Db,
  claims: JwtClaims,
  reservaId: string,
  status: StatusReserva,
  agora: Date = new Date(),
): Promise<ResultadoReservaPainel> {
  return semPermissaoVira(
    () => withUserContext(db, claims, async (tx): Promise<ResultadoReservaPainel> => {
      // UPDATE que a policy filtra não dá erro: o papel é conferido antes
      if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
      const modo = await lerModoDemonstracao(tx)
      const ler = (travar: boolean) => {
        const q = tx
          .select({
            restaurantId: attendanceNotices.restaurantId, unitId: attendanceNotices.unitId, data: attendanceNotices.data,
            pessoas: attendanceNotices.pessoas, status: attendanceNotices.status, simulado: attendanceNotices.simulado,
          })
          .from(attendanceNotices)
          .where(and(eq(attendanceNotices.id, reservaId), filtroSimulacao(attendanceNotices.simulado, modo)))
        return travar ? q.for('update') : q // RLS de update: só a unidade de quem pede
      }
      // reconfirmar: a unidade é travada antes da reserva (a unidade vem de uma leitura sem trava)
      let unidade: { unitId: string; capacidade: number | null } | null = null
      if (status === 'confirmada') {
        const [antes] = await ler(false)
        if (!antes) return falha('nao_encontrada')
        const t = await travarUnidade(tx, antes.restaurantId, antes.unitId)
        if (!t) return falha('nao_encontrada')
        unidade = { unitId: antes.unitId, capacidade: t.capacidade }
      }
      const [atual] = await ler(true)
      if (!atual) return falha('nao_encontrada')
      if (atual.status === status) return ok(null)
      const [rest] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
      const hoje = agoraLocal(agora, rest?.tz ?? FUSO_PADRAO).data
      const desfazNaoVeio = status === 'confirmada' && atual.status === 'nao_veio'
      if (!desfazNaoVeio && (status === 'nao_veio' ? atual.data > hoje : atual.data < hoje)) return { ok: false, erro: 'transicao_invalida' }
      if (status === 'confirmada') {
        // a reserva mudou de unidade entre as leituras (o worker a moveu): trava a nova também
        const t = unidade?.unitId === atual.unitId ? unidade : await travarUnidade(tx, atual.restaurantId, atual.unitId)
        if (!t) return falha('nao_encontrada')
        const ocupadas = await ocupadasNoDia(tx, { ...atual, excluirId: reservaId })
        const vagas = vagasSeNaoCouber(t.capacidade, ocupadas, atual.pessoas)
        if (vagas !== null) return { ok: false, erro: 'lotado', vagas }
      }
      await tx.update(attendanceNotices).set({ status, updatedAt: sql`now()` }).where(eq(attendanceNotices.id, reservaId))
      await registrarAuditoria(tx, claims, {
        restaurantId: atual.restaurantId, acao: 'reserva.status', entidade: 'attendance_notice', entidadeId: reservaId,
        diff: { de: atual.status, para: status },
      })
      return ok(null)
    }),
    // o cliente já tem outra reserva confirmada na unidade e no dia (índice único parcial)
    { attendance_ativo_uq: 'duplicada' as const },
  )
}

/**
 * "Ver contato" da reserva: o número informado (decifrado) ou, sem ele, o WhatsApp do cliente. Só para quem vê a
 * unidade (RLS), auditado `reserva.contato_visualizado` sem o número. Nunca logar o número.
 */
export function revelarContatoReserva(
  db: Db,
  claims: JwtClaims,
  reservaId: string,
  phoneKey: Buffer,
): Promise<ResultadoPainel<{ telefone: string; origem: 'informado' | 'whatsapp' }>> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ restaurantId: attendanceNotices.restaurantId, contato: attendanceNotices.contatoCifrado, whatsapp: customers.telefoneCifrado })
      .from(attendanceNotices)
      .leftJoin(customers, eq(customers.id, attendanceNotices.customerId))
      .where(and(eq(attendanceNotices.id, reservaId), filtroSimulacao(attendanceNotices.simulado, await lerModoDemonstracao(tx))))
    if (!r) return falha('nao_encontrada')
    const origem = r.contato ? 'informado' : 'whatsapp'
    const cifrado = r.contato ?? r.whatsapp
    if (!cifrado || cifrado === TELEFONE_SIMULADO) return falha('nao_encontrada')
    const telefone = decryptPhone(cifrado, phoneKey)
    await registrarAuditoria(tx, claims, {
      restaurantId: r.restaurantId, acao: 'reserva.contato_visualizado', entidade: 'attendance_notice', entidadeId: reservaId,
    })
    return ok({ telefone, origem })
  })
}
