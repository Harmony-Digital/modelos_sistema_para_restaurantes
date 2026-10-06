/** Espelho do enum `conversation_state` do banco. */
export const ESTADOS_CONVERSA = ['ia', 'aguardando_humano', 'humano', 'encerrada'] as const
export type ConversationState = (typeof ESTADOS_CONVERSA)[number]

/** Motivo do handoff gravado em `conversations.handoff_motivo` (sem texto livre). */
export const HANDOFF_MOTIVOS = ['pedido', 'frustracao', 'falhas', 'economico', 'servico'] as const
export type HandoffMotivo = (typeof HANDOFF_MOTIVOS)[number]

/**
 * Estados que cada estado pode virar.
 * - assumir (`→ humano`): de `ia` ou `aguardando_humano` (ou `humano` sem atendente: usuário removido); de `humano` (outra
 *   pessoa) só dono/gerente com `forcar` — a DAL confere.
 * - handoff (`→ aguardando_humano`): só da IA.
 * - devolver à IA (`→ ia`): de `aguardando_humano` ou `humano`.
 * - encerrar: de qualquer estado não encerrado. `encerrada` é final: a próxima mensagem do cliente abre conversa nova.
 */
export const TRANSICOES_CONVERSA: Record<ConversationState, readonly ConversationState[]> = {
  ia: ['aguardando_humano', 'humano', 'encerrada'],
  aguardando_humano: ['humano', 'ia', 'encerrada'],
  humano: ['humano', 'ia', 'encerrada'],
  encerrada: [],
}

export const podeTransicionar = (de: ConversationState, para: ConversationState): boolean => TRANSICOES_CONVERSA[de].includes(para)
