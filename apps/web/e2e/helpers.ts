import type { Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

let _admin: ReturnType<typeof createClient> | undefined
let _sql: ReturnType<typeof postgres> | undefined

/** Cliente admin do Supabase, criado no primeiro uso. */
export function getAdmin() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('e2e: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente')
    _admin = createClient(url, key)
  }
  return _admin
}

/** Conexão Postgres, criada no primeiro uso. */
export function getSql() {
  _sql ??= postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')
  return _sql
}

/** Encerra a conexão (chamar no afterAll); a próxima chamada de getSql abre outra. */
export async function closeSql() {
  const s = _sql
  _sql = undefined
  await s?.end()
}

export async function criarMembro(papel: 'dono' | 'atendente') {
  const email = `${papel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`
  const senha = 'Senha-Forte-123!'
  const { data, error } = await getAdmin().auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, ${papel}, ${papel})`
  return { email, senha }
}

export async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/login')
  await page.getByLabel(/^E-mail/).fill(email)
  await page.getByLabel(/^Senha/).fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
}
