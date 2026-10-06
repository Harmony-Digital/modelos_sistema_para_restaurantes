import type { ItemExtraido, ResultadoS1 } from '../s1/tipos.ts'
import type { DataIso } from '../s1/tempo.ts'

/** Aviso ativo do próprio cliente (lido pelo worker antes de resolver). */
export type AvisoAtivoS2 = { id: string; unitId: string; data: DataIso; pessoas: number; horarioAprox: string | null }

/** O que o worker executa na transação do commit da resposta. */
export type AcaoS2 =
  | { tipo: 'registrar'; unitId: string; data: DataIso; pessoas: number; horarioAprox: string | null; atualiza: boolean }
  /** `texto` é o trecho da resposta; se o banco não cancelar (corrida), o worker o troca por `textoSeFalhar`. */
  | { tipo: 'cancelar'; avisoId: string; texto: string; textoSeFalhar: string }

/** Aviso que espera "Para quantas pessoas?": unidade e data já resolvidas; `unitId` evita reabrir a lista. */
export type PerguntaPessoas = { item: ItemExtraido; unitId: string }

export type ResultadoS2 = {
  texto: string | null
  acoes: AcaoS2[]
  /** item guardado no pendente "pessoas" (unidade e data já resolvidas) */
  perguntarPessoas: PerguntaPessoas | null
  /** itens S2 que esperam a escolha da unidade na lista do S1 */
  pendenteUnidade: ItemExtraido[]
  validos: number
  respondidos: number
}

export type ResultadoAtendimento = ResultadoS1 & { acoesS2: AcaoS2[]; perguntarPessoas: PerguntaPessoas | null }
