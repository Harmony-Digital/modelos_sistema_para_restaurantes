'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { atualizarPedido, revelarTelefonePedido } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { pedidoSchema, type PedidoForm } from '@/lib/schemas/eventos'
import { getDb } from '@/lib/server/db'
import { env } from '@/lib/server/env'

const INDISPONIVEL = { ok: false as const, formError: 'Esse pedido não está mais disponível.' }

// toda a equipe trabalha a fila; a RLS limita cada pessoa às suas unidades
export async function atualizarPedidoAction(id: string, input: PedidoForm): Promise<ActionResult<null>> {
  const s = await requireStaff()
  if (!z.uuid().safeParse(id).success) return INDISPONIVEL
  const p = pedidoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const v = p.data
  const r = await atualizarPedido(getDb(), s.claims, id, {
    status: v.status,
    responsavelId: v.responsavelId === '' ? null : v.responsavelId,
    notasInternas: v.notasInternas === '' ? null : v.notasInternas,
  })
  if (r.ok) revalidatePath('/agenda')
  if (!r.ok && r.erro === 'transicao_invalida') return { ok: false, fieldErrors: { status: 'Esse status não pode mais ser alterado assim.' } }
  if (!r.ok && r.erro === 'nao_encontrada') return INDISPONIVEL
  return resultadoDoPainel(r)
}

/** O número só existe aqui: nunca vai nas props da página. Cada chamada é auditada no banco. */
export async function revelarTelefoneAction(id: string): Promise<ActionResult<{ telefone: string }>> {
  const s = await requireStaff()
  if (!z.uuid().safeParse(id).success) return INDISPONIVEL
  const r = await revelarTelefonePedido(getDb(), s.claims, id, env().phoneKey)
  if (!r.ok && r.erro === 'nao_encontrada') return INDISPONIVEL
  return resultadoDoPainel(r)
}
