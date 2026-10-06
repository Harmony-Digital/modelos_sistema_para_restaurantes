'use server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireStaff } from '@/lib/dal'
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
