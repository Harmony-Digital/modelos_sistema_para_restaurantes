import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { codigoTotp } from './totp'

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

export async function criarMembro(papel: 'dono' | 'gerente' | 'atendente') {
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

/** Dono/gerente novo: entra, cadastra o autenticador lendo a chave da tela e confirma com o código TOTP. */
export async function entrarComoGestor(page: Page, papel: 'dono' | 'gerente' = 'dono') {
  const membro = await criarMembro(papel)
  await entrar(page, membro.email, membro.senha)
  await page.waitForURL('**/mfa')
  // em dev o StrictMode roda o efeito duas vezes e a tela pode trocar de chave logo após aparecer:
  // só usa a chave depois que ela fica igual em duas leituras seguidas
  const chave = page.locator('p.font-mono')
  let segredo = ''
  await expect
    .poll(async () => {
      const anterior = segredo
      segredo = (await chave.textContent())?.trim() ?? ''
      return segredo !== '' && segredo === anterior
    }, { intervals: [1_000] })
    .toBe(true)
  // código perto de virar: espera o próximo período para não falhar na fronteira
  const restante = 30_000 - (Date.now() % 30_000)
  if (restante < 3_000) await page.waitForTimeout(restante + 200)
  await page.getByLabel(/^Código de 6 dígitos/).fill(codigoTotp(segredo))
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  return membro
}
