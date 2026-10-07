import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import { closeSql, criarMembro, entrar, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Gastos ${SUFIXO}`
const CLIENTE_TITULAR = `Titular ${SUFIXO}`
const NOME_CONVIDADO = `Convidada ${SUFIXO}`
const EMAIL_CONVIDADO = `convidada-${SUFIXO}@teste.local`
/** Mailpit do Supabase local (porta 54324): onde o Auth entrega o e-mail do convite. */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324'

// toda pergunta cai fora do escopo: a triagem é a chamada paga (reserva e liquida), e é só ela que interessa aqui
const triagem = (): TriagemFalsa => ({ itens: [], fora_escopo: true })

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let restaurantId = ''
let unitId = ''
let inicio = new Date()
let cotacaoOriginal = '5.5'
let limitesOriginais: { escopo: string; periodo: string; limite_usd: string; alerta_pct: number }[] = []
const pedidos: string[] = []

test.beforeAll(async () => {
  const sql = getSql()
  inicio = new Date()
  const [r] = await sql`select id, cotacao_usd_brl from restaurants limit 1`
  restaurantId = r!.id as string
  cotacaoOriginal = String(r!.cotacao_usd_brl)
  for (const periodo of ['dia', 'mes']) {
    for (const escopo of ['ia', 'simulacao']) {
      await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
        values (${restaurantId}, ${escopo}, ${periodo}, 5) on conflict do nothing`
    }
  }
  // o teste baixa o limite da simulação pelo painel: guarda o que havia para devolver no afterAll (outras specs simulam)
  limitesOriginais = await sql`select escopo::text, periodo::text, limite_usd::text, alerta_pct from budget_limits
    where restaurant_id = ${restaurantId} and escopo = 'simulacao'`
  // começa com folga: a primeira pergunta simulada precisa caber para haver gasto antes de o dono baixar o limite
  await sql`update budget_limits set limite_usd = 5 where restaurant_id = ${restaurantId} and escopo = 'simulacao'`
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE}, ${'e2e-gastos-' + SUFIXO}, 'Rua dos Gastos, 1') returning id`
  unitId = u!.id as string
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  if (restaurantId) {
    for (const l of limitesOriginais) {
      await sql`update budget_limits set limite_usd = ${l.limite_usd}, alerta_pct = ${l.alerta_pct}
        where restaurant_id = ${restaurantId} and escopo = ${l.escopo} and periodo = ${l.periodo}`
    }
    await sql`update restaurants set cotacao_usd_brl = ${cotacaoOriginal} where id = ${restaurantId}`
    // a faixa de alerta ficaria no painel das próximas specs até o fim do dia
    await sql`delete from budget_alerts where restaurant_id = ${restaurantId} and escopo = 'simulacao' and created_at >= ${inicio}`
  }
  if (pedidos.length > 0) await sql`delete from data_subject_requests where id = any(${pedidos}::uuid[])`
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.wa_id_hash like ${'e2e-gastos:%'})`
  await sql`delete from customers where wa_id_hash like ${'e2e-gastos:%'}`
  await sql`delete from staff_invites where email like '%@teste.local'`
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

/** Cliente "real" (não simulado) criado direto no banco, com uma conversa e uma mensagem do cliente. */
async function clienteReal(nome: string, texto: string, estado: 'ia' | 'aguardando_humano' = 'ia') {
  const sql = getSql()
  // telefone inválido de propósito: a entrega pela Meta para antes de qualquer chamada (o e2e nunca fala com a Meta)
  const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${restaurantId}, ${'e2e-gastos:' + randomBytes(8).toString('hex')}, 'x', ${nome}) returning id`
  const [conv] = await sql`insert into conversations (restaurant_id, customer_id, estado, unidade_contexto_id, handoff_motivo)
    values (${restaurantId}, ${c!.id}, ${estado}, ${unitId}, ${estado === 'ia' ? null : 'pedido'}) returning id`
  await sql`insert into messages (restaurant_id, conversation_id, direcao, autor, tipo, texto, wamid)
    values (${restaurantId}, ${conv!.id}, 'in', 'cliente', 'texto', ${texto}, ${'wamid.e2e-' + randomBytes(8).toString('hex')})`
  return { customerId: c!.id as string, conversationId: conv!.id as string }
}

/** Enfileira a conversa como o webhook faria (pg-boss no papel do web: só envia). */
async function enfileirarConversa(conversationId: string) {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    schema: 'pgboss', max: 1, migrate: false, supervise: false, schedule: false, useListenNotify: false, registerInstance: false,
  })
  boss.on('error', () => {})
  await boss.start()
  try {
    await boss.send('conversation.process', { conversationId }, { singletonKey: conversationId })
  } finally {
    await boss.stop({ graceful: false })
  }
}

test('dono ajusta cotação e limite; a simulação estoura só o próprio limite, o alerta aparece e a conversa real segue', async ({ page }) => {
  test.setTimeout(120_000) // três rodadas do worker (duas simuladas e uma real)
  await page.setViewportSize({ width: 360, height: 740 })
  const { email } = await entrarComoGestor(page)
  // contador `ia` de hoje (gasto + reservado): as simulações nunca mexem nele
  const usoIaHoje = async () => String((await getSql()`select coalesce(sum(gasto + reservado), 0)::text as v from budget_counters
    where restaurant_id = ${restaurantId} and escopo = 'ia' and periodo = 'dia'
      and inicio_periodo = (now() at time zone (select timezone from restaurants where id = ${restaurantId}))::date`)[0]!.v)
  const iaAntes = await usoIaHoje()

  // 1) uma pergunta simulada com folga: gera gasto de simulação hoje
  await abrirSimuladorLimpo(page)
  await perguntar(page, 'qual o preço do pão de queijo da padaria vizinha?')
  const primeira = await conversaSimuladaDe(email)
  await expect
    .poll(async () => Number((await getSql()`select count(*)::int as n from ai_runs where conversation_id = ${primeira!.id}`)[0]!.n),
      { timeout: 20_000 })
    .toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(simulador(page)).toBeHidden()

  // 2) dono muda a cotação e baixa o limite do dia da simulação para abaixo do que já gastou
  await page.getByRole('link', { name: 'Mais', exact: true }).click()
  await page.getByRole('link', { name: 'Gastos e limites' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Gastos e limites' })).toBeVisible()
  await semRolagemHorizontal(page)
  await page.getByLabel(/^Cotação do dólar/).fill('5,25')
  await page.getByRole('button', { name: 'Salvar cotação' }).click()
  await expect(page.getByText('Cotação salva')).toBeVisible()
  const simulacao = page.getByRole('group', { name: 'Simulação' })
  await simulacao.getByLabel(/^Limite do dia/).fill('0,000001')
  await simulacao.getByRole('button', { name: 'Salvar limite do dia' }).click()
  await expect(page.getByText('Limite do dia salvo')).toBeVisible()
  const [lim] = await getSql()`select limite_usd::text as v from budget_limits
    where restaurant_id = ${restaurantId} and escopo = 'simulacao' and periodo = 'dia'`
  expect(Number(lim!.v)).toBe(0.000001)
  expect(Number((await getSql()`select cotacao_usd_brl::text as v from restaurants where id = ${restaurantId}`)[0]!.v)).toBe(5.25)

  // o Início mostra os gastos em reais com a cotação nova
  await page.getByRole('link', { name: 'Início', exact: true }).click()
  await expect(page.getByText('Cotação usada: US$ 1 = R$ 5,25')).toBeVisible()
  await semRolagemHorizontal(page)

  // 3) a próxima pergunta simulada é recusada pelo limite da simulação: aviso no simulador
  await abrirSimuladorLimpo(page)
  await perguntar(page, 'e o horário da padaria vizinha?')
  const s = simulador(page)
  await expect(s.getByText(/^Limite de simulação atingido hoje/)).toBeVisible({ timeout: 20_000 })
  await expect(s.getByRole('link', { name: 'Gastos e limites' })).toBeVisible()
  const segunda = await conversaSimuladaDe(email)
  expect(segunda!.id).not.toBe(primeira!.id)
  expect(Number((await getSql()`select count(*)::int as n from ai_runs where conversation_id = ${segunda!.id}`)[0]!.n)).toBe(0)
  // as duas rodadas simuladas (uma paga, uma recusada) não tocaram no contador dos clientes reais
  expect(await usoIaHoje()).toBe(iaAntes)

  // 4) a conversa real, no mesmo minuto, é atendida pela IA (escopo ia, fora do limite da simulação)
  const real = await clienteReal(`Cliente Real ${SUFIXO}`, 'qual o preço do pão de queijo da padaria vizinha?')
  await enfileirarConversa(real.conversationId)
  await expect
    .poll(async () => Number((await getSql()`select count(*)::int as n from ai_runs
      where conversation_id = ${real.conversationId} and not simulado`)[0]!.n), { timeout: 20_000 })
    .toBeGreaterThan(0)
  const [cReal] = await getSql()`select estado from conversations where id = ${real.conversationId}`
  expect(cReal!.estado).toBe('ia')
  const respostas = await getSql()`select autor from messages where conversation_id = ${real.conversationId} and direcao = 'out'`
  expect(respostas.map((m) => m.autor)).toContain('ia')
  const ledger = await getSql()`select distinct escopo::text from spend_ledger
    where restaurant_id = ${restaurantId} and created_at >= ${inicio} and escopo <> 'whatsapp'`
  expect(ledger.map((l) => l.escopo).sort()).toEqual(['ia', 'simulacao'])
  // telefone de teste não decifra: tira as respostas da fila de entrega para o worker não repetir o erro
  await getSql()`update messages set status_envio = 'falhou:e2e' where conversation_id = ${real.conversationId} and status_envio = 'pendente'`

  // 5) o alerta de 100% da simulação aparece no topo do painel
  await page.keyboard.press('Escape')
  await page.reload()
  const faixa = page.getByRole('region', { name: 'Alerta de gastos' })
  await expect(faixa).toContainText(/Simulação: \d+% do limite do dia/)
  await expect(faixa).toContainText('modo econômico')
  await expect(faixa.getByRole('link', { name: 'Ajustar limites' })).toHaveAttribute('href', '/mais/gastos')
  await semRolagemHorizontal(page)
})

test('pedido do titular: resumo de acesso e exclusão confirmada apagam os dados do cliente', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const sql = getSql()
  // cliente em atendimento humano, com aviso de presença: o pior caso para excluir
  const titular = await clienteReal(CLIENTE_TITULAR, 'quero meus dados', 'aguardando_humano')
  await sql`insert into attendance_notices (restaurant_id, unit_id, customer_id, nome, data, pessoas, origem)
    values (${restaurantId}, ${unitId}, ${titular.customerId}, ${CLIENTE_TITULAR}, current_date + 1, 4, 'ia')`
  // pedidos vencidos (prazos distintos) para aparecerem no alerta do Início e serem achados na fila
  const [acesso] = await sql`insert into data_subject_requests (restaurant_id, customer_id, tipo, created_at, prazo)
    values (${restaurantId}, ${titular.customerId}, 'acesso', now() - interval '20 days', now() - interval '5 days 1 hour') returning id`
  const [exclusao] = await sql`insert into data_subject_requests (restaurant_id, customer_id, tipo, created_at, prazo)
    values (${restaurantId}, ${titular.customerId}, 'exclusao', now() - interval '21 days', now() - interval '6 days 1 hour') returning id`
  pedidos.push(acesso!.id as string, exclusao!.id as string)

  await entrarComoGestor(page)
  const cartao = page.getByRole('region', { name: 'Pedidos de privacidade (LGPD)' })
  await expect(cartao).toContainText('pedidos vencidos')
  await cartao.getByRole('link', { name: 'Ver pedidos' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Privacidade (LGPD)' })).toBeVisible()
  await semRolagemHorizontal(page)

  // acesso: o resumo traz o nome e a mensagem do cliente; marcar como concluído tira o pedido da fila
  const itemAcesso = page.getByRole('listitem').filter({ hasText: 'Acesso aos dados' }).filter({ hasText: 'Prazo vencido há 5 dias' })
  await itemAcesso.getByRole('button', { name: 'Gerar resumo' }).click()
  const folha = page.getByRole('dialog', { name: 'Resumo de acesso' })
  await expect(folha).toContainText(CLIENTE_TITULAR)
  await expect(folha).toContainText('Mensagens: 1')
  await semRolagemHorizontal(page)
  await folha.getByRole('button', { name: 'Marcar como concluído' }).click()
  await expect(page.getByText('Pedido concluído.')).toBeVisible()
  await expect(itemAcesso).toHaveCount(0)

  // exclusão: só com a palavra de confirmação
  const itemExclusao = page.getByRole('listitem').filter({ hasText: 'Exclusão dos dados' }).filter({ hasText: 'Prazo vencido há 6 dias' })
  await itemExclusao.getByRole('button', { name: 'Excluir dados' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Excluir os dados deste cliente?' })
  const confirmar = dialogo.getByRole('button', { name: 'Excluir definitivamente' })
  await expect(confirmar).toBeDisabled()
  await dialogo.getByLabel(/^Para confirmar, digite EXCLUIR/).fill('excluir')
  await confirmar.click()
  await expect(page.getByText(/^Dados excluídos: 1 mensagem, 1 conversa, 1 aviso/)).toBeVisible()
  await expect(itemExclusao).toHaveCount(0)

  // os dados somem: cadastro e conversa apagados; aviso anonimizado na agenda; pedidos concluídos
  expect(await sql`select 1 from customers where id = ${titular.customerId}`).toHaveLength(0)
  expect(await sql`select 1 from conversations where id = ${titular.conversationId}`).toHaveLength(0)
  const avisos = await sql`select nome, anonimizado, customer_id from attendance_notices where unit_id = ${unitId}`
  expect(avisos).toEqual([{ nome: null, anonimizado: true, customer_id: null }])
  const status = await sql`select tipo::text, status::text from data_subject_requests where id = any(${pedidos}::uuid[]) order by tipo`
  expect(status).toEqual([{ tipo: 'acesso', status: 'concluido' }, { tipo: 'exclusao', status: 'concluido' }])
  // auditoria da exclusão sem dado pessoal
  const [auditoria] = await sql`select diff::text as diff from audit_log
    where restaurant_id = ${restaurantId} and acao = 'lgpd.exclusao_executada' and created_at >= ${inicio} order by created_at desc limit 1`
  expect(auditoria!.diff).not.toContain(CLIENTE_TITULAR)
  expect(auditoria!.diff).not.toContain('quero meus dados')

  // a caixa de conversas continua abrindo
  await page.goto('/conversas?aba=aguardando')
  await expect(page.getByRole('heading', { level: 1, name: 'Conversas' })).toBeVisible()
  await expect(page.getByText(CLIENTE_TITULAR)).toHaveCount(0)
})

test('retenção (chamada direto, como o agendamento das 03:00) apaga a simulação antiga e poupa a recente', async () => {
  // Atenção: roda a retenção de verdade no restaurante inteiro do banco local, com o `now()` real. Ela também apaga o que
  // já venceu de outras suítes e do uso local do desenvolvedor (ex.: simulações com mais de 7 dias). Aceitável no e2e:
  // é o mesmo efeito do agendamento diário do worker.
  const sql = getSql()
  const criar = async (diasAtras: number) => {
    const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil, simulado, ultima_interacao_at, created_at)
      values (${restaurantId}, ${'e2e-gastos:' + randomBytes(8).toString('hex')}, 'simulado', 'Simulação', true,
        now() - make_interval(days => ${diasAtras}), now() - make_interval(days => ${diasAtras})) returning id`
    const [conv] = await sql`insert into conversations (restaurant_id, customer_id, simulada, last_message_at, created_at)
      values (${restaurantId}, ${c!.id}, true, now() - make_interval(days => ${diasAtras}), now() - make_interval(days => ${diasAtras})) returning id`
    await sql`insert into messages (restaurant_id, conversation_id, direcao, autor, tipo, texto, status_envio, created_at)
      values (${restaurantId}, ${conv!.id}, 'in', 'cliente', 'texto', 'oi', null, now() - make_interval(days => ${diasAtras}))`
    return c!.id as string
  }
  const antiga = await criar(10)
  const recente = await criar(1)

  const [r1] = await sql`select app.aplicar_retencao(${restaurantId}::uuid, now(), 5000) as r`
  expect((r1!.r as { pendente: boolean }).pendente).toBe(false)
  expect(await sql`select 1 from customers where id = ${antiga}`).toHaveLength(0)
  expect(await sql`select 1 from customers where id = ${recente}`).toHaveLength(1)

  // segunda execução no mesmo dia: nada a mais some
  await sql`select app.aplicar_retencao(${restaurantId}::uuid, now(), 5000)`
  expect(await sql`select 1 from customers where id = ${recente}`).toHaveLength(1)
})

test('dono convida uma atendente pelo painel; o worker envia o convite e cria o membro', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Mais', exact: true }).click()
  await page.getByRole('link', { name: 'Equipe', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible()
  await semRolagemHorizontal(page)

  await page.getByRole('button', { name: 'Convidar' }).click()
  const folha = page.getByRole('dialog', { name: 'Convidar para a equipe' })
  await folha.getByLabel(/^Nome/).fill(NOME_CONVIDADO)
  await folha.getByLabel(/^E-mail/).fill(EMAIL_CONVIDADO)
  await folha.getByLabel(/^Papel/).selectOption('atendente')
  await folha.getByRole('button', { name: 'Enviar convite' }).click()
  await expect(page.getByText('Convite enviado')).toBeVisible()

  // o worker chama o convite do Supabase Auth (chave de serviço só nele) e cria o staff
  await expect
    .poll(async () => (await getSql()`select status::text, erro from staff_invites where email = ${EMAIL_CONVIDADO}`)[0], { timeout: 20_000 })
    .toEqual({ status: 'enviado', erro: null })
  const membro = await getSql()`select s.papel::text, s.ativo, s.unidades_permitidas from staff s
    join auth.users u on u.id = s.user_id where u.email = ${EMAIL_CONVIDADO}`
  expect(membro).toEqual([{ papel: 'atendente', ativo: true, unidades_permitidas: [] }])

  // o e-mail do convite chegou (Mailpit do Supabase local)
  await expect
    .poll(async () => {
      const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${EMAIL_CONVIDADO}"`)}`)
      return r.ok ? ((await r.json()) as { messages_count: number }).messages_count : 0
    }, { timeout: 15_000 })
    .toBeGreaterThan(0)

  await page.reload()
  await expect(page.getByRole('listitem', { name: NOME_CONVIDADO })).toContainText('Convite enviado, aguardando o primeiro acesso')
  await expect(page.getByRole('button', { name: `Reenviar convite para ${NOME_CONVIDADO}` })).toBeVisible()
  await semRolagemHorizontal(page)

  // convite repetido para o mesmo e-mail: erro amigável no campo
  await page.getByRole('button', { name: 'Convidar' }).click()
  await folha.getByLabel(/^Nome/).fill(NOME_CONVIDADO)
  await folha.getByLabel(/^E-mail/).fill(EMAIL_CONVIDADO)
  await folha.getByRole('button', { name: 'Enviar convite' }).click()
  await expect(folha.getByLabel(/^E-mail/)).toHaveAttribute('aria-invalid', 'true')
  expect(await getSql()`select 1 from staff_invites where email = ${EMAIL_CONVIDADO}`).toHaveLength(1)
})

test('gerente vê equipe e limites só para leitura; atendente não vê as telas de gestão', async ({ page, browser }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await entrarComoGestor(page, 'gerente')
  await page.getByRole('link', { name: 'Mais', exact: true }).click()
  await page.getByRole('link', { name: 'Equipe', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Convidar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Desativar/ })).toHaveCount(0)
  await semRolagemHorizontal(page)
  await page.goto('/mais/gastos')
  await expect(page.getByText('Só o dono altera os limites e a cotação.')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Salvar/ })).toHaveCount(0)
  await semRolagemHorizontal(page)

  const contexto = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'pt-BR', baseURL: `http://localhost:${process.env.E2E_PORT ?? 3000}` })
  const atendente = await contexto.newPage()
  const { email, senha } = await criarMembro('atendente')
  await entrar(atendente, email, senha)
  await expect(atendente.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await atendente.getByRole('link', { name: 'Mais', exact: true }).click()
  await expect(atendente.getByRole('link', { name: 'Unidades', exact: true })).toBeVisible()
  for (const nome of ['Gastos e limites', 'Privacidade (LGPD)', 'Equipe']) {
    await expect(atendente.getByRole('link', { name: nome, exact: true })).toHaveCount(0)
  }
  await atendente.goto('/mais/equipe')
  await expect(atendente.getByRole('heading', { level: 1, name: 'Equipe' })).toHaveCount(0)
  await contexto.close()
})
