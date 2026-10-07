import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, criarMembro, entrar, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Aviso ${SUFIXO}`
const NOME_PAINEL = `Ana ${SUFIXO}`
const NOME_ATENDENTE = `Bia ${SUFIXO}`

type Item = TriagemFalsa['itens'][number]
const aviso = (extra: Partial<Item>): Item =>
  ({ servico: 'aviso_presenca', tipo: 'registrar', unidade: UNIDADE, data: null, tema: null, pessoas: null, horario: null, ...extra })

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  // sem hora: um horário fixo de hoje pode já ter passado quando o teste roda (e o aviso seria recusado)
  if (m.startsWith('vou hoje')) return { itens: [aviso({ data: 'hoje', pessoas: 4, horario: 'à noite' })], fora_escopo: false }
  if (m.startsWith('vou amanhã')) return { itens: [aviso({ data: 'amanhã' })], fora_escopo: false }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let unitId = ''

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id from restaurants limit 1`
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'ia', ${periodo}, 5) on conflict do nothing`
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'simulacao', ${periodo}, 5) on conflict do nothing`
  }
  // unidade aberta o dia todo, nos 7 dias: os testes não dependem da hora em que rodam
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE}, ${'e2e-aviso-' + SUFIXO}, 'Rua do Aviso, 1') returning id`
  unitId = u!.id as string
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
      values (${r!.id}, ${unitId}, ${weekday}, 1, '00:00', '23:59')`
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  // avisos da unidade E2E saem junto com ela (on delete cascade)
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

const simulador = (page: Page) => page.getByRole('dialog', { name: 'Simulador de WhatsApp' })

async function abrirSimuladorLimpo(page: Page) {
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  await expect(simulador(page)).toBeVisible()
  // espera a ação "Novo cliente" voltar (mesmo cuidado do s1.spec)
  const pedido = page.waitForRequest((r) => r.method() === 'POST' && r.headers()['next-action'] !== undefined && r.postData() === '[]')
  await simulador(page).getByRole('button', { name: 'Novo cliente' }).click()
  await (await pedido).response()
}

async function perguntar(page: Page, texto: string) {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill(texto)
  await page.keyboard.press('Enter')
}

const previsaoDaUnidade = (page: Page) => page.goto(`/agenda?unidade=${unitId}`)

test('simulador anota o aviso, mas a previsão de hoje não mostra aviso simulado', async ({ page }) => {
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  await perguntar(page, `vou hoje na ${UNIDADE} com 4 pessoas à noite`)
  await expect(simulador(page).getByText(/^Anotado:/)).toBeVisible({ timeout: 20_000 })

  const gravados = await getSql()`select pessoas, simulado, origem from attendance_notices where unit_id = ${unitId} and status = 'confirmada'`
  expect(gravados).toEqual([{ pessoas: 4, simulado: true, origem: 'ia' }])

  await previsaoDaUnidade(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(page.getByText('Nada na agenda para hoje')).toBeVisible()
  await expect(page.getByText('4 pessoas')).toHaveCount(0)
})

test('sem pessoas, pergunta "Para quantas pessoas?" e anota com a resposta sem chamar a IA de novo', async ({ page }) => {
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  const antes = falso!.chamadas.length
  await perguntar(page, `vou amanhã na ${UNIDADE}`)
  await expect(simulador(page).getByText('Para quantas pessoas?')).toBeVisible({ timeout: 20_000 })
  await perguntar(page, '3')
  await expect(simulador(page).getByText(/^Anotado:/)).toBeVisible({ timeout: 20_000 })
  await expect(simulador(page).getByText(/^Anotado:/)).toContainText('3 pessoas')
  // só a primeira mensagem passou pela triagem paga; o "3" foi lido pelo pendente
  expect(falso!.chamadas.slice(antes)).toEqual([`vou amanhã na ${UNIDADE}`])
})

test('painel: nova reserva aparece na agenda, com a lotação, e sai ao cancelar', async ({ page }) => {
  await getSql()`update units set capacidade_pessoas = 50 where id = ${unitId}`
  await entrarComoGestor(page)
  await previsaoDaUnidade(page)
  await expect(page.getByText('Nada na agenda para hoje')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Lotação do dia' })).toContainText('0/50')
  await page.getByRole('button', { name: 'Nova reserva' }).click()
  await page.getByLabel(/^Pessoas/).fill('6')
  // a unidade abre 00:00–23:59: o último minuto do dia ainda não passou quando o teste roda
  await page.getByLabel(/^Horário/).fill('23:58')
  await page.getByLabel(/^Nome/).fill(NOME_PAINEL)
  await page.getByRole('button', { name: 'Salvar reserva' }).click()
  await expect(page.getByText('Reserva anotada.')).toBeVisible()

  const secao = page.getByRole('list', { name: 'Linha do tempo do dia' })
  const linha = secao.getByRole('listitem').filter({ hasText: NOME_PAINEL })
  await expect(linha).toContainText('6 pessoas')
  await expect(linha).toContainText('Confirmada')
  await expect(page.getByTestId('resumo-do-dia')).toContainText('6 pessoas · 1 reserva')
  await expect(page.getByRole('list', { name: 'Lotação do dia' })).toContainText('6/50')

  await linha.getByRole('link').click()
  const detalhe = page.getByRole('dialog', { name: 'Reserva' })
  await detalhe.getByRole('button', { name: 'Cancelada' }).click()
  await expect(page.getByText('Reserva marcada como “Cancelada”.')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Lotação do dia' })).toContainText('0/50')

  const [a] = await getSql()`select status, origem, simulado, horario from attendance_notices where nome = ${NOME_PAINEL}`
  expect(a).toEqual({ status: 'cancelada', origem: 'painel', simulado: false, horario: '23:58:00' })
})

test('atendente vê a agenda, sem "Nova reserva" nem mudar a situação', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into attendance_notices (restaurant_id, unit_id, nome, data, pessoas, origem)
    values (${r!.id}, ${unitId}, ${NOME_ATENDENTE}, (now() at time zone 'America/Sao_Paulo')::date, 2, 'painel')`
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await page.getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  const linha = page.getByRole('listitem').filter({ hasText: NOME_ATENDENTE })
  await expect(linha).toContainText('2 pessoas')
  await expect(page.getByRole('button', { name: 'Nova reserva' })).toHaveCount(0)
  await linha.getByRole('link').click()
  await expect(page.getByRole('dialog', { name: 'Reserva' })).toContainText(NOME_ATENDENTE)
  await expect(page.getByRole('group', { name: 'Mudar a situação' })).toHaveCount(0)
})
