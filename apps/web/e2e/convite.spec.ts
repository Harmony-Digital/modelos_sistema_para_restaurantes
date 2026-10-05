import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sql = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')

test.afterAll(async () => {
  await sql`delete from auth.users where email like '%@teste.local'`
  await sql.end()
})

test('convite leva a definir senha e depois ao painel (atendente)', async ({ page }) => {
  const email = `convite-${Date.now()}@teste.local`
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email })
  if (error) throw error
  const [r] = await sql`select id from restaurants limit 1`
  await sql`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, 'Atendente', 'atendente')`

  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite&next=/definir-senha`)
  await expect(page).toHaveURL(/\/definir-senha$/)
  await page.getByLabel(/^Nova senha/).fill('Restaurante2026')
  await page.getByLabel(/^Confirme a senha/).fill('Restaurante2026')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
})

test('sessão por senha não define senha por /definir-senha', async ({ page }) => {
  const email = `senha-${Date.now()}@teste.local`
  const senha = 'Senha-Forte-123!'
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  const [r] = await sql`select id from restaurants limit 1`
  await sql`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, 'Atendente', 'atendente')`
  await page.goto('/login')
  await page.getByLabel(/^E-mail/).fill(email)
  await page.getByLabel(/^Senha/).fill(senha)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
  await page.goto('/definir-senha')
  await expect(page).not.toHaveURL(/definir-senha/)
})

test('link inválido mostra a página de erro', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=invalido&type=invite&next=/definir-senha')
  await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible()
})
