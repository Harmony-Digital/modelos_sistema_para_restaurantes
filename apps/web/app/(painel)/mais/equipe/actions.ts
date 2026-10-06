'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { criarConvite, definirAtivo, enqueueConvite, reenviarConvite, type ErroEquipe } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import { conviteSchema, type ConviteForm } from '@/lib/schemas/equipe'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'

const MENSAGEM: Record<ErroEquipe, string> = {
  ...MENSAGEM_ERRO_PAINEL,
  valor_invalido: 'Confira os dados do convite.',
  ja_existe: 'Esse e-mail já faz parte da equipe ou já tem um convite em aberto.',
  a_si_mesmo: 'Você não pode desativar o próprio acesso.',
}
const ERRO_FILA = 'O convite foi salvo, mas não foi possível enviá-lo agora. Use "Reenviar convite" em instantes.'
const erro = (e: ErroEquipe) => ({ ok: false as const, formError: MENSAGEM[e] })
const idValido = (id: string) => z.uuid().safeParse(id).success

/** Enfileira depois do commit; falha da fila não desfaz o convite (o dono reenvia). */
async function enfileirar(conviteId: string): Promise<boolean> {
  try {
    await enqueueConvite(await getBoss())(conviteId)
    return true
  } catch {
    return false
  }
}

/** Só o dono convida. */
export async function criarConviteAction(input: ConviteForm): Promise<ActionResult<{ conviteId: string }>> {
  const s = await requireStaff(['dono'])
  const p = conviteSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const { todas, unidades, ...resto } = p.data
  const r = await criarConvite(getDb(), s.claims, { ...resto, unidades: todas ? 'todas' : unidades })
  if (!r.ok) {
    return r.erro === 'ja_existe' ? { ok: false, fieldErrors: { email: MENSAGEM.ja_existe } } : erro(r.erro)
  }
  revalidatePath('/mais/equipe')
  if (!(await enfileirar(r.valor.conviteId))) return { ok: false, formError: ERRO_FILA }
  return { ok: true, data: r.valor }
}

export async function reenviarConviteAction(conviteId: string): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  if (!idValido(conviteId)) return erro('nao_encontrada')
  const r = await reenviarConvite(getDb(), s.claims, conviteId)
  if (!r.ok) return erro(r.erro)
  revalidatePath('/mais/equipe')
  if (!(await enfileirar(conviteId))) return { ok: false, formError: ERRO_FILA }
  return { ok: true, data: null }
}

/** Desativa ou reativa um membro; nunca o próprio dono logado. */
export async function definirAtivoAction(staffId: string, ativo: boolean): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  if (!idValido(staffId) || typeof ativo !== 'boolean') return erro('nao_encontrada')
  const r = await definirAtivo(getDb(), s.claims, staffId, ativo)
  if (!r.ok) return erro(r.erro)
  revalidatePath('/mais/equipe')
  return { ok: true, data: null }
}
