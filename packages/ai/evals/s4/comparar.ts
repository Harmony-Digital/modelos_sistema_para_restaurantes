import { ditaComoMudanca, encontrarUnidade, normalizeText, type ContextoS1, type EspacoS3Core, type ItemExtraido } from '@atd/core'
import { chaveItemS3 } from '../s3/comparar.ts'

const VAZIAS = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'e', 'com'])

/** "o Petit Gâteau" = "petit gateau": palavras normalizadas, sem artigos/preposições, em ordem. */
export const normalizarConsulta = (c: string | null): string =>
  normalizeText(c ?? '').split(/[^a-z0-9]+/).filter((p) => p && !VAZIAS.has(p)).sort().join(' ')

/**
 * Chave semântica de um item (S1–S4). Cardápio: a ação que o core executa (filtro por tag, busca pela consulta
 * normalizada ou envio) + unidade resolvida. Evento com `tema` de mudança: a mudança e os campos novos (o tipo do
 * evento não conta). Demais itens usam a chave do S3/S2/S1.
 */
export function chaveItemS4(i: ItemExtraido, ctx: ContextoS1, agora: Date, espacos: readonly EspacoS3Core[]): string {
  if (i.servico === 'evento' && i.tipo !== 'cancelar' && i.tipo !== 'espacos' && ditaComoMudanca(i.tema)) {
    const base = chaveItemS3({ ...i, tipoEvento: null }, ctx, agora, espacos)
    return `${base}|mudanca`
  }
  if (i.servico !== 'cardapio') return chaveItemS3(i, ctx, agora, espacos)
  const unidade = encontrarUnidade(i.unidade, ctx.unidades)?.id ?? '-'
  const consulta = normalizarConsulta(i.consulta)
  // mesma decisão do resolverItensS4
  if (i.tipo === 'filtro' && i.tag) return `cardapio|filtro|${unidade}|${i.tag}`
  if (consulta && i.tipo !== 'enviar') return `cardapio|buscar|${unidade}|${consulta}`
  if (i.tag && i.tipo !== 'enviar') return `cardapio|filtro|${unidade}|${i.tag}`
  return `cardapio|enviar|${unidade}`
}

export function extracaoCorretaS4(
  esperado: readonly ItemExtraido[], obtido: readonly ItemExtraido[], ctx: ContextoS1, agora: Date, espacos: readonly EspacoS3Core[],
): boolean {
  const k = (lista: readonly ItemExtraido[]) => lista.map((i) => chaveItemS4(i, ctx, agora, espacos)).sort()
  return JSON.stringify(k(esperado)) === JSON.stringify(k(obtido))
}
