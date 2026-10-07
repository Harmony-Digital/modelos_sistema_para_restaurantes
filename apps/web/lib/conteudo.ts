import { z } from 'zod'
import { ALVOS_IMPORTACAO_TELA, urlImportacao, urlImportarAlvo } from './importacao'

/** Abas de Conteúdo: "Sem resposta" mora em Informações; respostas rápidas em Mensagens; Importar em cada tela. */
export const ABAS_CONTEUDO = [
  { chave: 'cardapio', rotulo: 'Cardápio' },
  { chave: 'informacoes', rotulo: 'Informações' },
  { chave: 'mensagens', rotulo: 'Mensagens' },
] as const
export type AbaConteudo = (typeof ABAS_CONTEUDO)[number]['chave']

export const abaDoConteudo = (pedida: string | undefined): AbaConteudo =>
  ABAS_CONTEUDO.find((a) => a.chave === pedida)?.chave ?? 'cardapio'

export type BuscaConteudo = {
  aba?: string | undefined
  sub?: string | undefined
  imp?: string | undefined
  alvo?: string | undefined
  importar?: string | undefined
}

/**
 * Endereços antigos de Conteúdo → endereço novo, ou null quando já é o novo. `?aba=importar` (e Cardápio → Importar
 * da Etapa 05) abre o importador na tela do alvo, preservando a importação; `?aba=sem-resposta` vai para Informações.
 */
export function hrefDoConteudoAntigo(q: BuscaConteudo): string | null {
  if (q.aba === 'sem-resposta') return '/conteudo?aba=informacoes'
  const importar = q.aba === 'importar' || (q.aba === 'cardapio' && q.sub === 'importar')
  if (!importar) return null
  const alvo = (q.aba === 'importar' && ALVOS_IMPORTACAO_TELA.find((a) => a.chave === q.alvo)?.chave) || 'cardapio'
  return q.imp !== undefined && z.uuid().safeParse(q.imp).success ? urlImportacao(q.imp, alvo) : urlImportarAlvo(alvo)
}

/** "Respostas" virou "Conteúdo": sem aba vai para Mensagens; com aba repassa e o Conteúdo resolve as antigas. */
export function hrefDasRespostasAntigas(q: { aba?: string | undefined; sub?: string | undefined }): string {
  if (!q.aba) return '/conteudo?aba=mensagens'
  const p = new URLSearchParams({ aba: q.aba })
  if (q.sub) p.set('sub', q.sub)
  return `/conteudo?${p}`
}
