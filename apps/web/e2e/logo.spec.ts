import { expect, test } from '@playwright/test'
import { closeSql, entrarComoGestor, getSql } from './helpers'
import { enviarLogo, lerLogoInicial, logoNoQuadro, objetosDaMarca, removerLogo, restaurarLogo, type LogoInicial } from './marca'
import { pngDeTeste } from './png'

// Logo do restaurante no celular: Ajustes → Logo, topo da barra (24 px), tela de login e a tela de Unidade rolando.

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Logo ${SUFIXO}`

let inicial: LogoInicial | undefined
let unitId = ''
let nomeRestaurante = ''

test.beforeAll(async () => {
  inicial = await lerLogoInicial()
  // o teste parte de "sem logo" (a inicial volta no afterAll)
  await getSql()`update restaurants set logo_path = null where id = ${inicial.restaurantId}`
  const [r] = await getSql()`select nome from restaurants where id = ${inicial.restaurantId}`
  nomeRestaurante = r!.nome as string
  const [u] = await getSql()`insert into units (restaurant_id, nome, slug, endereco)
    values (${inicial.restaurantId}, ${UNIDADE}, ${'e2e-logo-' + SUFIXO}, 'Rua da Logo, 1') returning id`
  unitId = u!.id as string
})

test.afterAll(async () => {
  await restaurarLogo(inicial)
  await getSql()`delete from units where nome like 'E2E %'`
  await getSql()`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

test('logo: arquivo .png que é SVG é recusado; enviada aparece no topo e no login; a Unidade rola sem a barra cobrir as seções; removida some', async ({ page, browser }) => {
  await entrarComoGestor(page)
  await page.goto('/ajustes')
  const barra = page.locator('header').first()

  // SVG com extensão .png: conferido pelos bytes no servidor, nada vai ao Storage nem ao banco
  await enviarLogo(page, { name: 'logo.png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') })
  await expect(page.getByText('Envie a logo em PNG, JPG ou WebP (SVG não é aceito).')).toBeVisible()
  expect(await objetosDaMarca(inicial!.restaurantId)).toEqual([])

  await enviarLogo(page, { name: 'logo.png', buffer: pngDeTeste(400, 200) })
  await expect(page.getByText('Logo enviada')).toBeVisible()
  const [r] = await getSql()`select logo_path from restaurants where id = ${inicial!.restaurantId}`
  expect(r!.logo_path).toMatch(new RegExp(`^${inicial!.restaurantId}/logo-[0-9a-f]{64}\\.png$`))
  expect(await objetosDaMarca(inicial!.restaurantId)).toEqual([r!.logo_path])

  // topo do celular: logo de 24 px ao lado do nome, na mesma linha do título
  await logoNoQuadro(barra.locator('img'), 24, { largura: 400, altura: 200 })
  await expect(barra).toContainText(nomeRestaurante)

  // tela de login (sem sessão): logo e nome do único restaurante
  const anonimo = await browser.newPage()
  await anonimo.goto('/login')
  await logoNoQuadro(anonimo.locator('img'), 32)
  await expect(anonimo.getByText(nomeRestaurante)).toBeVisible()

  // Unidade no celular: a barra com a logo não cresce e, rolando, não cobre a navegação das seções
  await page.goto(`/unidades/${unitId}`)
  const topo = page.getByRole('region', { name: `Unidade ${UNIDADE}` }).locator('header')
  const secoes = page.getByRole('navigation', { name: 'Seções da unidade' })
  await expect(topo.getByRole('heading', { level: 1, name: UNIDADE })).toBeVisible()
  await logoNoQuadro(topo.locator('img'), 24)
  const altura = (await topo.boundingBox())!.height
  expect(altura).toBeLessThanOrEqual(66) // min-h-16 + borda: a mesma altura de sem logo
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  const caixaTopo = (await topo.boundingBox())!
  const caixaSecoes = (await secoes.boundingBox())!
  expect(caixaTopo.y).toBeCloseTo(0, 0)
  expect(caixaSecoes.y).toBeGreaterThanOrEqual(caixaTopo.y + caixaTopo.height - 1)
  await expect(secoes.getByRole('link', { name: 'Espaços' })).toBeVisible()
  await secoes.getByRole('link', { name: 'Espaços' }).click() // clicável: nada por cima

  // remover: some do topo e do login; o objeto sai do bucket
  await page.goto('/ajustes')
  await removerLogo(page)
  await expect(barra.locator('img')).toHaveCount(0)
  const [depois] = await getSql()`select logo_path from restaurants where id = ${inicial!.restaurantId}`
  expect(depois!.logo_path).toBeNull()
  await expect.poll(() => objetosDaMarca(inicial!.restaurantId)).toEqual([])
  await anonimo.goto('/login')
  await expect(anonimo.getByRole('heading', { name: 'Atendimento IA' }).or(anonimo.getByText('Atendimento IA'))).toBeVisible()
  await expect(anonimo.locator('img')).toHaveCount(0)
  await anonimo.close()
})
