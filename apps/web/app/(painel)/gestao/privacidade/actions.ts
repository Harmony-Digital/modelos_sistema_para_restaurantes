'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  concluirAcesso, concluirCorrecao, executarExclusao, negarPedido, resumoAcessoTitular, revelarTelefoneTitular, salvarRetencao,
  type ResultadoPrivacidade, type ResumoTitular,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import { confirmouExclusao, correcaoSchema, negarSchema, PALAVRA_EXCLUSAO, retencaoSchema, type NegarForm, type RetencaoForm } from '@/lib/schemas/privacidade'
import { getDb } from '@/lib/server/db'
import { env } from '@/lib/server/env'

// dono e gerente operam a fila (o gerente também exclui); o atendente nem chega ao banco
const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const INDISPONIVEL = { ok: false as const, formError: 'Esse pedido não está mais disponível.' }
const RESOLVIDO = { ok: false as const, formError: 'Esse pedido já foi resolvido ou não aceita essa ação.' }
const idValido = (id: string) => z.uuid().safeParse(id).success

function resultado<T>(r: ResultadoPrivacidade<T>): ActionResult<T> {
  if (r.ok) return { ok: true, data: r.valor }
  if (r.erro === 'nao_encontrada') return INDISPONIVEL
  if (r.erro === 'transicao_invalida') return RESOLVIDO
  if (r.erro === 'valor_invalido') return { ok: false, formError: 'Confira os dados e tente de novo.' }
  return { ok: false, formError: MENSAGEM_ERRO_PAINEL[r.erro] }
}

function revalidarFila() {
  revalidatePath('/gestao/privacidade')
  revalidatePath('/') // alerta de prazo no Início
}

/** Monta o resumo para o titular (auditado na DAL). Sem telefone: ele só aparece por `revelarTelefoneTitularAction`. */
export async function gerarResumoAction(pedidoId: string): Promise<ActionResult<ResumoTitular>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  const r = await resumoAcessoTitular(getDb(), s.claims, pedidoId)
  if (!r) return { ok: false, formError: 'Não há dados desse cliente para resumir. Ele pode já ter sido excluído.' }
  return { ok: true, data: r }
}

/** O número só existe aqui: nunca vai nas props da página. Cada chamada é auditada no banco. */
export async function revelarTelefoneTitularAction(pedidoId: string): Promise<ActionResult<{ telefone: string }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  return resultado(await revelarTelefoneTitular(getDb(), s.claims, pedidoId, env().phoneKey))
}

export async function concluirAcessoAction(pedidoId: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  const r = await concluirAcesso(getDb(), s.claims, pedidoId)
  if (r.ok) revalidarFila()
  return resultado(r)
}

/** Confirmação dupla: a tela pede para digitar EXCLUIR, e o servidor confere de novo antes de apagar. */
export async function excluirTitularAction(
  pedidoId: string,
  confirmacao: string,
): Promise<ActionResult<{ contagens: Record<string, number> }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  if (!confirmouExclusao(confirmacao)) return { ok: false, fieldErrors: { confirmacao: `Digite ${PALAVRA_EXCLUSAO} para confirmar.` } }
  const r = await executarExclusao(getDb(), s.claims, pedidoId)
  if (r.ok) {
    revalidarFila()
    revalidatePath('/conversas')
    revalidatePath('/agenda')
  }
  return resultado(r)
}

/** Resposta curta, sem dado pessoal (a tela orienta); não vai para a auditoria. */
export async function negarPedidoAction(pedidoId: string, input: NegarForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  const p = negarSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await negarPedido(getDb(), s.claims, pedidoId, p.data.resposta)
  if (r.ok) revalidarFila()
  return resultado(r)
}

/** Conclui o pedido de correção (a equipe corrigiu o dado por fora) com resposta curta, sem dado pessoal. */
export async function concluirCorrecaoAction(pedidoId: string, input: NegarForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(pedidoId)) return INDISPONIVEL
  const p = correcaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await concluirCorrecao(getDb(), s.claims, pedidoId, p.data.resposta)
  if (r.ok) revalidarFila()
  return resultado(r)
}

/** Só o dono altera os prazos; o gerente vê. Mínimos: mensagens 7 dias, demais 30. */
export async function salvarRetencaoAction(input: RetencaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = retencaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarRetencao(getDb(), s.claims, p.data)
  if (r.ok) revalidatePath('/gestao/privacidade')
  return resultado(r)
}
