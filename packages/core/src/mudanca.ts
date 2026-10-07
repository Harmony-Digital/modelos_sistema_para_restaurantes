import { normalizeText } from './normalize.ts'

/**
 * "na verdade são 60", "quero mudar a data", "troca para a Asa Norte": a triagem resume a intenção de mudar um pedido
 * (evento) ou uma reserva em `tema` ("mudanca").
 */
const DITA_MUDANCA = /\b(?:na verdade|mud(?:ar|a|e|ei|anca)|alter(?:ar|a|e|ei|acao)|troc(?:ar|a|ei)|troque|corrig(?:ir|e))\b/
export const ditaComoMudanca = (tema: string | null | undefined): boolean => DITA_MUDANCA.test(normalizeText(tema ?? ''))
