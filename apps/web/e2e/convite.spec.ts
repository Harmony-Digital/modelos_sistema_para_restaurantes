import { expect, test } from '@playwright/test'
import { closeSql, getAdmin, getSql } from './helpers'

test.afterAll(async () => {
  await getSql()`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

test('convite leva a definir senha e depois ao painel (atendente)', async ({ page }) => {
  const email = `convite-${Date.now()}@teste.local`
  const { data, error } = await getAdmin().auth.admin.generateLink({ type: 'invite', email })
  if (error) throw error
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, 'Atendente', 'atendente')`

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
  const { data, error } = await getAdmin().auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, 'Atendente', 'atendente')`
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
