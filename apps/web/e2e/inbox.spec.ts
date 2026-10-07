import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSql, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Inbox ${SUFIXO}`
const UNIDADE_OUTRA = `E2E Inbox Outra ${SUFIXO}`
const CLIENTE_REAL = `Cliente Inbox ${SUFIXO}`
const TITULO_RAPIDA = `Saudação ${SUFIXO}`
const TEXTO_RAPIDA = `Oi! Aqui é da equipe, já vou te ajudar (${SUFIXO}).`
const PEDIDO_ATENDENTE = 'quero falar com um atendente'

const item = (servico: string, tipo: string | null, extra: Partial<TriagemFalsa['itens'][number]> = {}) =>
  ({ servico, tipo, unidade: null, data: null, tema: null, pessoas: null, horario: null, ...extra })

function triagem(mensagem: string): TriagemFalsa {
  if (mensagem.toLowerCase().includes('aberto')) {
    return { itens: [item('horario_unidades', 'aberto_agora', { unidade: UNIDADE })], fora_escopo: false }
  }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let restaurantId = ''
let unitId = ''
let outraUnitId = ''
let horarioOriginal: unknown = null

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id, horario_atendimento_humano from restaurants limit 1`
  restaurantId = r!.id as string
  horarioOriginal = r!.horario_atendimento_humano
  // começa sem horário da equipe: a tela de Atendimento humano é que cadastra (e o afterAll devolve o original)
  await sql`update restaurants set horario_atendimento_humano = ${sql.json({ dias: {} })} where id = ${restaurantId}`
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'ia', ${periodo}, 5) on conflict do nothing`
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'simulacao', ${periodo}, 5) on conflict do nothing`
  }
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE}, ${'e2e-inbox-' + SUFIXO}, 'Rua da Inbox, 1') returning id`
  unitId = u!.id as string
  const [o] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE_OUTRA}, ${'e2e-inbox-outra-' + SUFIXO}, 'Rua da Inbox, 2') returning id`
  outraUnitId = o!.id as string
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
  if (restaurantId) {
    await sql`update restaurants set horario_atendimento_humano = ${sql.json((horarioOriginal ?? { dias: {} }) as never)} where id = ${restaurantId}`
  }
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from customers where wa_id_hash like ${'e2e-inbox:%'}`
  await sql`delete from quick_replies where titulo = ${TITULO_RAPIDA}`
  await sql`delete from units where nome like 'E2E %'`
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

async function semRolagemHorizontal(page: Page) {
  const { largura, visivel } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth,
    visivel: document.documentElement.clientWidth,
  }))
  expect(largura).toBeLessThanOrEqual(visivel)
}

/** Conversa simulada mais recente do usuário (o cliente simulado é por pessoa da equipe). */
async function conversaSimuladaDe(email: string) {
  const [c] = await getSql()`select c.id, c.estado from conversations c join customers cu on cu.id = c.customer_id
    where c.simulada and split_part(cu.wa_id_hash, ':', 2) = (select id::text from auth.users where email = ${email})
    order by c.created_at desc limit 1`
  return c as { id: string; estado: string } | undefined
}

/**
 * Próximo sábado (no fuso do restaurante) às 12:00, no formato do campo datetime-local. Do sábado, a próxima abertura
 * de segunda a sexta é "na segunda". Janela 23:59–00:00 (horário de Brasília): veja o aviso do s1.spec.
 */
function proximoSabadoAoMeioDia(): string {
  const fuso = 'America/Sao_Paulo'
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000)
    if (new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short' }).format(d) === 'Sat') {
      return `${new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(d)}T12:00`
    }
  }
  throw new Error('sábado não encontrado')
}

test('dono cadastra uma resposta rápida em Conteúdo → Mensagens', async ({ page }) => {
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Conteúdo', exact: true }).click()
  await page.getByRole('link', { name: 'Mensagens', exact: true }).click()
  await page.getByRole('button', { name: 'Nova resposta' }).click()
  const folha = page.getByRole('dialog', { name: 'Nova resposta' })
  await folha.getByLabel(/^Título/).fill(TITULO_RAPIDA)
  await folha.getByLabel(/^Texto/).fill(TEXTO_RAPIDA)
  await folha.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText('Resposta salva')).toBeVisible()
  await expect(page.getByRole('listitem', { name: TITULO_RAPIDA })).toContainText(TEXTO_RAPIDA)
  const linhas = await getSql()`select texto, ativo from quick_replies where titulo = ${TITULO_RAPIDA}`
  expect(linhas).toEqual([{ texto: TEXTO_RAPIDA, ativo: true }])
})

test('pedido de atendente: a conversa aparece em Aguardando sem recarregar; assumir, responder e devolver à IA', async ({ page, context }) => {
  const { email } = await entrarComoGestor(page)

  // segunda aba do mesmo usuário, aberta ANTES do handoff, na largura de um celular pequeno
  const inbox = await context.newPage()
  await inbox.setViewportSize({ width: 360, height: 740 })
  let recargas = 0
  const conectou = inbox.waitForEvent('websocket')
  await inbox.goto('/conversas?aba=aguardando&sim=1')
  await expect(inbox.getByRole('heading', { level: 1, name: 'Conversas' })).toBeVisible()
  await conectou
  inbox.on('load', () => { recargas++ })
  await semRolagemHorizontal(inbox)

  await abrirSimuladorLimpo(page)
  await perguntar(page, PEDIDO_ATENDENTE)
  await expect(simulador(page).getByText(/^Vou passar você para alguém da nossa equipe/)).toBeVisible({ timeout: 20_000 })
  // pedido explícito é resolvido pelo pré-filtro: a IA nem é chamada
  expect(falso!.chamadas).not.toContain(PEDIDO_ATENDENTE)
  const conversa = await conversaSimuladaDe(email)
  expect(conversa?.estado).toBe('aguardando_humano')

  // tempo real: chega pelo Realtime (o fallback sem conexão é de 60 s), sem recarregar a página
  const item = inbox.locator(`a[href^="/conversas/${conversa!.id}"]`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  await expect(item).toContainText('Pediu atendente')
  await expect(item).toContainText('Simulação')
  expect(recargas).toBe(0)
  await semRolagemHorizontal(inbox)

  await item.click()
  await inbox.getByRole('button', { name: 'Assumir' }).click()
  await expect(inbox.getByText('Conversa assumida. Agora é com você.')).toBeVisible()
  await expect(inbox.getByText('Você está atendendo esta conversa.')).toBeVisible()
  await semRolagemHorizontal(inbox)

  // resposta rápida preenche o campo; o envio sai pela fila do worker como "simulado"
  await inbox.getByRole('button', { name: 'Respostas rápidas' }).click()
  await inbox.getByRole('menuitem', { name: new RegExp(TITULO_RAPIDA) }).click()
  await expect(inbox.getByRole('textbox', { name: 'Resposta' })).toHaveValue(TEXTO_RAPIDA)
  await inbox.getByRole('button', { name: 'Enviar' }).click()
  await expect(inbox.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible()
  await expect(simulador(page).getByText(TEXTO_RAPIDA)).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(async () => (await getSql()`select autor, status_envio from messages
      where conversation_id = ${conversa!.id} and direcao = 'out' and autor = 'humano'`).map((m) => m.status_envio))
    .toEqual(['simulado'])

  await inbox.getByRole('button', { name: 'Devolver à IA' }).click()
  await expect(inbox.getByText('Conversa devolvida à IA.')).toBeVisible()
  expect((await conversaSimuladaDe(email))?.estado).toBe('ia')

  // de volta com a IA: a próxima pergunta é respondida pelo pipeline normal
  await perguntar(page, `está aberto agora na ${UNIDADE}?`)
  await expect(simulador(page).getByText(`A unidade ${UNIDADE} está aberta agora`, { exact: false })).toBeVisible({ timeout: 20_000 })
  await inbox.close()
})

test('gerente restrito a outra unidade não vê a conversa (nem pela URL)', async ({ page }) => {
  const sql = getSql()
  const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${restaurantId}, ${'e2e-inbox:' + randomBytes(8).toString('hex')}, 'x', ${CLIENTE_REAL}) returning id`
  const [conv] = await sql`insert into conversations (restaurant_id, customer_id, estado, unidade_contexto_id, handoff_motivo)
    values (${restaurantId}, ${c!.id}, 'aguardando_humano', ${unitId}, 'pedido') returning id`
  const { email } = await entrarComoGestor(page, 'gerente')
  await sql`update staff set unidades_permitidas = ${[outraUnitId]}::uuid[]
    where user_id = (select id from auth.users where email = ${email})`

  await page.goto('/conversas?aba=aguardando')
  await expect(page.getByRole('heading', { level: 1, name: 'Conversas' })).toBeVisible()
  await expect(page.getByText(CLIENTE_REAL)).toHaveCount(0)
  await page.goto(`/conversas/${conv!.id}`)
  await expect(page.getByText(CLIENTE_REAL)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Assumir' })).toHaveCount(0)

  // controle: com a unidade da conversa liberada, a mesma pessoa passa a vê-la
  await sql`update staff set unidades_permitidas = ${[unitId]}::uuid[]
    where user_id = (select id from auth.users where email = ${email})`
  await page.goto('/conversas?aba=aguardando')
  await expect(page.locator(`a[href^="/conversas/${conv!.id}"]`)).toContainText(CLIENTE_REAL)
})

test('horário humano salvo; handoff fora do horário avisa quando a equipe volta (relógio simulado)', async ({ page }) => {
  const { email } = await entrarComoGestor(page, 'dono')
  await page.getByRole('button', { name: 'Mais', exact: true }).click()
  await page.getByRole('dialog', { name: 'Mais' }).getByRole('link', { name: 'Ajustes', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Horário de atendimento humano' })).toBeVisible()
  const segunda = page.getByRole('group', { name: 'Segunda' })
  await segunda.getByRole('button', { name: 'Adicionar turno' }).click()
  await segunda.getByLabel(/^Começa/).fill('09:00')
  await segunda.getByLabel(/^Termina/).fill('18:00')
  await page.getByRole('button', { name: 'Copiar segunda para dias úteis' }).click()
  await page.getByRole('button', { name: 'Salvar horário' }).click()
  await expect(page.getByText('Horário salvo')).toBeVisible()
  const [r] = await getSql()`select horario_atendimento_humano as h from restaurants where id = ${restaurantId}`
  const turno = [{ inicio: '09:00', fim: '18:00' }]
  expect(r!.h).toEqual({ dias: { seg: turno, ter: turno, qua: turno, qui: turno, sex: turno } })

  await abrirSimuladorLimpo(page)
  const s = simulador(page)
  await s.getByRole('button', { name: 'Simular data e hora' }).click()
  await s.getByLabel('Data e hora simuladas').fill(proximoSabadoAoMeioDia())
  await s.getByRole('button', { name: 'Aplicar' }).click()
  await expect(s.getByText(/^Relógio simulado: sábado/)).toBeVisible()
  await perguntar(page, PEDIDO_ATENDENTE)
  await expect(s.getByText('Nossa equipe atende na segunda a partir das 9h', { exact: false })).toBeVisible({ timeout: 20_000 })
  expect((await conversaSimuladaDe(email))?.estado).toBe('aguardando_humano')
})
