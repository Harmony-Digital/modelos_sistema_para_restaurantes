'use server'
import { redirect } from 'next/navigation'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { createClient } from '@/lib/supabase/server'
import { definirSenhaSchema } from './schema'

export async function definirSenha(input: { senha: string; confirmacao: string }): Promise<ActionResult> {
  const parsed = definirSenhaSchema.safeParse(input)
  if (!parsed.success) return actionErrorFromZod(parsed.error)
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims?.sub) redirect('/auth/erro?motivo=link')
  const { error } = await supabase.auth.updateUser({ password: parsed.data.senha })
  if (error) {
    const msg = /different from the old/i.test(error.message)
      ? 'Escolha uma senha diferente da anterior'
      : /weak|pwned|short/i.test(error.message)
        ? 'Senha considerada fraca. Use mais caracteres, misturando letras e números.'
        : null
    return msg ? { ok: false, fieldErrors: { senha: msg } } : { ok: false, formError: 'Não foi possível salvar a senha. Tente novamente.' }
  }
  redirect('/')
}
