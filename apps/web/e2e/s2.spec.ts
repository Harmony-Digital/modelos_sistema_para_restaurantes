import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, criarMembro, entrar, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Reserva ${SUFIXO}`
const LOTADA = `E2E Lotada ${SUFIXO}`
const NOME_PAINEL = `Ana ${SUFIXO}`
const NOME_ATENDENTE = `Bia ${SUFIXO}`
const NOME_NAO_VEIO = `Caio ${SUFIXO}`
const REGRAS = 'Guardamos o lugar por até 15 minutos após o horário marcado'

type Item = TriagemFalsa['itens'][number]
const reserva = (extra: Partial<Item>): Item =>
  ({ servico: 'aviso_presenca', tipo: 'registrar', unidade: UNIDADE, data: null, tema: null, pessoas: null, horario: null, ...extra })

// só a primeira mensagem de cada conversa passa pela triagem (triage-v7): as respostas curtas ("Maria Souza", "sim",
// "5", o número) seguem a reserva pendente sem o modelo. Amanhã às 20h: um horário de hoje pode já ter passado.
function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  if (m.startsWith('quero reservar amanhã para 4')) return { itens: [reserva({ data: 'amanhã', pessoas: 4, horario: '20h' })], fora_escopo: false }
  if (m.startsWith('quero reservar amanhã para 6')) {
    return { itens: [reserva({ unidade: LOTADA, data: 'amanhã', pessoas: 6, horario: '20h' })], fora_escopo: false }
  }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let unitId = ''
let lotadaId = ''

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
    values (${r!.id}, ${UNIDADE}, ${'e2e-reserva-' + SUFIXO}, 'Rua da Reserva, 1') returning id`
  unitId = u!.id as string
  const [l] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${LOTADA}, ${'e2e-lotada-' + SUFIXO}, 'Rua da Lotação, 1') returning id`
  lotadaId = l!.id as string
  for (const id of [unitId, lotadaId]) {
    for (let weekday = 0; weekday < 7; weekday++) {
      await sql`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
        values (${r!.id}, ${id}, ${weekday}, 1, '00:00', '23:59')`
    }
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  // reservas (e a lotação) das unidades E2E saem junto com elas (on delete cascade)
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

/** Última reserva gravada na unidade (o contato só como "tem ou não": ele fica cifrado). */
async function reservaDoSimulador(unidade: string) {
  const [a] = await getSql()`select a.pessoas, a.nome, a.horario, a.status, a.simulado, a.contato_cifrado is not null as tem_contato,
      a.customer_id
    from attendance_notices a where a.unit_id = ${unidade} order by a.created_at desc limit 1`
  return a!
}

test('simulador: reserva até a confirmação com as regras, um dado por vez e só a primeira mensagem na IA', async ({ page }) => {
  test.setTimeout(120_000) // conversa de várias mensagens, cada uma passando pelo worker
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  const antes = falso!.chamadas.length
  await perguntar(page, `quero reservar amanhã para 4 pessoas às 20h na ${UNIDADE}`)
  await expect(simulador(page).getByText('Em nome de quem fica a reserva?')).toBeVisible({ timeout: 20_000 })
  await perguntar(page, 'Maria Souza')
  await expect(simulador(page).getByText('Posso usar este número do WhatsApp para falar com você sobre a reserva?')).toBeVisible({ timeout: 20_000 })
  await perguntar(page, 'sim')
  const feita = simulador(page).getByText(/^Reserva feita:/)
  await expect(feita).toBeVisible({ timeout: 20_000 })
  await expect(feita).toContainText(`unidade ${UNIDADE}`)
  await expect(feita).toContainText('às 20h')
  await expect(feita).toContainText('4 pessoas')
  await expect(feita).toContainText('em nome de Maria Souza')
  await expect(feita).toContainText(REGRAS)

  // o nome e o "sim" foram lidos pela reserva pendente, sem o modelo
  expect(falso!.chamadas.slice(antes)).toEqual([`quero reservar amanhã para 4 pessoas às 20h na ${UNIDADE}`])
  const a = await reservaDoSimulador(unitId)
  expect(a).toMatchObject({ pessoas: 4, nome: 'Maria Souza', horario: '20:00:00', status: 'confirmada', simulado: true, tem_contato: false })
})

test('lotação definida em Unidades: lotado com alternativas; o grupo menor cabe e o número novo vai cifrado', async ({ page }) => {
  test.setTimeout(120_000) // conversa de várias mensagens, cada uma passando pelo worker
  await entrarComoGestor(page)
  await page.goto(`/unidades/${lotadaId}`)
  await page.getByLabel(/^Lotação máxima \(pessoas por dia\)/).fill('5')
  await page.getByRole('button', { name: 'Salvar unidade' }).click()
  await expect(page.getByText('Unidade salva')).toBeVisible()
  const [u] = await getSql()`select capacidade_pessoas from units where id = ${lotadaId}`
  expect(u!.capacidade_pessoas).toBe(5)

  await abrirSimuladorLimpo(page)
  await perguntar(page, `quero reservar amanhã para 6 pessoas às 20h na ${LOTADA}`)
  const lotado = simulador(page).getByText(/^A unidade .* está lotada/)
  await expect(lotado).toBeVisible({ timeout: 20_000 })
  await expect(lotado).toContainText(`A unidade ${LOTADA} está lotada amanhã para 6 pessoas.`)
  await expect(lotado).toContainText('Nesse dia, temos vaga para 6 pessoas em:') // outra unidade aberta e com vaga
  await expect(lotado).toContainText('Se preferir, me diga outro dia.')
  await expect(lotado).toContainText(`Na unidade ${LOTADA}, ainda temos vaga para até 5 pessoas.`)
  // nada gravado no lotado
  expect(await getSql()`select id from attendance_notices where unit_id = ${lotadaId}`).toEqual([])

  // a reserva fica pendente: "5" segue sem repetir unidade, dia e horário
  await perguntar(page, '5')
  await expect(simulador(page).getByText('Em nome de quem fica a reserva?')).toBeVisible({ timeout: 20_000 })
  await perguntar(page, 'Carlos Lima')
  await expect(simulador(page).getByText('Posso usar este número do WhatsApp para falar com você sobre a reserva?')).toBeVisible({ timeout: 20_000 })
  await perguntar(page, 'não')
  await expect(simulador(page).getByText(/^Qual número devo usar/)).toBeVisible({ timeout: 20_000 })
  await perguntar(page, '(61) 98765-4321')
  const feita = simulador(page).getByText(/^Reserva feita:/)
  await expect(feita).toBeVisible({ timeout: 20_000 })
  await expect(feita).toContainText('5 pessoas')
  await expect(feita).toContainText('em nome de Carlos Lima')
  await expect(feita).toContainText(REGRAS)

  const a = await reservaDoSimulador(lotadaId)
  expect(a).toMatchObject({ pessoas: 5, nome: 'Carlos Lima', status: 'confirmada', simulado: true, tem_contato: true })
  // o número só existe cifrado na reserva: a mensagem do cliente fica guardada mascarada e nunca foi à IA
  const textos = await getSql()`select m.texto from messages m join conversations c on c.id = m.conversation_id
    where c.customer_id = ${a.customer_id as string} and m.texto is not null`
  expect(textos.some((t) => String(t.texto).includes('98765'))).toBe(false)
  expect(textos.some((t) => String(t.texto).includes('[TELEFONE]'))).toBe(true)
  expect(falso!.entradas.some((e) => e.includes('98765'))).toBe(false)
})

test('equipe marca "Não veio" e a vaga volta na lotação do dia', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`update units set capacidade_pessoas = 40 where id = ${unitId}`
  await getSql()`insert into attendance_notices (restaurant_id, unit_id, nome, data, pessoas, horario, origem)
    values (${r!.id}, ${unitId}, ${NOME_NAO_VEIO}, (now() at time zone 'America/Sao_Paulo')::date, 3, '12:00', 'painel')`
  await entrarComoGestor(page)
  await previsaoDaUnidade(page)
  const lotacao = page.getByRole('list', { name: 'Lotação do dia' })
  await expect(lotacao).toContainText('3/40')
  const linha = page.getByRole('list', { name: 'Linha do tempo do dia' }).getByRole('listitem').filter({ hasText: NOME_NAO_VEIO })
  await expect(linha).toContainText('3 pessoas')
  await linha.getByRole('link').click()
  const detalhe = page.getByRole('dialog', { name: 'Reserva' })
  await detalhe.getByRole('button', { name: 'Não veio' }).click()
  await expect(page.getByText('Reserva marcada como “Não veio”.')).toBeVisible()
  await expect(lotacao).toContainText('0/40')
  const [a] = await getSql()`select status from attendance_notices where nome = ${NOME_NAO_VEIO}`
  expect(a!.status).toBe('nao_veio')
  await getSql()`update units set capacidade_pessoas = null where id = ${unitId}`
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
