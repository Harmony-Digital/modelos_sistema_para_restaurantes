import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { encryptPhone, keyFromBase64 } from '@atd/core'
import { closeSql, criarMembro, entrar, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Evento ${SUFIXO}`
const ESPACO = `Varanda ${SUFIXO}`
const CLIENTE = `Carla ${SUFIXO}`
const TELEFONE = '5561988887777'

type Item = TriagemFalsa['itens'][number]
const evento = (extra: Partial<Item>): Item => ({
  servico: 'evento', tipo: 'pedido', unidade: UNIDADE, data: 'amanhã', tema: null, pessoas: null, horario: null,
  convidados: null, tipoEvento: null, espaco: null, ...extra,
})

const PERGUNTA_PENDENTE = /<pergunta_pendente>\n([\s\S]*?)\n<\/pergunta_pendente>/
const EM_ANDAMENTO = /<pedido_em_andamento>\n([\s\S]*?)\n<\/pedido_em_andamento>/

function triagem(mensagem: string, user: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  // resposta curta a uma pergunta nossa: a triagem v4 recebe a pergunta e o que já sabemos
  if (PERGUNTA_PENDENTE.test(user)) {
    const conhecido = JSON.parse(EM_ANDAMENTO.exec(user)?.[1] ?? '{}') as Record<string, string | number>
    return {
      itens: [evento({
        unidade: (conhecido.unidade as string | undefined) ?? null,
        data: (conhecido.data as string | undefined) ?? null,
        convidados: (conhecido.convidados as number | undefined) ?? null,
        tipoEvento: m.trim(),
      })],
      fora_escopo: false,
    }
  }
  if (m.includes('aniversário para 40')) return { itens: [evento({ convidados: 40, tipoEvento: 'aniversário' })], fora_escopo: false }
  if (m.includes('festa')) return { itens: [evento({ convidados: 30 })], fora_escopo: false }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let restaurantId = ''
let unitId = ''

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id from restaurants limit 1`
  restaurantId = r!.id as string
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'ia', ${periodo}, 5) on conflict do nothing`
  }
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE}, ${'e2e-evento-' + SUFIXO}, 'Rua do Evento, 1') returning id`
  unitId = u!.id as string
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
      values (${restaurantId}, ${unitId}, ${weekday}, 1, '00:00', '23:59')`
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  // pedidos e espaços da unidade E2E saem junto com ela (on delete cascade)
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from customers where wa_id_hash like ${'e2e-evento:%'}`
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

/** Página sem rolagem horizontal (nada estoura a largura do celular). */
async function semRolagemHorizontal(page: Page) {
  const { largura, visivel } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth,
    visivel: document.documentElement.clientWidth,
  }))
  expect(largura).toBeLessThanOrEqual(visivel)
}

// janela 23:59–00:00 (horário de Brasília): "amanhã" é calculado aqui e de novo pelo worker; se a meia-noite passar
// entre os dois, as datas divergem e o teste falha sem defeito no código. Rode de novo depois da meia-noite.
const amanha = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() + 86_400_000))

test('simulador registra o pedido de evento, mas a fila não mostra pedido simulado', async ({ page }) => {
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  await perguntar(page, `quero fazer um aniversário para 40 pessoas na ${UNIDADE} dia amanhã`)
  await expect(simulador(page).getByText(/^Recebemos seu pedido/)).toBeVisible({ timeout: 20_000 })
  await expect(simulador(page).getByText(/^Recebemos seu pedido/)).toContainText('40 convidados')

  const gravados = await getSql()`select convidados, tipo, simulado, status from event_requests where unit_id = ${unitId}`
  expect(gravados).toEqual([{ convidados: 40, tipo: 'aniversario', simulado: true, status: 'novo' }])

  await page.goto(`/agenda?aba=eventos&unidade=${unitId}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(page.getByText('Nenhum pedido de evento por aqui')).toBeVisible()
  // simulado também não entra na contagem da aba
  await expect(page.getByRole('link', { name: 'Eventos', exact: true })).toBeVisible()
})

test('coleta em mensagens: sem tipo, pergunta "Qual o tipo do evento?" e registra com a resposta', async ({ page }) => {
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  const antes = falso!.entradas.length
  await perguntar(page, `quero fazer uma festa na ${UNIDADE} amanhã para 30 convidados`)
  await expect(simulador(page).getByText(/^Qual o tipo do evento\?/)).toBeVisible({ timeout: 20_000 })
  await perguntar(page, 'aniversário')
  await expect(simulador(page).getByText(/^Recebemos seu pedido/).last()).toContainText('30 convidados', { timeout: 20_000 })

  // a resposta curta passou pela triagem v4 com a pergunta pendente e o que já sabíamos
  const segunda = falso!.entradas.slice(antes)[1] ?? ''
  expect(segunda).toMatch(PERGUNTA_PENDENTE)
  expect(PERGUNTA_PENDENTE.exec(segunda)?.[1]).toMatch(/^Qual o tipo do evento\?/)
  expect(JSON.parse(EM_ANDAMENTO.exec(segunda)?.[1] ?? '{}')).toMatchObject({ unidade: UNIDADE, data: amanha(), convidados: 30 })

  const [p] = await getSql()`select tipo, simulado from event_requests where unit_id = ${unitId} and convidados = 30`
  expect(p).toEqual({ tipo: 'aniversario', simulado: true })
})

test('dono cadastra espaço na unidade; mínimo maior que o máximo dá erro', async ({ page }) => {
  await entrarComoGestor(page)
  await page.goto(`/unidades/${unitId}?aba=espacos`)
  await expect(page.getByText('Nenhum espaço cadastrado')).toBeVisible()
  await page.getByRole('button', { name: 'Novo espaço' }).click()
  const folha = page.getByRole('dialog', { name: 'Novo espaço' })
  await folha.getByLabel(/^Nome do espaço/).fill(ESPACO)
  await folha.getByLabel(/^Mínimo de pessoas/).fill('50')
  await folha.getByLabel(/^Máximo de pessoas/).fill('20')
  await folha.getByRole('button', { name: 'Salvar espaço' }).click()
  await expect(folha.getByText('A capacidade mínima não pode ser maior que a máxima.')).toBeVisible()

  await folha.getByLabel(/^Mínimo de pessoas/).fill('10')
  await folha.getByRole('button', { name: 'Salvar espaço' }).click()
  await expect(page.getByText('Espaço salvo')).toBeVisible()
  await expect(page.getByRole('listitem', { name: ESPACO })).toContainText('de 10 a 20 pessoas')

  const [e] = await getSql()`select capacidade_min, capacidade_max, ativo from event_spaces where unit_id = ${unitId}`
  expect(e).toEqual({ capacidade_min: 10, capacidade_max: 20, ativo: true })
})

test('pedido real na fila: status, responsável, notas e telefone sob demanda (auditado)', async ({ page }) => {
  const sql = getSql()
  const chave = process.env.PHONE_ENC_KEY
  if (!chave) throw new Error('e2e: PHONE_ENC_KEY precisa estar no ambiente (a mesma do servidor web)')
  const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${restaurantId}, ${'e2e-evento:' + randomBytes(8).toString('hex')}, ${encryptPhone(TELEFONE, keyFromBase64(chave))}, ${CLIENTE})
    returning id`
  const [p] = await sql`insert into event_requests (restaurant_id, unit_id, customer_id, nome, data, convidados, tipo)
    values (${restaurantId}, ${unitId}, ${c!.id}, ${CLIENTE}, ${amanha()}, 40, 'aniversario') returning id`
  const pedidoId = p!.id as string

  const membro = await entrarComoGestor(page)
  const [eu] = await sql`select id from auth.users where email = ${membro.email}`

  // celular estreito: barra com "Agenda" e a aba "Eventos (1 novo)" cabem sem rolagem horizontal
  await page.setViewportSize({ width: 360, height: 740 })
  await page.getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await page.getByRole('link', { name: /^Eventos \(\d+ novos?\)$/ }).click()
  await expect(page.getByRole('link', { name: 'Eventos (1 novo)' })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: new RegExp(CLIENTE) })).toContainText('40 convidados')
  await semRolagemHorizontal(page)
  await expect(page.getByRole('link', { name: 'Agenda', exact: true })).toBeInViewport({ ratio: 1 })

  await page.getByRole('button', { name: new RegExp(CLIENTE) }).click()
  const folha = page.getByRole('dialog', { name: 'Pedido de evento' })
  await expect(folha).toContainText(UNIDADE)
  await folha.getByRole('button', { name: 'Mostrar telefone' }).click()
  await expect(folha.getByText(TELEFONE)).toBeVisible()
  const auditoria = await sql`select acao, diff from audit_log where entidade_id = ${pedidoId} and acao = 'evento.telefone_visualizado'`
  expect(auditoria).toHaveLength(1)
  expect(JSON.stringify(auditoria[0]!.diff ?? null)).not.toContain(TELEFONE)

  await folha.getByLabel(/^Status/).selectOption('em_contato')
  await folha.getByLabel(/^Responsável/).selectOption(eu!.id as string)
  await folha.getByLabel(/^Notas internas/).fill('Ligar depois das 18h')
  await folha.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Pedido atualizado.')).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(CLIENTE) })).toContainText('Em contato')

  const [depois] = await sql`select status, responsavel_id, notas_internas from event_requests where id = ${pedidoId}`
  expect(depois).toEqual({ status: 'em_contato', responsavel_id: eu!.id, notas_internas: 'Ligar depois das 18h' })
  // notas nunca vão para o diff da auditoria
  const notas = await sql`select diff from audit_log where entidade_id = ${pedidoId} and acao = 'evento.notas'`
  expect(notas).toHaveLength(1)
  expect(JSON.stringify(notas[0]!.diff ?? null)).not.toContain('18h')
})

test('atendente vê a fila e muda o status, mas não cadastra espaço', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await page.goto('/agenda?aba=eventos')
  await page.getByRole('button', { name: new RegExp(CLIENTE) }).click()
  const folha = page.getByRole('dialog', { name: 'Pedido de evento' })
  await folha.getByLabel(/^Status/).selectOption('confirmado')
  await folha.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Pedido atualizado.')).toBeVisible()
  const [p] = await getSql()`select status from event_requests where unit_id = ${unitId} and nome = ${CLIENTE}`
  expect(p).toEqual({ status: 'confirmado' })

  await page.goto(`/unidades/${unitId}?aba=espacos`)
  await expect(page.getByRole('listitem', { name: ESPACO })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo espaço' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Editar espaço ${ESPACO}` })).toHaveCount(0)
})
