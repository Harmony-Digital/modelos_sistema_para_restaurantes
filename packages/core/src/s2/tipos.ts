import type { ItemExtraido, ResultadoS1 } from '../s1/tipos.ts'
import type { DataIso } from '../s1/tempo.ts'

/** Aviso ativo do próprio cliente (lido pelo worker antes de resolver). */
export type AvisoAtivoS2 = { id: string; unitId: string; data: DataIso; pessoas: number; horarioAprox: string | null }

/** O que o worker executa na transação do commit da resposta. */
export type AcaoS2 =
  | { tipo: 'registrar'; unitId: string; data: DataIso; pessoas: number; horarioAprox: string | null; atualiza: boolean }
  | { tipo: 'cancelar'; avisoId: string }

export type ResultadoS2 = {
  texto: string | null
  acoes: AcaoS2[]
  /** item guardado no pendente "pessoas" (unidade e data já resolvidas) */
  perguntarPessoas: ItemExtraido | null
  /** itens S2 que esperam a escolha da unidade na lista do S1 */
  pendenteUnidade: ItemExtraido[]
  validos: number
  respondidos: number
}

export type ResultadoAtendimento = ResultadoS1 & { acoesS2: AcaoS2[]; perguntarPessoas: ItemExtraido | null }
