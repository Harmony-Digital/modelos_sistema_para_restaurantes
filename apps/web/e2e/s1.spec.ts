import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE_RELOGIO = `E2E Relogio ${SUFIXO}`
const TEMA = `estacionamento e2e ${SUFIXO}`
const RESPOSTA = `Temos estacionamento conveniado no subsolo (${SUFIXO}).`

const item = (servico: string, tipo: string | null, extra: Partial<TriagemFalsa['itens'][number]> = {}) =>
  ({ servico, tipo, unidade: null, data: null, tema: null, pessoas: null, horario: null, ...extra })

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  if (m.includes('estacionamento')) return { itens: [item('horario_unidades', 'info', { tema: TEMA })], fora_escopo: false }
  if (m.includes('aberto')) return { itens: [item('horario_unidades', 'aberto_agora', { unidade: UNIDADE_RELOGIO })], fora_escopo: false }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined

test.beforeAll(async () => {
  const [r] = await getSql()`select id from restaurants limit 1`
  // a triagem reserva orçamento antes de chamar a IA: garante limites no banco do e2e
  for (const periodo of ['dia', 'mes']) {
    await getSql()`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'ia', ${periodo}, 5) on conflict do nothing`
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from knowledge_facts where tema ilike ${'%' + SUFIXO + '%'}`
  await sql`delete from knowledge_gaps where chave_normalizada ilike ${'%' + SUFIXO + '%'}`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

const simulador = (page: Page) => page.getByRole('dialog', { name: 'Simulador de WhatsApp' })

async function abrirSimuladorLimpo(page: Page) {
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  await expect(simulador(page)).toBeVisible()
  // espera a ação "Novo cliente" voltar: mensagem enviada antes disso iria para a conversa que ela encerrou
  // (Server Action sem argumentos disparada depois do clique; a abertura dispara a dela antes)
  const pedido = page.waitForRequest((r) => r.method() === 'POST' && r.headers()['next-action'] !== undefined && r.postData() === '[]')
  await simulador(page).getByRole('button', { name: 'Novo cliente' }).click()
  await (await pedido).response()
}

async function perguntar(page: Page, texto: string) {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill(texto)
  await page.keyboard.press('Enter')
}

/**
 * Próximo domingo (no fuso do restaurante) às 12:00, no formato do campo datetime-local.
 * Janela 23:59–00:00 (horário de Brasília): o dia é calculado aqui e o relógio simulado é aplicado depois; se a
 * meia-noite passar entre os dois, o deslocamento muda e o teste pode falhar sem defeito no código. Rode de novo.
 */
function proximoDomingoAoMeioDia(): string {
  const fuso = 'America/Sao_Paulo'
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000)
    if (new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short' }).format(d) === 'Sun') {
      return `${new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(d)}T12:00`
    }
  }
  throw new Error('domingo não encontrado')
}

test('cadastra unidade e horários; a lista mostra "Aberta agora"', async ({ page }) => {
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Unidades', exact: true }).click()
  await page.getByRole('button', { name: 'Nova unidade' }).click()
  const nome = `E2E Centro ${SUFIXO}`
  await page.getByLabel(/^Nome/).fill(nome)
  await page.getByLabel(/^Endereço/).fill('Rua do Teste, 100')
  await page.getByRole('button', { name: 'Salvar unidade' }).click()
  // depois de salvar, a tela leva à aba Horários
  const segunda = page.getByRole('group', { name: 'Segunda-feira' })
  await segunda.getByRole('button', { name: 'Adicionar turno' }).click()
  await segunda.getByLabel(/^Abre/).fill('00:00')
  await segunda.getByLabel(/^Fecha/).fill('23:59')
  await page.getByRole('button', { name: 'Copiar segunda para todos os dias' }).click()
  await page.getByRole('button', { name: 'Salvar horários' }).click()
  await expect(page.getByText('Horários salvos')).toBeVisible()
  await page.getByRole('link', { name: 'Unidades', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: nome })).toContainText('Aberta agora')
})

test('formulário de unidade: erro no campo certo, sem gravar', async ({ page }) => {
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Unidades', exact: true }).click()
  await page.getByRole('button', { name: 'Nova unidade' }).click()
  // o SubmitButton não tira o foco no mousedown: o clique envia mesmo com o erro do blur do Nome
  await page.getByRole('button', { name: 'Salvar unidade' }).click()
  await expect(page.getByRole('region', { name: 'Corrija 1 campo' })).toBeVisible()
  await expect(page.getByLabel(/^Nome/)).toHaveAccessibleDescription(/Informe o nome da unidade, como "Asa Sul"/)
  await expect(page.getByLabel(/^Nome/)).toBeFocused()
})

test('pergunta sem resposta: o dono responde e o simulador passa a responder', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into knowledge_gaps (restaurant_id, chave_normalizada, pergunta_mascarada)
    values (${r!.id}, ${'info:' + TEMA}, 'tem estacionamento?')`
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Respostas' }).click()
  await page.getByRole('button', { name: new RegExp(`^Responder: ${TEMA}`, 'i') }).click()
  await page.getByLabel(/^Resposta/).fill(RESPOSTA)
  await page.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText(/^Informação salva/)).toBeVisible()

  await abrirSimuladorLimpo(page)
  await perguntar(page, 'tem estacionamento?')
  await expect(simulador(page).getByText(RESPOSTA)).toBeVisible({ timeout: 20_000 })
  expect(falso!.chamadas).toContain('tem estacionamento?')
})

test('simulador com relógio no domingo 12h responde pelo horário de domingo', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  const [u] = await getSql()`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE_RELOGIO}, ${'e2e-relogio-' + SUFIXO}, 'Rua do Relógio, 1') returning id`
  await getSql()`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
    values (${r!.id}, ${u!.id}, 0, 1, '11:30', '16:00')`
  const { email } = await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  const s = simulador(page)
  await s.getByRole('button', { name: 'Simular data e hora' }).click()
  await s.getByLabel('Data e hora simuladas').fill(proximoDomingoAoMeioDia())
  await s.getByRole('button', { name: 'Aplicar' }).click()
  await expect(s.getByText(/^Relógio simulado: domingo/)).toBeVisible()
  await perguntar(page, `está aberto agora na ${UNIDADE_RELOGIO}?`)
  await expect(s.getByText(`A unidade ${UNIDADE_RELOGIO} está aberta agora`, { exact: false })).toBeVisible({ timeout: 20_000 })
  // nada saiu pela Meta: toda saída da conversa simulada ficou "simulado"
  const saidas = await getSql()`select m.status_envio from messages m
    join conversations c on c.id = m.conversation_id join customers cu on cu.id = c.customer_id
    where c.simulada and m.direcao = 'out'
      and split_part(cu.wa_id_hash, ':', 2) = (select id::text from auth.users where email = ${email})`
  expect(saidas.length).toBeGreaterThan(0)
  expect(saidas.every((x) => x.status_envio === 'simulado')).toBe(true)
})
