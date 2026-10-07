import { expect, test, type Locator, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, criarMembro, entrar, entrarComoGestor, getAdmin, getSql } from '../helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from '../openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from '../worker'

// Projeto desktop (1440×900): menu lateral, lista + detalhe, Agenda com o pedido ao lado, simulador flutuante e Ctrl+K.

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Desk ${SUFIXO}`
const CATEGORIA_CSV = `Sobremesas Desk ${SUFIXO}`
const PEDIDO_ATENDENTE = 'quero falar com um atendente'
const RESPOSTA = `Oi! Já vou te ajudar (${SUFIXO}).`

type Item = TriagemFalsa['itens'][number]
const vazio = { unidade: UNIDADE, data: null, tema: null, pessoas: null, horario: null }

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  // sem hora fixa: um horário de hoje pode já ter passado quando o teste roda (e o aviso seria recusado)
  if (m.startsWith('hoje vou')) {
    return { itens: [{ ...vazio, servico: 'aviso_presenca', tipo: 'registrar', data: 'hoje', pessoas: 6, horario: 'à noite' } as Item], fora_escopo: false }
  }
  // sem unidade e com mais de 3 unidades: a resposta vem com a lista interativa "Ver unidades"
  if (m.startsWith('está aberto')) {
    return { itens: [{ ...vazio, unidade: null, servico: 'horario_unidades', tipo: 'aberto_agora' } as Item], fora_escopo: false }
  }
  if (m.includes('aniversário para 30')) {
    return {
      itens: [{ ...vazio, servico: 'evento', tipo: 'pedido', data: 'amanhã', convidados: 30, tipoEvento: 'aniversário', espaco: null } as Item],
      fora_escopo: false,
    }
  }
  return { itens: [], fora_escopo: true }
}

const CSV = [
  'categoria;nome;descricao;preco;tags;outros_nomes;unidade',
  `${CATEGORIA_CSV};Pudim ${SUFIXO};Fatia;14,50;sobremesa;;`,
  `${CATEGORIA_CSV};Mousse ${SUFIXO};;11,00;sobremesa;;`,
].join('\n')

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let restaurantId = ''
let unitId = ''
/** Alerta de gasto inserido para o arquivo todo (faixa de alertas na barra): removido no afterAll se foi este teste que criou. */
let alertaId: string | null = null

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id from restaurants limit 1`
  restaurantId = r!.id as string
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'ia', ${periodo}, 5) on conflict do nothing`
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'simulacao', ${periodo}, 5) on conflict do nothing`
  }
  // unidade aberta o dia todo, nos 7 dias: o teste não depende da hora em que roda
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE}, ${'e2e-desk-' + SUFIXO}, 'Rua do Desktop, 1') returning id`
  unitId = u!.id as string
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
      values (${restaurantId}, ${unitId}, ${weekday}, 1, '00:00', '23:59')`
  }
  // mais 3 unidades (nomes fora do padrão "Desk", para a busca rápida achar só a principal): pergunta sem unidade vira lista
  for (const n of [1, 2, 3]) {
    await sql`insert into units (restaurant_id, nome, slug, endereco)
      values (${restaurantId}, ${`E2E Lista ${SUFIXO} ${n}`}, ${`e2e-lista-${SUFIXO}-${n}`}, 'Rua da Lista, 1')`
  }
  // faixa de alertas ativa em todas as telas deste arquivo (é o caso da demonstração: o limite da simulação estoura
  // cedo): o layout tem de caber com ela. 80% do WhatsApp no mês: não muda orçamento nem modo econômico.
  const [a] = await sql`insert into budget_alerts (restaurant_id, escopo, periodo, inicio_periodo, nivel)
    select ${restaurantId}, 'whatsapp', 'mes', date_trunc('month', now() at time zone r.timezone)::date, 80
      from restaurants r where r.id = ${restaurantId}
    on conflict do nothing returning id`
  alertaId = (a?.id as string | undefined) ?? null
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  if (alertaId) await sql`delete from budget_alerts where id = ${alertaId}`
  // as outras specs contam com o isolamento: o modo volta a ficar desligado
  if (restaurantId) await sql`update restaurants set modo_demonstracao = false where id = ${restaurantId}`
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  const caminhos = await sql<{ storage_path: string }[]>`
    select storage_path from knowledge_documents
     where storage_path is not null and enviado_por in (select id from auth.users where email like '%@teste.local')
    union all
    select f.storage_path from knowledge_document_files f join knowledge_documents k on k.id = f.importacao_id
     where k.enviado_por in (select id from auth.users where email like '%@teste.local')`
  for (const { storage_path } of caminhos) {
    const [bucket, ...resto] = storage_path.split('/')
    await getAdmin().storage.from(bucket!).remove([resto.join('/')])
  }
  await sql`delete from knowledge_documents where enviado_por in (select id from auth.users where email like '%@teste.local')`
  await sql`delete from menu_categories where nome like ${'%' + SUFIXO + '%'}`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu principal' })
const simulador = (page: Page) => page.getByRole('dialog', { name: 'Simulador de WhatsApp' })
const minimizado = (page: Page) => page.getByRole('group', { name: 'Simulador minimizado' })

/** Abre o simulador pelo item do menu lateral e começa um cliente novo. */
async function abrirSimuladorPeloMenu(page: Page) {
  await menu(page).getByRole('button', { name: 'Simulador', exact: true }).click()
  await expect(simulador(page)).toBeVisible()
  await expect(simulador(page)).toHaveAttribute('aria-modal', 'false')
  // espera a ação "Novo cliente" voltar (mesmo cuidado do s1.spec). < xl os controles ficam atrás de um botão.
  const controles = simulador(page).getByRole('button', { name: 'Controles da simulação' })
  if (await controles.isVisible()) await controles.click()
  const pedido = page.waitForRequest((r) => r.method() === 'POST' && r.headers()['next-action'] !== undefined && r.postData() === '[]')
  await simulador(page).getByRole('button', { name: 'Novo cliente' }).click()
  await (await pedido).response()
  if (await controles.isVisible() && (await controles.getAttribute('aria-expanded')) === 'true') await controles.click()
}

async function perguntar(page: Page, texto: string) {
  await simulador(page).getByRole('textbox', { name: 'Mensagem' }).fill(texto)
  await simulador(page).getByRole('textbox', { name: 'Mensagem' }).press('Enter')
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

/** A caixa de `a` fica inteira à esquerda de `b` (lado a lado). */
async function ladoALado(a: Locator, b: Locator) {
  const [ca, cb] = [await a.boundingBox(), await b.boundingBox()]
  expect(ca && cb).toBeTruthy()
  expect(ca!.x + ca!.width).toBeLessThanOrEqual(cb!.x + 1)
}

/** Clique de verdade possível: visível, habilitado e nada por cima (`trial` faz as checagens sem clicar). */
async function clicavel(alvo: Locator) {
  await alvo.click({ trial: true, timeout: 5_000 })
}

const faixa = (page: Page) => page.getByRole('region', { name: 'Alerta de gastos' }).locator('visible=true')

/** Com a faixa de alertas na tela: a página não rola (só as colunas) e o Enviar está inteiro na janela. */
async function compositorNaTela(page: Page, enviar: Locator) {
  await expect(faixa(page)).toBeVisible()
  await expect(enviar).toBeInViewport({ ratio: 1 })
  const { altura, visivel } = await page.evaluate(() => ({
    altura: document.documentElement.scrollHeight,
    visivel: document.documentElement.clientHeight,
  }))
  expect(altura).toBeLessThanOrEqual(visivel)
}

test('menu lateral: navega pelas seções, marca a atual, recolhe e volta recolhido do cookie sem piscar', async ({ page, context }) => {
  await entrarComoGestor(page)
  await expect(menu(page)).toBeVisible()
  // ≥ lg a barra inferior do celular some
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden()

  const destinos = [
    [/^Conversas(, \d+ aguardando)?$/, 'Conversas'],
    ['Agenda', 'Agenda'],
    ['Conteúdo', 'Conteúdo'],
    ['Unidades', 'Unidades'],
    ['Gastos', 'Gastos e limites'],
    ['Ajustes', 'Ajustes'],
    ['Início', 'Início'],
  ] as const
  for (const [link, titulo] of destinos) {
    const alvo = menu(page).getByRole('link', typeof link === 'string' ? { name: link, exact: true } : { name: link })
    await alvo.click()
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
    await expect(alvo).toHaveAttribute('aria-current', 'page')
  }
  await semRolagemHorizontal(page)

  await menu(page).getByRole('button', { name: 'Recolher menu' }).click()
  await expect(menu(page)).toHaveAttribute('data-estado', 'recolhido')
  expect((await menu(page).boundingBox())!.width).toBeLessThanOrEqual(57)
  expect((await context.cookies()).find((c) => c.name === 'atd_menu')?.value).toBe('recolhido')
  // o estado vem do cookie lido no servidor: o HTML da primeira resposta já chega recolhido
  const resp = await page.reload()
  expect(await resp!.text()).toContain('data-estado="recolhido"')
  await expect(menu(page)).toHaveAttribute('data-estado', 'recolhido')
  // recolhido, os itens continuam com nome (só o ícone aparece) e navegam
  await menu(page).getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

  await menu(page).getByRole('button', { name: 'Abrir menu' }).click()
  await expect(menu(page)).toHaveAttribute('data-estado', 'aberto')
  expect((await context.cookies()).find((c) => c.name === 'atd_menu')?.value).toBe('aberto')
})

test('menu lateral do atendente: sem Gestão e sem Simulador', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(menu(page).getByRole('link', { name: 'Ajustes', exact: true })).toBeVisible()
  for (const nome of ['Gastos', 'Equipe', 'Privacidade']) {
    await expect(menu(page).getByRole('link', { name: nome, exact: true })).toHaveCount(0)
  }
  await expect(menu(page).getByRole('button', { name: 'Simulador', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveCount(0)
})

test('Início: seis indicadores numa linha e as três colunas lado a lado; sem rolagem horizontal em 1440 e 1024 px', async ({ page }) => {
  await entrarComoGestor(page)
  const indicadores = page.getByRole('group', { name: /^(Aguardando|Previstos hoje|Eventos novos|Conversas hoje|Respondido pela IA|Gasto IA hoje): / })
  await expect(indicadores).toHaveCount(6)
  const topos = new Set<number>()
  for (const i of await indicadores.all()) topos.add(Math.round((await i.boundingBox())!.y))
  expect(topos.size).toBe(1)

  const aguardando = page.getByRole('region', { name: 'Aguardando atendimento' })
  const agenda = page.getByRole('region', { name: 'Agenda de hoje' })
  const alertas = page.getByRole('region', { name: 'Alertas', exact: true })
  await expect(aguardando).toBeVisible()
  await ladoALado(aguardando, agenda)
  await ladoALado(agenda, alertas)
  await semRolagemHorizontal(page)

  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(aguardando).toBeVisible()
  await semRolagemHorizontal(page)
})

test('Conversas lado a lado: a conversa chega na lista ao vivo, abre ao lado, assumir e responder', async ({ page }) => {
  const { email } = await entrarComoGestor(page)
  await page.goto('/conversas?aba=aguardando&sim=1')
  await expect(page.getByRole('region', { name: 'Conversa aberta' })).toContainText('Escolha uma conversa')
  await ladoALado(page.getByRole('region', { name: 'Lista de conversas' }), page.getByRole('region', { name: 'Conversa aberta' }))

  // o simulador flutuante não é modal: a lista continua na tela enquanto o cliente pede atendente
  await abrirSimuladorPeloMenu(page)
  await perguntar(page, PEDIDO_ATENDENTE)
  await expect(simulador(page).getByText(/^Vou passar você para alguém da nossa equipe/)).toBeVisible({ timeout: 20_000 })
  const conversa = await conversaSimuladaDe(email)
  expect(conversa?.estado).toBe('aguardando_humano')

  // tempo real: chega pelo Realtime, sem recarregar
  const lista = page.getByRole('region', { name: 'Lista de conversas' })
  const item = lista.locator(`a[href^="/conversas/${conversa!.id}"]`)
  await expect(item).toBeVisible({ timeout: 15_000 })
  await expect(item).toContainText('Simulação')

  // ≥ xl o painel aberto cobre parte do compositor (ruling): minimiza para responder
  await simulador(page).getByRole('button', { name: 'Minimizar simulador' }).click()
  await expect(minimizado(page)).toBeVisible()
  await item.click()
  await expect(page).toHaveURL(new RegExp(`/conversas/${conversa!.id}`))
  const detalhe = page.getByRole('region', { name: /^Conversa com / })
  await expect(detalhe).toBeVisible()
  await expect(lista).toBeVisible()
  await ladoALado(lista, detalhe)

  await detalhe.getByRole('button', { name: 'Assumir' }).click()
  await expect(page.getByText('Conversa assumida. Agora é com você.')).toBeVisible()
  await detalhe.getByRole('textbox', { name: 'Resposta' }).fill(RESPOSTA)
  const enviar = detalhe.getByRole('region', { name: 'Responder' }).getByRole('button', { name: 'Enviar', exact: true })
  // 1440×900 com a faixa de alertas: o compositor continua na tela, sem rolagem dupla
  await compositorNaTela(page, enviar)
  await enviar.click()
  await expect(page.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible()
  await expect
    .poll(async () => (await getSql()`select status_envio from messages
      where conversation_id = ${conversa!.id} and direcao = 'out' and autor = 'humano'`).map((m) => m.status_envio))
    .toEqual(['simulado'])

  // o histórico do simulador continua montado: restaurado, a resposta da equipe aparece nele
  await minimizado(page).getByRole('button', { name: 'Restaurar simulador' }).click()
  await expect(simulador(page).getByText(RESPOSTA)).toBeVisible({ timeout: 20_000 })

  // o painel aberto começa abaixo da faixa e do cabeçalho da conversa: "Fechar conversa" e "Ajustar limites" livres
  await clicavel(faixa(page).getByRole('link', { name: 'Ajustar limites' }))
  await clicavel(page.getByRole('link', { name: 'Fechar conversa' }))
  // fechar a conversa volta ao estado vazio, com a lista no lugar
  await page.getByRole('link', { name: 'Fechar conversa' }).click()
  await expect(page).toHaveURL(/\/conversas(\?|$)/)
  await expect(page.getByRole('region', { name: 'Conversa aberta' })).toContainText('Escolha uma conversa')
})

test('Ajustes e Agenda unificada: modo demonstração ligado, aviso e pedido do simulador no dia, pedido aberto ao lado', async ({ page }) => {
  await entrarComoGestor(page)
  await menu(page).getByRole('link', { name: 'Ajustes', exact: true }).click()
  const chave = page.getByRole('switch', { name: 'Modo demonstração' })
  await expect(chave).toHaveAttribute('aria-checked', 'false')
  await chave.click()
  await expect(page.getByText('Modo demonstração ligado')).toBeVisible()
  await expect(chave).toHaveAttribute('aria-checked', 'true')

  await abrirSimuladorPeloMenu(page)
  await perguntar(page, `Hoje vou na ${UNIDADE} com 6 pessoas à noite`)
  await expect(simulador(page).getByText(/^Anotado:/)).toBeVisible({ timeout: 20_000 })
  await perguntar(page, `quero fazer um aniversário para 30 pessoas na ${UNIDADE} dia amanhã`)
  await expect(simulador(page).getByText(/^Recebemos seu pedido/)).toBeVisible({ timeout: 20_000 })

  // o simulador acompanha a navegação pelo menu (montado no layout do painel)
  await menu(page).getByRole('link', { name: 'Agenda', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  await expect(simulador(page)).toBeVisible()
  await simulador(page).getByRole('button', { name: 'Fechar simulador' }).click()

  await page.goto(`/agenda?unidade=${unitId}`)
  const linha = page.getByRole('list', { name: 'Linha do tempo do dia' })
  await expect(linha.getByRole('listitem').filter({ hasText: '6 pessoas' })).toContainText('Simulação')
  const pendente = page.getByRole('region', { name: 'Pedidos para responder em outros dias' }).getByRole('link')
  await expect(pendente).toContainText('Simulação')
  await pendente.click()
  await expect(page).toHaveURL(/[?&]pedido=/)

  // ≥ lg o pedido abre ao lado da linha do tempo do dia dele, sem folha modal
  const detalhe = page.getByRole('complementary', { name: 'Pedido de evento' })
  await expect(detalhe).toContainText('Simulação')
  await expect(page.getByRole('dialog', { name: 'Pedido de evento' })).toHaveCount(0)
  const pedido = linha.getByRole('link', { name: /30 convidados/ })
  await expect(pedido).toContainText('Simulação')
  await ladoALado(linha, detalhe)
  await semRolagemHorizontal(page)

  await detalhe.getByRole('link', { name: 'Fechar o pedido' }).click()
  await expect(detalhe).toHaveCount(0)
  await expect(page).not.toHaveURL(/pedido=/)
})

test('Importar a partir do Cardápio (CSV): aba padrão de Conteúdo, revisão, confirmar e os itens aparecem', async ({ page }) => {
  await entrarComoGestor(page)
  await menu(page).getByRole('link', { name: 'Conteúdo', exact: true }).click()
  // aba padrão de Conteúdo = Cardápio
  await expect(page.getByRole('navigation', { name: 'Seções de conteúdo' }).getByRole('link', { name: 'Cardápio', exact: true }))
    .toHaveAttribute('aria-current', 'page')
  await page.getByRole('link', { name: 'Importar' }).click()
  await expect(page).toHaveURL(/aba=cardapio&importar=1/)
  await page.getByLabel(/^Planilha CSV/).setInputFiles({ name: 'cardapio.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await page.getByRole('button', { name: 'Ler planilha' }).click()

  const confirmar = page.getByRole('button', { name: 'Confirmar importação' })
  await expect(confirmar).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('group', { name: `Pudim ${SUFIXO}` })).toContainText('Novo')
  await semRolagemHorizontal(page)
  // nada gravado antes de confirmar (PRD I10)
  expect(await getSql()`select 1 from menu_categories where nome = ${CATEGORIA_CSV}`).toHaveLength(0)
  await confirmar.click()
  await expect(page.getByRole('status').filter({ hasText: 'Cardápio atualizado: 2 novos, 0 atualizados' })).toBeVisible()

  await page.goto('/conteudo?aba=cardapio&sub=itens')
  const secao = page.getByRole('region', { name: CATEGORIA_CSV })
  await expect(secao).toContainText(`Pudim ${SUFIXO}`)
  await expect(secao).toContainText('R$ 14,50')
  await expect(secao).toContainText(`Mousse ${SUFIXO}`)
})

test('simulador flutuante: não modal, minimiza, Shift+S restaura, Esc minimiza e Fechar volta ao botão', async ({ page }) => {
  await entrarComoGestor(page)
  await abrirSimuladorPeloMenu(page)
  // a tela atrás continua usável: o menu navega com o simulador aberto
  await menu(page).getByRole('link', { name: 'Conteúdo', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Conteúdo' })).toBeVisible()
  await expect(simulador(page)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveCount(0)

  // rascunho no campo sobrevive a minimizar/restaurar
  await simulador(page).getByRole('textbox', { name: 'Mensagem' }).fill('rascunho')
  await simulador(page).getByRole('button', { name: 'Minimizar simulador' }).click()
  await expect(simulador(page)).toBeHidden()
  await expect(minimizado(page).getByRole('button', { name: 'Restaurar simulador' })).toBeFocused()
  await page.keyboard.press('Shift+S')
  await expect(simulador(page)).toBeVisible()
  await expect(simulador(page).getByRole('textbox', { name: 'Mensagem' })).toBeFocused()
  await expect(simulador(page).getByRole('textbox', { name: 'Mensagem' })).toHaveValue('rascunho')

  // a lista interativa ("Ver unidades") abre dentro do celular, não no pé da janela
  await simulador(page).getByRole('textbox', { name: 'Mensagem' }).fill('')
  await perguntar(page, 'está aberto agora?')
  const verUnidades = simulador(page).getByRole('button', { name: 'Ver unidades' }).last()
  await expect(verUnidades).toBeVisible({ timeout: 20_000 })
  await verUnidades.click()
  const folhaLista = simulador(page).getByRole('dialog', { name: 'Ver unidades' })
  await expect(folhaLista).toBeVisible()
  const [caixaFolha, caixaCelular] = [await folhaLista.boundingBox(), await simulador(page).locator('[data-celular]').boundingBox()]
  expect(caixaFolha!.x).toBeGreaterThanOrEqual(caixaCelular!.x - 1)
  expect(caixaFolha!.x + caixaFolha!.width).toBeLessThanOrEqual(caixaCelular!.x + caixaCelular!.width + 1)
  expect(caixaFolha!.y).toBeGreaterThanOrEqual(caixaCelular!.y - 1)
  expect(caixaFolha!.y + caixaFolha!.height).toBeLessThanOrEqual(caixaCelular!.y + caixaCelular!.height + 1)
  await folhaLista.getByRole('button', { name: 'Cancelar' }).click()
  await expect(folhaLista).toHaveCount(0)

  // Esc com o foco no painel minimiza
  await simulador(page).getByRole('textbox', { name: 'Mensagem' }).focus()
  await page.keyboard.press('Escape')
  await expect(simulador(page)).toBeHidden()
  await expect(minimizado(page)).toBeVisible()

  await minimizado(page).getByRole('button', { name: 'Fechar simulador' }).click()
  await expect(minimizado(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toBeFocused()
  // fechado, Shift+S fora de campo de texto abre de novo
  await page.keyboard.press('Shift+S')
  await expect(simulador(page)).toBeVisible()
})

test('Ctrl+K: abre a busca rápida, leva a uma tela e a uma unidade', async ({ page }) => {
  await entrarComoGestor(page)
  await page.keyboard.press('Control+K')
  const paleta = page.getByRole('dialog', { name: 'Busca rápida' })
  await expect(paleta).toBeVisible()
  const campo = paleta.getByRole('combobox', { name: 'Buscar no painel' })
  await expect(campo).toBeFocused()
  await campo.fill('agen')
  await expect(paleta.getByRole('option', { name: /Agenda/ })).toHaveAttribute('aria-selected', 'true')
  await campo.press('Enter')
  await expect(paleta).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

  // o botão da barra superior abre a mesma paleta; a busca no servidor acha a unidade
  await page.getByRole('button', { name: /Busca rápida/ }).click()
  await expect(paleta).toBeVisible()
  await paleta.getByRole('combobox', { name: 'Buscar no painel' }).fill(`Desk ${SUFIXO}`)
  const unidade = paleta.getByRole('group', { name: 'Unidades' }).getByRole('option', { name: new RegExp(UNIDADE) })
  await expect(unidade).toBeVisible({ timeout: 10_000 })
  await unidade.click()
  await expect(page).toHaveURL(new RegExp(`/unidades/${unitId}`))
  // ≥ lg a barra é a da seção (Unidades) e o nome da unidade é o título da coluna do detalhe
  await expect(page.getByRole('region', { name: `Unidade ${UNIDADE}` }).getByRole('heading', { level: 2, name: UNIDADE })).toBeVisible()

  // Esc fecha
  await page.keyboard.press('Control+K')
  await expect(paleta).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(paleta).toHaveCount(0)
})

test.describe('1024×768 com o menu aberto', () => {
  test.use({ viewport: { width: 1024, height: 768 } })

  test('simulador aberto e minimizado não cobrem Sair nem Enviar; sem rolagem horizontal; em 1366×768 o painel fica abaixo da barra', async ({ page }) => {
    const { email } = await entrarComoGestor(page)
    await expect(menu(page)).toHaveAttribute('data-estado', 'aberto')
    await semRolagemHorizontal(page)
    // o Sair da barra superior (Ajustes tem outro, no corpo da página)
    const sair = page.getByRole('group', { name: 'Ações do painel' }).getByRole('button', { name: 'Sair' })

    await abrirSimuladorPeloMenu(page)
    await clicavel(sair)
    await perguntar(page, PEDIDO_ATENDENTE)
    await expect(simulador(page).getByText(/^Vou passar você para alguém da nossa equipe/)).toBeVisible({ timeout: 20_000 })
    const conversa = await conversaSimuladaDe(email)

    await page.goto(`/conversas/${conversa!.id}?aba=aguardando&sim=1`)
    await semRolagemHorizontal(page)
    const detalhe = page.getByRole('region', { name: /^Conversa com / })
    await ladoALado(page.getByRole('region', { name: 'Lista de conversas' }), detalhe)
    await detalhe.getByRole('button', { name: 'Assumir' }).click()
    await expect(page.getByText('Conversa assumida. Agora é com você.')).toBeVisible()
    const enviar = detalhe.getByRole('region', { name: 'Responder' }).getByRole('button', { name: 'Enviar', exact: true })
    await detalhe.getByRole('textbox', { name: 'Resposta' }).fill(RESPOSTA)
    // 1024×768 com a faixa de alertas: o compositor continua na tela, sem rolagem dupla
    await compositorNaTela(page, enviar)

    // aberto (< xl: compacto): Sair e Enviar continuam livres
    await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
    await expect(simulador(page)).toBeVisible()
    await clicavel(sair)
    await clicavel(enviar)
    // o clique fora minimiza o painel e o Enviar recebe o clique
    await enviar.click()
    await expect(page.getByRole('status').filter({ hasText: 'Enviado' })).toBeVisible()
    await expect(minimizado(page)).toBeVisible()

    // minimizado: a pílula fica na coluna do botão flutuante
    await detalhe.getByRole('textbox', { name: 'Resposta' }).fill('mais uma')
    await clicavel(sair)
    await clicavel(enviar)
    await semRolagemHorizontal(page)

    // outras telas em 1024 px com o menu aberto
    for (const caminho of ['/', '/agenda', '/conteudo', `/unidades/${unitId}`, '/gestao/gastos', '/ajustes']) {
      await page.goto(caminho)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await semRolagemHorizontal(page)
    }

    // 1366×768 (≥ xl, controles ao lado): o painel começa abaixo da barra superior
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
    await expect(simulador(page)).toBeVisible()
    const barra = page.locator('header').filter({ has: sair })
    const caixaBarra = (await barra.boundingBox())!
    const pilula = simulador(page).getByRole('button', { name: 'Minimizar simulador' })
    expect((await pilula.boundingBox())!.y).toBeGreaterThanOrEqual(caixaBarra.y + caixaBarra.height)
    // e abaixo da faixa de alertas
    const caixaFaixa = (await faixa(page).boundingBox())!
    expect((await pilula.boundingBox())!.y).toBeGreaterThanOrEqual(caixaFaixa.y + caixaFaixa.height)
    await clicavel(faixa(page).getByRole('link', { name: 'Ajustar limites' }))
    const celular = simulador(page).getByRole('textbox', { name: 'Mensagem' })
    expect((await celular.boundingBox())!.y + (await celular.boundingBox())!.height).toBeLessThanOrEqual(768)
    await clicavel(sair)
    await clicavel(page.getByRole('button', { name: /Busca rápida/ }))
  })
})
