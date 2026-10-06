/** Versão da triagem medida por padrão nos evals de extração: a que roda em produção. */
export const TRIAGEM_PADRAO = 'v4'

/** `--triagem` dos evals S1/S2: padrão v4; a versão anterior do serviço continua como opção. */
export function lerTriagem<A extends 'v2' | 'v3'>(valor: string | undefined, anterior: A): A | 'v4' {
  const v = valor ?? TRIAGEM_PADRAO
  if (v === TRIAGEM_PADRAO || v === anterior) return v as A | 'v4'
  throw new Error(`--triagem deve ser ${anterior} ou v4`)
}
