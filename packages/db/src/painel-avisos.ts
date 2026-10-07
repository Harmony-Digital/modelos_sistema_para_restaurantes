import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
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
}
export type StatusReserva = 'confirmada' | 'cancelada' | 'nao_veio'
/** Erros das ações de reserva no painel: `lotado` traz as vagas que restam. */
export type ErroReservaPainel = ErroPainel | 'transicao_invalida' | 'duplicada'
export type ResultadoReservaPainel<T = null> =
  | ResultadoPainel<T>
  | { ok: false; erro: Exclude<ErroReservaPainel, ErroPainel> }
  | { ok: false; erro: 'lotado'; vagas: number }
export type PrevisaoUnidade = { unitId: string; unidade: string; totalPessoas: number; avisos: AvisoPainel[] }

/** Previsão do dia por unidade ativa visível (mesma ordem do S1). Simulados só no modo demonstração; o total é só de ativos. */
export function previsaoDoDia(
  db: Db,
  claims: JwtClaims,
  p: { data: string; incluirCancelados: boolean },
): Promise<PrevisaoUnidade[]> {
  return withUserContext(db, claims, async (tx) => {
    const us = await tx
      .select({ id: units.id, nome: units.nome })
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
      })
      .from(attendanceNotices)
      .where(and(
        inArray(attendanceNotices.unitId, us.map((u) => u.id)),
        eq(attendanceNotices.data, p.data),
        filtroSimulacao(attendanceNotices.simulado, modo),
        p.incluirCancelados ? undefined : eq(attendanceNotices.status, 'confirmada'),
      ))
      .orderBy(asc(attendanceNotices.createdAt), asc(attendanceNotices.id))
    return us.map((u) => {
      const avisos = rows.filter((r) => r.unitId === u.id)
      return {
        unitId: u.id,
        unidade: u.nome,
        totalPessoas: avisos.reduce((s, a) => s + (a.status === 'confirmada' ? a.pessoas : 0), 0),
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
 * Cria a reserva pelo painel (dono/gerente da unidade), passando pela lotação do dia com a unidade travada (só reservas
 * reais contam: o painel cria `simulado = false`). Sem `horario`/`nome` grava como o aviso antigo (Task 5 exige ambos).
 */
export function criarAvisoPainel(
  db: Db,
  claims: JwtClaims,
  p: {
    unitId: string; data: string; pessoas: number; horarioAprox: string | null; nome: string | null
    horario?: string | null; contatoCifrado?: string | null
  },
): Promise<ResultadoReservaPainel<{ id: string }>> {
  return semPermissaoVira<ResultadoReservaPainel<{ id: string }>, never>(() => withUserContext(db, claims, async (tx): Promise<ResultadoReservaPainel<{ id: string }>> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const rows = await tx.execute<{ rid: string | null }>(sql`select app.my_restaurant_id() as rid`)
    const restaurantId = rows[0]?.rid
    if (!restaurantId) return falha('sem_permissao')
    // unidade fora do acesso do usuário: a trava não acha a linha, porque o FOR UPDATE do authenticated passa pela policy
    // `gestao_write` de units (0016: restaurante, papel dono/gerente e acesso à unidade) ⇒ sem permissão, antes de
    // qualquer conta de lotação (a capacidade de outra unidade nunca vaza)
    const unidade = await travarUnidade(tx, restaurantId, p.unitId)
    if (!unidade) return falha('sem_permissao')
    let id: string
    if (p.horario && p.nome) {
      const r = await registrarReserva(tx, {
        restaurantId, unitId: p.unitId, customerId: null, data: p.data, pessoas: p.pessoas, horario: p.horario, nome: p.nome,
        contatoCifrado: p.contatoCifrado ?? null, simulado: false, origem: 'painel', criadoPor: claims.sub,
      })
      if (!r.ok && r.motivo === 'lotado') return { ok: false, erro: 'lotado', vagas: r.vagas }
      if (!r.ok) throw new Error(r.motivo) // sem cliente nem reservaId: só pode ser lotado
      id = r.id
    } else {
      const ocupadas = await ocupadasNoDia(tx, { restaurantId, unitId: p.unitId, data: p.data, simulado: false })
      const vagas = vagasSeNaoCouber(unidade.capacidade, ocupadas, p.pessoas)
      if (vagas !== null) return { ok: false, erro: 'lotado', vagas }
      // a policy de insert recusa (42501) unidade fora do acesso do usuário. SQL explícito: authenticated só tem
      // INSERT nas colunas do formulário (0022/0046) e o insert do Drizzle lista todas as colunas da tabela, com DEFAULT
      const [a] = await tx.execute<{ id: string }>(sql`
        insert into public.attendance_notices (restaurant_id, unit_id, data, pessoas, horario_aprox, horario, nome, contato_cifrado, origem, criado_por)
        values (${restaurantId}, ${p.unitId}, ${p.data}, ${p.pessoas}, ${p.horarioAprox}, ${p.horario ?? null}, ${p.nome},
                ${p.contatoCifrado ?? null}, 'painel', ${claims.sub})
        returning id`)
      id = a!.id
    }
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'aviso.criado_painel', entidade: 'attendance_notice', entidadeId: id,
      diff: { unitId: p.unitId, data: p.data, pessoas: p.pessoas, horarioAprox: p.horarioAprox, horario: p.horario ?? null },
    })
    return ok({ id })
  }))
}

/** Cancela aviso ativo de hoje em diante (fuso do restaurante); dia passado é só consulta. */
export function cancelarAvisoPainel(db: Db, claims: JwtClaims, avisoId: string, agora: Date = new Date()): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    // UPDATE que a policy filtra não dá erro: o papel é conferido antes
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [rest] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
    const hoje = agoraLocal(agora, rest?.tz ?? FUSO_PADRAO).data
    const r = await tx
      .update(attendanceNotices)
      .set({ status: 'cancelada', updatedAt: sql`now()` })
      .where(and(eq(attendanceNotices.id, avisoId), eq(attendanceNotices.status, 'confirmada'), gte(attendanceNotices.data, hoje)))
      .returning({ restaurantId: attendanceNotices.restaurantId, unitId: attendanceNotices.unitId, data: attendanceNotices.data })
    const a = r[0]
    if (!a) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, {
      restaurantId: a.restaurantId, acao: 'aviso.cancelado_painel', entidade: 'attendance_notice', entidadeId: avisoId,
      diff: { unitId: a.unitId, data: a.data },
    })
    return ok(null)
  }))
}

/**
 * Muda o status da reserva (dono/gerente da unidade, auditado `reserva.status` sem PII). `cancelada` e `nao_veio` liberam a
 * vaga na hora; reconfirmar passa pela lotação com a unidade travada (só reservas com o mesmo `simulado`). Confirmar e
 * cancelar valem de hoje em diante (fuso do restaurante); "não veio" só no dia ou depois. Simulada só com o modo
 * demonstração ligado.
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
      const [atual] = await tx
        .select({
          restaurantId: attendanceNotices.restaurantId, unitId: attendanceNotices.unitId, data: attendanceNotices.data,
          pessoas: attendanceNotices.pessoas, status: attendanceNotices.status, simulado: attendanceNotices.simulado,
        })
        .from(attendanceNotices)
        .where(and(eq(attendanceNotices.id, reservaId), filtroSimulacao(attendanceNotices.simulado, await lerModoDemonstracao(tx))))
        .for('update') // RLS de update: só a unidade de quem pede
      if (!atual) return falha('nao_encontrada')
      if (atual.status === status) return ok(null)
      const [rest] = await tx.select({ tz: restaurants.timezone }).from(restaurants)
      const hoje = agoraLocal(agora, rest?.tz ?? FUSO_PADRAO).data
      if (status === 'nao_veio' ? atual.data > hoje : atual.data < hoje) return { ok: false, erro: 'transicao_invalida' }
      if (status === 'confirmada') {
        const unidade = await travarUnidade(tx, atual.restaurantId, atual.unitId)
        if (!unidade) return falha('nao_encontrada')
        const ocupadas = await ocupadasNoDia(tx, { ...atual, excluirId: reservaId })
        const vagas = vagasSeNaoCouber(unidade.capacidade, ocupadas, atual.pessoas)
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
