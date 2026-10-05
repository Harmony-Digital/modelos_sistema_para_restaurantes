'use server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { returnToAi, type ReturnResult } from '@atd/db'
import { z } from 'zod'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'
import { createClient } from '@/lib/supabase/server'
import { THEME_COOKIE } from '@/lib/theme'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function setTheme(formData: FormData) {
  await requireStaff()
  const tema = z.enum(['escuro', 'claro']).safeParse(formData.get('tema'))
  if (!tema.success) return
  ;(await cookies()).set(THEME_COOKIE, tema.data, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
  revalidatePath('/', 'layout')
}

export async function returnToAiAction(conversationId: string): Promise<{ resultado: ReturnResult }> {
  const session = await requireStaff()
  const id = z.uuid().safeParse(conversationId)
  if (!id.success) return { resultado: 'nao_encontrada' }
  const resultado = await returnToAi(getDb(), session.claims, id.data)
  revalidatePath('/')
  return { resultado }
}
