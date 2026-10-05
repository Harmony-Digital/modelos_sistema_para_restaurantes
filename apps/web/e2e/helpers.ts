import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export const sql = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')

export async function criarMembro(papel: 'dono' | 'atendente') {
  const email = `${papel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`
  const senha = 'Senha-Forte-123!'
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  const [r] = await sql`select id from restaurants limit 1`
  await sql`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, ${papel}, ${papel})`
  return { email, senha }
}

export async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/login')
  await page.getByLabel(/^E-mail/).fill(email)
  await page.getByLabel(/^Senha/).fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
}
