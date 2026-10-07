import { and, asc, eq, gte, ne, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { units } from './schema/restaurant.ts'
import { attendanceNotices } from './schema/s2.ts'

export type AvisoAtivo = {
  id: string
  unitId: string
  data: string
  pessoas: number
  horarioAprox: string | null
  /** HH:MM:SS da reserva (nulo nos avisos antigos). */
  horario: string | null
  nome: string | null
  /** Há número de contato informado (cifrado). O número nunca sai daqui: só pelo "ver contato" auditado. */
  temContatoProprio: boolean
}

/** Avisos ativos do cliente de `aPartirDe` (YYYY-MM-DD) em diante. Worker: filtra restaurant_id em toda consulta. */
export function avisosAtivosDoCliente(
  db: Db | Tx,
  p: { restaurantId: string; customerId: string; aPartirDe: string },
): Promise<AvisoAtivo[]> {
  return db
    .select({
      id: attendanceNotices.id, unitId: attendanceNotices.unitId, data: attendanceNotices.data,
      pessoas: attendanceNotices.pessoas, horarioAprox: attendanceNotices.horarioAprox, horario: attendanceNotices.horario,
      nome: attendanceNotices.nome, temContatoProprio: sql<boolean>`(${attendanceNotices.contatoCifrado} is not null)`,
    })
    .from(attendanceNotices)
    .where(and(
      eq(attendanceNotices.restaurantId, p.restaurantId),
      eq(attendanceNotices.customerId, p.customerId),
      eq(attendanceNotices.status, 'confirmada'),
      gte(attendanceNotices.data, p.aPartirDe),
    ))
    .orderBy(asc(attendanceNotices.data), asc(attendanceNotices.createdAt))
}

/** Cancela só aviso ativo do próprio cliente; `false` se não houver (outro cliente, já cancelado, inexistente). */
export async function cancelarAvisoDoCliente(
  tx: Tx,
  p: { restaurantId: string; customerId: string; avisoId: string },
): Promise<boolean> {
  const r = await tx
    .update(attendanceNotices)
    .set({ status: 'cancelada', updatedAt: sql`now()` })
    .where(and(
      eq(attendanceNotices.id, p.avisoId),
      eq(attendanceNotices.restaurantId, p.restaurantId),
      eq(attendanceNotices.customerId, p.customerId),
      eq(attendanceNotices.status, 'confirmada'),
    ))
    .returning({ id: attendanceNotices.id })
  return r.length > 0
}

// ============ Reserva com lotação (spec 2026-10-07 §3) ============

export type GravarReserva = {
  restaurantId: string
  unitId: string
  /** null: reserva criada pelo painel (sem cliente do WhatsApp). */
  customerId: string | null
  data: string
  pessoas: number
  /** HH:MM (ou HH:MM:SS). Obrigatório na reserva nova; ao mudar uma reserva, omitido = mantém o atual. */
  horario?: string | undefined
  /** Obrigatório na reserva nova; ao mudar, omitido = mantém o atual. */
  nome?: string | undefined
  /**
   * `encryptPhone` do número informado; null = o próprio WhatsApp do cliente; omitido = mantém o atual ao mudar (na
   * reserva nova, omitido = null). Nunca vem do LLM.
   */
  contatoCifrado?: string | null | undefined
  simulado: boolean
  origem: 'ia' | 'painel'
  /** Reserva confirmada que está sendo mudada (pessoas/horário). Sem ela, vale a do mesmo cliente/unidade/dia. */
  reservaId?: string
  /** Painel: autor (tem de ser o usuário da sessão, pela policy). */
  criadoPor?: string | null
}
export type ResultadoReserva =
  | { ok: true; id: string; atualizou: boolean }
  | { ok: false; motivo: 'lotado'; vagas: number }
  /** Mudar para unidade/dia onde o cliente já tem outra reserva confirmada (`id` = essa outra). Nada muda. */
  | { ok: false; motivo: 'ja_existe'; id: string }
  /** `reservaId` não está mais confirmada (cancelada pela equipe, "não veio") ou não é do cliente. Nada é gravado. */
  | { ok: false; motivo: 'reserva_indisponivel' }
export type OcupacaoUnidade = { ocupadas: number; capacidade: number | null }

/**
 * Trava a linha da unidade até o fim da transação e devolve a capacidade (null = sem lotação); null se a unidade não é
 * do restaurante (ou não é visível). O painel (authenticated) trava direto: a policy `gestao_write` (0016) só deixa travar unidade do acesso de dono/gerente; o worker não tem UPDATE
 * em `units` (exigido por FOR UPDATE) e trava pela função `app.travar_unidade_reserva`.
 */
export async function travarUnidade(tx: Tx, restaurantId: string, unitId: string): Promise<{ capacidade: number | null } | null> {
  const [quem] = await tx.execute<{ papel: string }>(sql`select current_user::text as papel`)
  if (quem?.papel === 'authenticated') {
    const [u] = await tx
      .select({ capacidade: units.capacidadePessoas })
      .from(units)
      .where(and(eq(units.id, unitId), eq(units.restaurantId, restaurantId)))
      .for('update')
    return u ?? null
  }
  const [u] = await tx.execute<{ capacidade: number | null }>(
    sql`select capacidade from app.travar_unidade_reserva(${restaurantId}::uuid, ${unitId}::uuid)`)
  return u ?? null
}

/** Soma de pessoas das reservas confirmadas da unidade no dia, com o mesmo `simulado`, fora `excluirId`. */
export async function ocupadasNoDia(
  tx: Tx,
  p: { restaurantId: string; unitId: string; data: string; simulado: boolean; excluirId?: string | undefined },
): Promise<number> {
  const [r] = await tx
    .select({ total: sql<number>`coalesce(sum(${attendanceNotices.pessoas}), 0)::int` })
    .from(attendanceNotices)
    .where(and(
      eq(attendanceNotices.restaurantId, p.restaurantId),
      eq(attendanceNotices.unitId, p.unitId),
      eq(attendanceNotices.data, p.data),
      eq(attendanceNotices.status, 'confirmada'),
      eq(attendanceNotices.simulado, p.simulado),
      p.excluirId ? ne(attendanceNotices.id, p.excluirId) : undefined,
    ))
  return r?.total ?? 0
}

/** Vagas que faltam para caber `pessoas` (null = cabe). Sem capacidade, sempre cabe. */
export function vagasSeNaoCouber(capacidade: number | null, ocupadas: number, pessoas: number): number | null {
  if (capacidade === null || ocupadas + pessoas <= capacidade) return null
  return Math.max(0, capacidade - ocupadas)
}

/**
 * Ocupação do dia por unidade ativa do restaurante (as visíveis, sob RLS), contando só as reservas `confirmada` com o
 * `simulado` pedido. Leitura sem trava: a decisão final é de `registrarReserva`.
 */
export async function ocupacaoDoDia(
  tx: Db | Tx, restaurantId: string, data: string, simulado: boolean,
): Promise<Map<string, OcupacaoUnidade>> {
  const rows = await tx
    .select({
      unitId: units.id,
      capacidade: units.capacidadePessoas,
      ocupadas: sql<number>`coalesce(sum(${attendanceNotices.pessoas}), 0)::int`,
    })
    .from(units)
    .leftJoin(attendanceNotices, and(
      eq(attendanceNotices.restaurantId, units.restaurantId),
      eq(attendanceNotices.unitId, units.id),
      eq(attendanceNotices.data, data),
      eq(attendanceNotices.status, 'confirmada'),
      eq(attendanceNotices.simulado, simulado),
    ))
    .where(and(eq(units.restaurantId, restaurantId), eq(units.ativo, true)))
    .groupBy(units.id, units.capacidadePessoas, units.ordem, units.nome)
    .orderBy(asc(units.ordem), asc(units.nome))
  return new Map(rows.map((r) => [r.unitId, { ocupadas: r.ocupadas, capacidade: r.capacidade }]))
}

type Existente = { id: string; unitId: string; data: string; pessoas: number }

const COLS_EXISTENTE = {
  id: attendanceNotices.id, unitId: attendanceNotices.unitId, data: attendanceNotices.data, pessoas: attendanceNotices.pessoas,
}

/** Reserva confirmada do cliente na unidade e no dia (travada), fora `excluirId`. */
async function confirmadaDoCliente(
  tx: Tx,
  p: { restaurantId: string; customerId: string; unitId: string; data: string; excluirId?: string },
): Promise<Existente | null> {
  const [e] = await tx.select(COLS_EXISTENTE).from(attendanceNotices).where(and(
    eq(attendanceNotices.restaurantId, p.restaurantId), eq(attendanceNotices.customerId, p.customerId),
    eq(attendanceNotices.unitId, p.unitId), eq(attendanceNotices.data, p.data), eq(attendanceNotices.status, 'confirmada'),
    p.excluirId ? ne(attendanceNotices.id, p.excluirId) : undefined,
  )).for('update')
  return e ?? null
}

/** `reservaId` confirmado e do cliente (travado); null se não estiver mais. */
async function reservaPorId(tx: Tx, r: GravarReserva & { reservaId: string }): Promise<Existente | null> {
  const [e] = await tx.select(COLS_EXISTENTE).from(attendanceNotices).where(and(
    eq(attendanceNotices.id, r.reservaId), eq(attendanceNotices.restaurantId, r.restaurantId),
    eq(attendanceNotices.status, 'confirmada'),
    r.customerId === null ? undefined : eq(attendanceNotices.customerId, r.customerId),
  )).for('update')
  return e ?? null
}

/**
 * Registra ou muda uma reserva `confirmada` só se couber na lotação do dia (spec §3), na transação de quem chama
 * (worker: a do commit da resposta; painel: a de `withUserContext`):
 * 1. trava a unidade (`FOR UPDATE`): duas transações pelas mesmas vagas ficam em fila;
 * 2. soma a ocupação do dia com o mesmo `simulado`, sem a reserva que está sendo mudada;
 * 3. grava só se `ocupação + pessoas ≤ capacidade` (ou sem capacidade). Diminuir (ou manter) nunca é bloqueado.
 * O mesmo cliente com reserva confirmada na unidade e dia atualiza essa reserva (`atualizou: true`). Ao mudar, `nome`,
 * `horario` e `contatoCifrado` omitidos ficam como estão. Com `reservaId`, a reserva tem de seguir confirmada e ser do
 * cliente (senão `reserva_indisponivel`, sem criar outra) e o destino não pode ter outra confirmada dele (`ja_existe`).
 */
export async function registrarReserva(tx: Tx, r: GravarReserva): Promise<ResultadoReserva> {
  const nome = r.nome?.trim()
  if (nome === '') throw new Error('nome_obrigatorio')
  const unidade = await travarUnidade(tx, r.restaurantId, r.unitId)
  if (!unidade) throw new Error('unidade_inexistente')
  let existente: Existente | null
  if (r.reservaId) {
    existente = await reservaPorId(tx, { ...r, reservaId: r.reservaId })
    if (!existente) return { ok: false, motivo: 'reserva_indisponivel' }
    // mudar de unidade/dia não pode colidir com outra confirmada do cliente no destino (índice único parcial)
    const noDestino = r.customerId === null ? null
      : await confirmadaDoCliente(tx, { ...r, customerId: r.customerId, excluirId: existente.id })
    if (noDestino) return { ok: false, motivo: 'ja_existe', id: noDestino.id }
  } else {
    existente = r.customerId === null ? null : await confirmadaDoCliente(tx, { ...r, customerId: r.customerId })
  }
  if (!existente && nome === undefined) throw new Error('nome_obrigatorio')
  if (!existente && !r.horario) throw new Error('horario_obrigatorio')
  const semAumentoNaMesmaVaga = existente !== null && existente.unitId === r.unitId && existente.data === r.data
    && r.pessoas <= existente.pessoas
  if (!semAumentoNaMesmaVaga) {
    const ocupadas = await ocupadasNoDia(tx, { ...r, excluirId: existente?.id })
    const vagas = vagasSeNaoCouber(unidade.capacidade, ocupadas, r.pessoas)
    if (vagas !== null) return { ok: false, motivo: 'lotado', vagas }
  }
  if (existente) {
    // undefined = mantém o atual (o Drizzle omite a coluna no SET)
    await tx
      .update(attendanceNotices)
      .set({
        unitId: r.unitId, data: r.data, pessoas: r.pessoas, horario: r.horario, nome, contatoCifrado: r.contatoCifrado,
        updatedAt: sql`now()`,
      })
      .where(eq(attendanceNotices.id, existente.id))
    return { ok: true, id: existente.id, atualizou: true }
  }
  // colunas explícitas: o painel (authenticated) só tem INSERT nas colunas do formulário (0022/0046)
  const v: [string, unknown][] = [
    ['restaurant_id', r.restaurantId], ['unit_id', r.unitId], ['data', r.data], ['pessoas', r.pessoas], ['horario', r.horario],
    ['nome', nome], ['contato_cifrado', r.contatoCifrado ?? null], ['origem', r.origem],
  ]
  if (r.customerId !== null) v.push(['customer_id', r.customerId])
  if (r.simulado) v.push(['simulado', true])
  if (r.criadoPor) v.push(['criado_por', r.criadoPor])
  const [a] = await tx.execute<{ id: string }>(sql`
    insert into public.attendance_notices (${sql.join(v.map(([c]) => sql.identifier(c)), sql`, `)})
    values (${sql.join(v.map(([, x]) => sql`${x}`), sql`, `)}) returning id`)
  return { ok: true, id: a!.id, atualizou: false }
}
