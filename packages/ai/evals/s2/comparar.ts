import {
  agoraLocal, encontrarUnidade, feriadosNacionais, normalizarHorario, resolverData,
  type ContextoS1, type ItemExtraido,
} from '@atd/core'
import { chaveItem, horasInventadas } from '../s1/comparar.ts'

/**
 * Chave semântica de um item (S1 ou S2). Aviso: tipo + unidade/data resolvidas + pessoas + horário normalizado
 * ("20h" = "às 20:00" = "umas 8 da noite"). Itens de outros serviços usam a chave do S1.
 */
export function chaveItemS2(i: ItemExtraido, ctx: ContextoS1, agora: Date): string {
  if (i.servico !== 'aviso_presenca') return chaveItem(i, ctx, agora)
  const tipo = i.tipo === 'cancelar' ? 'cancelar' : 'registrar'
  const unidade = encontrarUnidade(i.unidade, ctx.unidades)?.id ?? '-'
  const hoje = agoraLocal(agora, ctx.timezone).data
  const ano = Number(hoje.slice(0, 4))
  let data = '-'
  if (i.data) {
    const d = resolverData(i.data, hoje, [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)])
    data = d.ok ? d.data : '?'
  } else if (tipo === 'registrar') data = hoje // data ausente = hoje
  if (tipo === 'cancelar') return `aviso_presenca|cancelar|${unidade}|${data}`
  const h = normalizarHorario(i.horario)
  return `aviso_presenca|registrar|${unidade}|${data}|${i.pessoas ?? '-'}|${h.hhmm ?? h.livre ?? '-'}`
}

export function extracaoCorretaS2(esperado: readonly ItemExtraido[], obtido: readonly ItemExtraido[], ctx: ContextoS1, agora: Date): boolean {
  const k = (lista: readonly ItemExtraido[]) => lista.map((i) => chaveItemS2(i, ctx, agora)).sort()
  return JSON.stringify(k(esperado)) === JSON.stringify(k(obtido))
}

/**
 * `horasInventadas` do S1, com uma exceção estreita: o horário que o PRÓPRIO CLIENTE informou no item
 * ("por volta das 20h") pode aparecer na resposta. Horário que não veio do cliente nem do banco continua inventado.
 */
export function horasInventadasS2(texto: string, ctx: ContextoS1, itens: readonly ItemExtraido[]): string[] {
  const doCliente = new Set(
    itens.filter((i) => i.servico === 'aviso_presenca').map((i) => normalizarHorario(i.horario).hhmm).filter((h): h is string => h !== null),
  )
  return horasInventadas(texto, ctx).filter((h) => !doCliente.has(h))
}

type ItemComReserva = ItemExtraido & { nome?: string | null; contato_ok?: boolean | null }
const nomeChave = (n: string | null | undefined) =>
  (n ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim() || '-'

/** Chave da triage-v7: a do S2 mais, na reserva, o nome (sem acento nem caixa) e a resposta do contato. */
export function chaveItemReserva(i: ItemComReserva, ctx: ContextoS1, agora: Date): string {
  const k = chaveItemS2(i, ctx, agora)
  if (i.servico !== 'aviso_presenca' || i.tipo === 'cancelar') return k
  return `${k}|${nomeChave(i.nome)}|${i.contato_ok ?? '-'}`
}

export function extracaoCorretaReserva(esperado: readonly ItemComReserva[], obtido: readonly ItemComReserva[], ctx: ContextoS1, agora: Date): boolean {
  const k = (lista: readonly ItemComReserva[]) => lista.map((i) => chaveItemReserva(i, ctx, agora)).sort()
  return JSON.stringify(k(esperado)) === JSON.stringify(k(obtido))
}
