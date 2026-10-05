import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sql = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')

async function criarMembro(papel: 'dono' | 'atendente') {
  const email = `${papel}-${Date.now()}@teste.local`
  const senha = 'Senha-Forte-123!'
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  const [r] = await sql`select id from restaurants limit 1`
  await sql`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, ${papel}, ${papel})`
  return { email, senha }
}

async function entrar(page: Page, email: string, senha: string) {
  await page.goto('/login')
  await page.getByLabel(/^E-mail/).fill(email)
  await page.getByLabel(/^Senha/).fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test.afterAll(async () => {
  await sql`delete from auth.users where email like '%@teste.local'`
  await sql.end()
})

test('anônimo é levado ao login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})

test('webhook não passa pelo login', async ({ request }) => {
  const r = await request.get('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1')
  expect(r.status()).toBe(403)
})

test('atendente entra sem MFA e não vê custos', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByText('Conversas abertas')).toBeVisible()
  await expect(page.getByText('Gasto de IA hoje')).toHaveCount(0)
})

test('dono sem MFA é obrigado a cadastrar o autenticador', async ({ page }) => {
  const { email, senha } = await criarMembro('dono')
  await entrar(page, email, senha)
  await expect(page).toHaveURL(/\/mfa$/)
  await expect(page.getByAltText('QR code do autenticador')).toBeVisible()
})
