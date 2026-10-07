/** Versão da triagem medida por padrão nos evals de extração: a que roda em produção. */
export const TRIAGEM_PADRAO = 'v7'

/** `--triagem` dos evals de extração: padrão v7; a v6, a v5, a v4 e a versão anterior do serviço continuam como opção. */
export function lerTriagem<A extends 'v2' | 'v3' | 'v4' | 'v5'>(valor: string | undefined, anterior: A): A | 'v4' | 'v5' | 'v6' | 'v7' {
  const v = valor ?? TRIAGEM_PADRAO
  if (v === TRIAGEM_PADRAO || v === 'v6' || v === 'v5' || v === 'v4' || v === anterior) return v as A | 'v4' | 'v5' | 'v6' | 'v7'
  const opcoes = [...new Set([anterior, 'v4', 'v5', 'v6'])].join(', ')
  throw new Error(`--triagem deve ser ${opcoes} ou v7`)
}
