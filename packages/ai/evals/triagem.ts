/** Versão da triagem medida por padrão nos evals de extração: a que roda em produção. */
export const TRIAGEM_PADRAO = 'v5'

/** `--triagem` dos evals de extração: padrão v5; a v4 (produção anterior) e a versão anterior do serviço continuam como opção. */
export function lerTriagem<A extends 'v2' | 'v3' | 'v4'>(valor: string | undefined, anterior: A): A | 'v4' | 'v5' {
  const v = valor ?? TRIAGEM_PADRAO
  if (v === TRIAGEM_PADRAO || v === 'v4' || v === anterior) return v as A | 'v4' | 'v5'
  const opcoes = [...new Set([anterior, 'v4'])].join(', ')
  throw new Error(`--triagem deve ser ${opcoes} ou v5`)
}
