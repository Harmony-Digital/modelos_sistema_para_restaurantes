'use server'
import { redirect } from 'next/navigation'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { isInviteSession, podeDefinirSenha } from '@/lib/auth-confirm'
import { createClient } from '@/lib/supabase/server'
import { definirSenhaSchema } from './schema'

const GENERICO = 'Não foi possível salvar a senha. Tente novamente.'
const LINK_INVALIDO = 'Este link de convite não vale mais. Peça um novo convite.'

const ERROS_POR_CODIGO: Record<string, string> = {
  same_password: 'Escolha uma senha diferente da anterior',
  weak_password: 'Senha considerada fraca. Use mais caracteres, misturando letras e números.',
}

export async function definirSenha(input: { senha: string; confirmacao: string }): Promise<ActionResult> {
  const supabase = await createClient()
  let claims: { amr?: unknown; sub?: string } | null | undefined
  try {
    claims = (await supabase.auth.getClaims()).data?.claims
  } catch {
    return { ok: false, formError: GENERICO }
  }
  if (!claims?.sub) redirect('/auth/erro?motivo=link')
  if (!isInviteSession(claims)) return { ok: false, formError: LINK_INVALIDO }
  try {
    const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !aal) return { ok: false, formError: GENERICO }
    if (!podeDefinirSenha(claims, aal)) return { ok: false, formError: LINK_INVALIDO }
  } catch {
    return { ok: false, formError: GENERICO }
  }

  const parsed = definirSenhaSchema.safeParse(input)
  if (!parsed.success) return actionErrorFromZod(parsed.error)

  const { error } = await supabase.auth.updateUser({ password: parsed.data.senha })
  if (error) {
    const code = error.code ?? ''
    if (code in ERROS_POR_CODIGO) return { ok: false, fieldErrors: { senha: ERROS_POR_CODIGO[code]! } }
    if (code === 'insufficient_aal') return { ok: false, formError: LINK_INVALIDO }
    return { ok: false, formError: GENERICO }
  }
  redirect('/')
}
