import { expect, type Locator, type Page } from '@playwright/test'
import { getAdmin, getSql } from './helpers'

export type LogoInicial = { restaurantId: string; logoPath: string | null }

/** Logo do restaurante antes do e2e: o `afterAll` volta exatamente a ela. */
export async function lerLogoInicial(): Promise<LogoInicial> {
  const [r] = await getSql()<{ id: string; logo_path: string | null }[]>`select id, logo_path from restaurants limit 1`
  return { restaurantId: r!.id, logoPath: r!.logo_path }
}

/** Volta `logo_path` ao valor inicial e apaga do bucket `marca` toda logo que o e2e enviou (a inicial fica). */
export async function restaurarLogo(inicial: LogoInicial | undefined) {
  if (!inicial) return
  await getSql()`update restaurants set logo_path = ${inicial.logoPath} where id = ${inicial.restaurantId}`
  const marca = getAdmin().storage.from('marca')
  const { data } = await marca.list(inicial.restaurantId, { limit: 1000 })
  const sobras = (data ?? [])
    .map((o) => `${inicial.restaurantId}/${o.name}`)
    .filter((caminho) => caminho.includes('/logo-') && caminho !== inicial.logoPath)
  if (sobras.length) await marca.remove(sobras)
}

/** Objetos de logo no bucket `marca` do restaurante. */
export async function objetosDaMarca(restaurantId: string): Promise<string[]> {
  const { data } = await getAdmin().storage.from('marca').list(restaurantId, { limit: 1000 })
  return (data ?? []).map((o) => `${restaurantId}/${o.name}`).filter((c) => c.includes('/logo-'))
}

/** Ajustes → Logo: escolhe o arquivo e envia (ou troca). */
export async function enviarLogo(page: Page, arquivo: { name: string; buffer: Buffer; mimeType?: string }) {
  await page.getByLabel(/^Imagem da logo/).setInputFiles({ mimeType: 'image/png', ...arquivo })
  await page.getByRole('button', { name: /^(Enviar|Trocar) logo$/ }).click()
}

/** Ajustes → Logo: remove com a confirmação. */
export async function removerLogo(page: Page) {
  await page.getByRole('button', { name: 'Remover logo' }).click()
  await page.getByRole('dialog', { name: 'Remover a logo?' }).getByRole('button', { name: 'Remover logo' }).click()
  await expect(page.getByText('Logo removida')).toBeVisible()
}

/** A imagem carregou de verdade (URL pública do bucket) e o quadro tem o tamanho pedido, qualquer que seja a proporção. */
export async function logoNoQuadro(img: Locator, lado: number, natural?: { largura: number; altura: number }) {
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true)
  const caixa = await img.boundingBox()
  expect(caixa?.width).toBeCloseTo(lado, 0)
  expect(caixa?.height).toBeCloseTo(lado, 0)
  expect(await img.evaluate((e) => getComputedStyle(e).objectFit)).toBe('contain')
  if (natural) {
    const n = await img.evaluate((e: HTMLImageElement) => ({ largura: e.naturalWidth, altura: e.naturalHeight }))
    expect(n).toEqual(natural)
  }
}
