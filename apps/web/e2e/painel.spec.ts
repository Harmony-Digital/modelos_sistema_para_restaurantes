import { expect, test, type Page } from '@playwright/test'
import { criarMembro, entrar, sql } from './helpers'

test.afterAll(async () => {
  await sql`delete from auth.users where email like '%@teste.local'`
  await sql`delete from customers where nome_perfil = 'Cliente E2E'`
})

test('tema: cookie claro chega na primeira resposta e a troca funciona', async ({ page, context }) => {
  await context.addCookies([{ name: 'atd-tema', value: 'claro', url: 'http://localhost:3000' }])
  const resp = await page.goto('/login')
  expect(await resp!.text()).toContain('data-theme="light"')
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await page.getByRole('link', { name: 'Mais' }).click()
  await page.getByText('Escuro', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('navegação inferior leva às 4 seções', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  for (const [link, titulo] of [['Unidades', 'Unidades'], ['Respostas', 'Respostas'], ['Mais', 'Mais'], ['Início', 'Início']] as const) {
    await page.getByRole('link', { name: link }).click()
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  }
})

test('devolver à IA tira a conversa da fila', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  const [r] = await sql`select id from restaurants limit 1`
  const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${r!.id}, ${'e2e-' + Date.now()}, 'x', 'Cliente E2E') returning id`
  await sql`insert into conversations (restaurant_id, customer_id, estado) values (${r!.id}, ${c!.id}, 'aguardando_humano')`
  await entrar(page, email, senha)
  await page.getByRole('button', { name: 'Devolver à IA a conversa de Cliente E2E' }).click()
  await expect(page.getByText('Conversa devolvida à IA')).toBeVisible()
  const [conv] = await sql`select estado from conversations where customer_id = ${c!.id}`
  expect(conv!.estado).toBe('ia')
})

test('simulador abre em tela cheia no celular e mostra a mensagem enviada', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulador de WhatsApp' })
  await expect(dialog).toBeVisible()
  await page.getByRole('textbox', { name: 'Mensagem' }).fill('abre domingo?')
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('abre domingo?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('formulário: erro no campo certo e olho da senha', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByLabel(/^E-mail/)).toBeFocused()
  await page.getByLabel(/^Senha/).fill('segredo123')
  await page.getByRole('button', { name: 'Mostrar senha' }).click()
  await expect(page.getByLabel(/^Senha/)).toHaveAttribute('type', 'text')
})

const semScrollHorizontal = (page: Page) =>
  page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)

test('Início sem rolagem horizontal no Pixel 7 e em 320px', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByText('Conversas abertas')).toBeVisible()
  expect(await semScrollHorizontal(page)).toBe(true)
  await page.setViewportSize({ width: 320, height: 640 })
  await expect(page.getByText('Conversas abertas')).toBeVisible()
  expect(await semScrollHorizontal(page)).toBe(true)
})

test('botão do simulador não cobre a navegação inferior', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  const fab = await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).boundingBox()
  const nav = await page.getByRole('navigation').last().boundingBox()
  expect(fab).not.toBeNull()
  expect(nav).not.toBeNull()
  const separados =
    fab!.x + fab!.width <= nav!.x || nav!.x + nav!.width <= fab!.x ||
    fab!.y + fab!.height <= nav!.y || nav!.y + nav!.height <= fab!.y
  expect(separados).toBe(true)
})
