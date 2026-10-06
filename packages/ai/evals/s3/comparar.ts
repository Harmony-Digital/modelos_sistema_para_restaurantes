import {
  agoraLocal, encontrarUnidade, feriadosNacionais, normalizarTipoEvento, normalizeText, resolverData,
  type ContextoS1, type EspacoS3Core, type ItemExtraido,
} from '@atd/core'
import { chaveItemS2 } from '../s2/comparar.ts'

export { horasInventadasS2 } from '../s2/comparar.ts'

const PREFIXO_ESPACO = /^\s*(?:(?:o|no|na|do|da|pelo|pela)\s+)?(?:espa[cç]o|area|área)\s+/i

/**
 * Chave semântica de um item (S1, S2 ou S3). Evento: tipo + unidade/data resolvidas + convidados + tipo normalizado
 * ("niver" = "aniversário") + espaço ("*" = tanto faz; senão o espaço do banco pelo nome, ou o texto normalizado).
 * Itens de outros serviços usam a chave do S2/S1.
 */
export function chaveItemS3(i: ItemExtraido, ctx: ContextoS1, agora: Date, espacos: readonly EspacoS3Core[]): string {
  if (i.servico !== 'evento') return chaveItemS2(i, ctx, agora)
  const tipo = i.tipo === 'cancelar' || i.tipo === 'espacos' ? i.tipo : 'pedido'
  const unidade = encontrarUnidade(i.unidade, ctx.unidades)?.id ?? '-'
  const hoje = agoraLocal(agora, ctx.timezone).data
  const ano = Number(hoje.slice(0, 4))
  let data = '-'
  if (i.data) {
    const d = resolverData(i.data, hoje, [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)])
    data = d.ok ? d.data : '?'
  }
  if (tipo === 'cancelar') return `evento|cancelar|${unidade}|${data}`
  if (tipo === 'espacos') return `evento|espacos|${unidade}|${i.convidados ?? '-'}`
  const t = normalizarTipoEvento(i.tipoEvento)
  let espaco = '-'
  if (i.espaco === '*') espaco = '*'
  else if (i.espaco) {
    const alvo = i.espaco.replace(PREFIXO_ESPACO, '')
    const daUnidade = espacos.filter((e) => e.unitId === unidade)
    const achado = encontrarUnidade(alvo, daUnidade.map((e) => ({ id: e.id, nome: e.nome, apelidos: [] as string[] })))
    espaco = achado?.id ?? normalizeText(alvo)
  }
  return `evento|pedido|${unidade}|${data}|${i.convidados ?? '-'}|${t?.tipo ?? '-'}|${espaco}`
}

export function extracaoCorretaS3(
  esperado: readonly ItemExtraido[], obtido: readonly ItemExtraido[], ctx: ContextoS1, agora: Date, espacos: readonly EspacoS3Core[],
): boolean {
  const k = (lista: readonly ItemExtraido[]) => lista.map((i) => chaveItemS3(i, ctx, agora, espacos)).sort()
  return JSON.stringify(k(esperado)) === JSON.stringify(k(obtido))
}
