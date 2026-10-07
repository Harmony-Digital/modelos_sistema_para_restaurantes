import { somarDias, type DataIso } from '@atd/core/s1'
import type { AvisoPainel, PedidoPainel, PrevisaoUnidade, StatusPedido } from '@atd/db'
import { dataIsoValida } from '@/lib/schemas/avisos'
import { STATUS_PEDIDO } from '@/lib/schemas/eventos'

/**
 * Agenda única por dia (`/agenda?dia&unidade&cancelados&pedido`): avisos de presença e pedidos de evento numa linha
 * do tempo. A consulta vai de um ano atrás a um ano à frente (pedidos de evento chegam com meses de antecedência);
 * o formulário de aviso continua limitado a hoje + 30 (`limiteDaPrevisao`).
 */
export const DIAS_AGENDA = 365
export const inicioDaAgenda = (hoje: DataIso): DataIso => somarDias(hoje, -DIAS_AGENDA)
export const limiteDaAgenda = (hoje: DataIso): DataIso => somarDias(hoje, DIAS_AGENDA)

export function diaDaAgenda(param: string | undefined, hoje: DataIso): DataIso {
  if (!param || !dataIsoValida(param)) return hoje
  const inicio = inicioDaAgenda(hoje)
  const limite = limiteDaAgenda(hoje)
  return param < inicio ? inicio : param > limite ? limite : param
}

export function hrefAgenda(p: {
  dia: DataIso
  hoje: DataIso
  unidade?: string | null | undefined
  cancelados?: boolean | undefined
  pedido?: string | null | undefined
}): string {
  const q = new URLSearchParams()
  if (p.dia !== p.hoje) q.set('dia', p.dia)
  if (p.unidade) q.set('unidade', p.unidade)
  if (p.cancelados) q.set('cancelados', '1')
  if (p.pedido) q.set('pedido', p.pedido)
  const s = q.toString()
  return s ? `/agenda?${s}` : '/agenda'
}

export type BuscaAgenda = {
  aba?: string | undefined
  data?: string | undefined
  dia?: string | undefined
  unidade?: string | undefined
  cancelados?: string | undefined
  pedido?: string | undefined
  status?: string | undefined
}

/**
 * Endereços antigos (`/agenda?aba=previsao|eventos`, `?data=`, e o `/previsao`) → endereço novo, ou null quando já é
 * o novo. Preserva dia (o `dia` novo vence a `data` antiga), unidade, cancelados e pedido; o filtro de status some.
 */
export function hrefDaAgendaAntiga(q: BuscaAgenda): string | null {
  if (q.aba === undefined && q.data === undefined) return null
  const p = new URLSearchParams()
  const dia = [q.dia, q.data].find((d) => typeof d === 'string' && dataIsoValida(d))
  if (dia) p.set('dia', dia)
  if (q.unidade) p.set('unidade', q.unidade)
  if (q.cancelados === '1') p.set('cancelados', '1')
  if (q.pedido) p.set('pedido', q.pedido)
  const s = p.toString()
  return s ? `/agenda?${s}` : '/agenda'
}

const DE_PE: readonly StatusPedido[] = ['novo', 'em_contato', 'confirmado']
const PENDENTES: readonly StatusPedido[] = ['novo', 'em_contato']

/** Pedidos que a Agenda busca: sem "mostrar cancelados", os recusados e cancelados ficam de fora. */
export function statusDaAgenda(cancelados: boolean): StatusPedido[] {
  return cancelados ? [...STATUS_PEDIDO] : [...DE_PE]
}

export type ItemAgenda =
  | { tipo: 'evento'; chave: string; pedido: PedidoPainel }
  | { tipo: 'aviso'; chave: string; aviso: AvisoPainel; unidade: string }

const HHMM = /^\d{2}:\d{2}/

/** Horário em "HH:MM" (com ou sem segundos), e não texto livre. */
export const ehHorarioHHMM = (h: string | null): h is string => h !== null && HHMM.test(h)

/**
 * Horário do aviso como aparece na Agenda: "HH:MM" (sem segundos) quando o texto começa assim; o texto livre que a
 * IA grava ("à noite", "no fim da tarde") vai inteiro.
 */
export function horarioDoAviso(h: string | null): string | null {
  if (!h) return null
  return ehHorarioHHMM(h) ? h.slice(0, 5) : h
}

/**
 * Linha do tempo do dia: pedidos de evento (não têm hora: valem o dia todo) primeiro, na ordem da DAL; depois os
 * avisos com "HH:MM" por horário; depois os de horário em texto livre ("à noite"); sem horário no fim. Ordem estável:
 * empate (e todo o texto livre) segue a ordem das unidades e da criação.
 */
export function linhaDoTempo(
  unidades: PrevisaoUnidade[],
  pedidos: PedidoPainel[],
  f: { dia: DataIso; unidade: string | null },
): ItemAgenda[] {
  const daUnidade = (unitId: string) => f.unidade === null || unitId === f.unidade
  const eventos: ItemAgenda[] = pedidos
    .filter((p) => p.data === f.dia && daUnidade(p.unitId))
    .map((p) => ({ tipo: 'evento', chave: `e-${p.id}`, pedido: p }))
  const avisos = unidades
    .filter((u) => daUnidade(u.unitId))
    .flatMap((u) => u.avisos.map((a) => ({ tipo: 'aviso' as const, chave: `a-${a.id}`, aviso: a, unidade: u.unidade })))
  const comHora = avisos
    .filter((a) => ehHorarioHHMM(a.aviso.horarioAprox))
    .sort((a, b) => a.aviso.horarioAprox!.slice(0, 5).localeCompare(b.aviso.horarioAprox!.slice(0, 5)))
  const livre = avisos.filter((a) => a.aviso.horarioAprox && !ehHorarioHHMM(a.aviso.horarioAprox))
  const semHora = avisos.filter((a) => !a.aviso.horarioAprox)
  return [...eventos, ...comHora, ...livre, ...semHora]
}

/** Totais do que está de pé no dia (avisos cancelados e pedidos recusados/cancelados não contam). */
export function resumoDoDia(itens: ItemAgenda[]): { pessoas: number; avisos: number; eventos: number } {
  let pessoas = 0
  let avisos = 0
  let eventos = 0
  for (const i of itens) {
    if (i.tipo === 'aviso' && i.aviso.status === 'ativo') {
      avisos += 1
      pessoas += i.aviso.pessoas
    }
    if (i.tipo === 'evento' && DE_PE.includes(i.pedido.status)) eventos += 1
  }
  return { pessoas, avisos, eventos }
}

/** Pedidos que ainda pedem trabalho (novo, em contato) marcados para outro dia, por data do evento. */
export function pendentesForaDoDia(pedidos: PedidoPainel[], dia: DataIso): PedidoPainel[] {
  return pedidos
    .filter((p) => p.data !== dia && PENDENTES.includes(p.status))
    .sort((a, b) => a.data.localeCompare(b.data))
}
