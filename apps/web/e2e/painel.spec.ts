import { expect, test, type Page } from '@playwright/test'
import { closeSql, criarMembro, entrar, entrarComoGestor, getSql } from './helpers'

test.afterAll(async () => {
  await getSql()`delete from auth.users where email like '%@teste.local'`
  await getSql()`delete from customers where nome_perfil = 'Cliente E2E'`
  await closeSql()
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
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const cookies = await context.cookies()
  expect(cookies.find((c) => c.name === 'atd-tema')?.value).toBe('escuro')
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
  const [r] = await getSql()`select id from restaurants limit 1`
  const [c] = await getSql()`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${r!.id}, ${'e2e-' + Date.now()}, 'x', 'Cliente E2E') returning id`
  await getSql()`insert into conversations (restaurant_id, customer_id, estado) values (${r!.id}, ${c!.id}, 'aguardando_humano')`
  await entrar(page, email, senha)
  await page.getByRole('button', { name: 'Devolver à IA a conversa de Cliente E2E' }).click()
  await expect(page.getByText('Conversa devolvida à IA')).toBeVisible()
  const [conv] = await getSql()`select estado from conversations where customer_id = ${c!.id}`
  expect(conv!.estado).toBe('ia')
})

test('atendente não vê o simulador (ele gasta IA real)', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveCount(0)
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

for (const largura of [412, 320]) {
  test(`botão do simulador não cobre a navegação inferior (${largura}px)`, async ({ page }) => {
    // o simulador só aparece para dono/gerente (Task 13)
    await page.setViewportSize({ width: largura, height: 640 })
    await entrarComoGestor(page)
    const fab = page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })
    const nav = page.getByRole('navigation', { name: 'Navegação principal' })
    await expect(fab).toBeVisible()
    await expect(nav).toBeVisible()
    const caixas = async () => ({ fab: await fab.boundingBox(), nav: await nav.boundingBox() })
    await expect
      .poll(async () => {
        const { fab: f, nav: n } = await caixas()
        if (!f || !n) return false
        return f.x + f.width <= n.x || n.x + n.width <= f.x || f.y + f.height <= n.y || n.y + n.height <= f.y
      })
      .toBe(true)
  })
}
