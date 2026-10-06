'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  assumirConversa, devolverConversa, encerrarConversa, enqueueDeliver, reenviarMensagem, responderConversa, revelarTelefoneConversa,
  type ErroInbox,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { MENSAGEM_ERRO_INBOX } from '@/lib/conversas'
import { requireStaff } from '@/lib/dal'
import { assumirSchema, respostaSchema, type AssumirForm, type RespostaForm } from '@/lib/schemas/conversas'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import { env } from '@/lib/server/env'

// toda a equipe atende; a DAL confere unidade, quem assumiu e as transições
const EQUIPE: ['dono', 'gerente', 'atendente'] = ['dono', 'gerente', 'atendente']
const NAO_ENCONTRADA = { ok: false as const, formError: MENSAGEM_ERRO_INBOX.nao_encontrada }
const SO_GESTAO_FORCA = 'Só o dono ou o gerente podem assumir uma conversa que já está com outra pessoa.'
const TELEFONE_INDISPONIVEL = { ok: false as const, formError: 'O telefone desta conversa não está disponível.' }
const idValido = (id: string) => z.uuid().safeParse(id).success
const falhou = (erro: ErroInbox) => ({ ok: false as const, formError: MENSAGEM_ERRO_INBOX[erro] })

function revalidar() {
  revalidatePath('/conversas', 'layout')
}

/** Enfileira a entrega depois do commit. Falha da fila não desfaz a resposta: ela fica `pendente` e sai na próxima entrega. */
async function enfileirarEntrega(conversationId: string): Promise<boolean> {
  try {
    await enqueueDeliver(await getBoss())(conversationId)
    return true
  } catch {
    return false
  }
}

export async function assumirAction(id: string, input: AssumirForm): Promise<ActionResult<null>> {
  const s = await requireStaff(EQUIPE)
  if (!idValido(id)) return NAO_ENCONTRADA
  const p = assumirSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  if (p.data.forcar && s.role === 'atendente') return { ok: false, formError: SO_GESTAO_FORCA }
  const r = await assumirConversa(getDb(), s.claims, id, { forcar: p.data.forcar })
  if (r.ok) {
    revalidar()
    return { ok: true, data: null }
  }
  if (r.erro === 'ja_atendida') {
    return { ok: false, formError: `${r.atendente ?? 'Outra pessoa'} já está atendendo esta conversa.` }
  }
  return falhou(r.erro)
}

export async function responderAction(
  id: string,
  input: RespostaForm,
): Promise<ActionResult<{ messageId: number; envioAtrasado: boolean }>> {
  const s = await requireStaff(EQUIPE)
  if (!idValido(id)) return NAO_ENCONTRADA
  const p = respostaSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await responderConversa(getDb(), s.claims, id, p.data.texto)
  if (!r.ok) return falhou(r.erro)
  const enfileirou = await enfileirarEntrega(id)
  revalidar()
  return { ok: true, data: { messageId: r.messageId, envioAtrasado: !enfileirou } }
}

/** "Tentar de novo" de uma resposta humana que falhou no envio. */
export async function reenviarAction(messageId: number): Promise<ActionResult<{ envioAtrasado: boolean }>> {
  const s = await requireStaff(EQUIPE)
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return falhou('nao_encontrada')
  const r = await reenviarMensagem(getDb(), s.claims, messageId)
  if (!r.ok) return falhou(r.erro)
  const enfileirou = await enfileirarEntrega(r.conversationId)
  revalidar()
  return { ok: true, data: { envioAtrasado: !enfileirou } }
}

export async function devolverAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(EQUIPE)
  if (!idValido(id)) return NAO_ENCONTRADA
  const r = await devolverConversa(getDb(), s.claims, id)
  if (!r.ok) return falhou(r.erro)
  revalidar()
  revalidatePath('/')
  return { ok: true, data: null }
}

export async function encerrarAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(EQUIPE)
  if (!idValido(id)) return NAO_ENCONTRADA
  const r = await encerrarConversa(getDb(), s.claims, id)
  if (!r.ok) return falhou(r.erro)
  revalidar()
  return { ok: true, data: null }
}

/** O número só existe aqui: nunca vai nas props da página. Cada chamada é auditada no banco. */
export async function mostrarTelefoneConversaAction(id: string): Promise<ActionResult<{ telefone: string }>> {
  const s = await requireStaff(EQUIPE)
  if (!idValido(id)) return TELEFONE_INDISPONIVEL
  const r = await revelarTelefoneConversa(getDb(), s.claims, id, env().phoneKey)
  if (!r.ok) return TELEFONE_INDISPONIVEL
  return { ok: true, data: r.valor }
}
