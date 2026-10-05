import { expect, test } from '@playwright/test'
import { closeSql, criarMembro, entrar, getSql } from './helpers'

test.afterAll(async () => {
  await getSql()`delete from auth.users where email like '%@teste.local'`
  await closeSql()
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
