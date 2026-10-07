import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, criarMembro, entrar, entrarComoGestor, getAdmin, getSql } from './helpers'
import { iniciarOpenRouterFalso, type LeituraCardapioFalsa, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
// unidade própria: com várias unidades e preço que varia entre elas, a IA pergunta a unidade antes de responder
const UNIDADE = `E2E Cardapio ${SUFIXO}`
const CATEGORIA = `Carnes E2E ${SUFIXO}`
const ITEM = `Picanha na brasa ${SUFIXO}`
const ARQUIVO = `Cardápio E2E ${SUFIXO}`
const CATEGORIA_CSV = `Bebidas E2E ${SUFIXO}`
const CATEGORIA_PDF = `Peixes E2E ${SUFIXO}`
const ITEM_PDF = `Moqueca baiana ${SUFIXO}`

const item = (tipo: string, extra: Partial<TriagemFalsa['itens'][number]> = {}): TriagemFalsa['itens'][number] =>
  ({ servico: 'cardapio', tipo, unidade: null, data: null, tema: null, pessoas: null, horario: null, ...extra })

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  if (m.includes('picanha')) return { itens: [item('buscar', { consulta: 'picanha', unidade: UNIDADE })], fora_escopo: false }
  if (m.includes('cardápio')) return { itens: [item('enviar')], fora_escopo: false }
  return { itens: [], fora_escopo: true }
}

/** O que a "IA" lê de qualquer PDF/foto importado neste e2e. */
const LEITURA: LeituraCardapioFalsa = {
  categorias: [{
    nome: CATEGORIA_PDF,
    itens: [
      { nome: ITEM_PDF, descricao: 'Peixe, leite de coco e dendê', precoCentavos: 11990, tags: [], unidade: null },
      { nome: `Peixe do dia ${SUFIXO}`, descricao: null, precoCentavos: null, tags: [], unidade: null },
    ],
  }],
}

/** PDF mínimo (o upload confere os magic bytes); o sufixo deixa o sha256 único a cada execução. */
// PDF mínimo com uma página: a leitura por lotes (Etapa 07) conta as páginas com pdf-lib e recusa PDF sem página
const pdf = (marca: string) =>
  Buffer.from(
    `%PDF-1.4\n% ${marca} ${SUFIXO}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  )

const CSV = [
  'categoria;nome;descricao;preco;tags;outros_nomes;unidade',
  `${CATEGORIA_CSV};Suco de caju ${SUFIXO};Natural, 500 ml;12,90;bebida;suco natural;`,
  `${CATEGORIA_CSV};Água com gás ${SUFIXO};;6,50;bebida;;`,
].join('\n')

/** A leitura da "IA" só responde depois que o teste viu "Lendo o cardápio…" (senão o worker pode terminar antes). */
let liberarLeitura: () => void = () => {}
const leituraLiberada = new Promise<void>((ok) => { liberarLeitura = ok })

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined

test.beforeAll(async () => {
  const [r] = await getSql()`select id from restaurants limit 1`
  // a triagem e a leitura reservam orçamento antes de chamar a IA
  for (const periodo of ['dia', 'mes']) {
    await getSql()`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'ia', ${periodo}, 5) on conflict do nothing`
    await getSql()`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'simulacao', ${periodo}, 5) on conflict do nothing`
  }
  await getSql()`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE}, ${'e2e-cardapio-' + SUFIXO}, 'Rua do Cardápio, 1')`
  falso = await iniciarOpenRouterFalso(triagem, { leituraCardapio: async () => { await leituraLiberada; return LEITURA } })
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  liberarLeitura()
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  // arquivos do Storage (cardápio enviado e importações) antes das linhas que guardam o caminho
  // o arquivo de envio vindo da importação (I3) é a cópia de um arquivo dela no bucket `cardapio`
  const daImportacao = sql`select replace(f.storage_path, 'importacoes/', 'cardapio/') from knowledge_document_files f
    join knowledge_documents k on k.id = f.importacao_id where k.enviado_por in (select id from auth.users where email like '%@teste.local')`
  const caminhos = await sql<{ storage_path: string }[]>`
    select storage_path from menu_files where titulo like ${'%' + SUFIXO + '%'} or storage_path in (${daImportacao})
    union all
    select storage_path from knowledge_documents
     where storage_path is not null and enviado_por in (select id from auth.users where email like '%@teste.local')
    union all
    select f.storage_path from knowledge_document_files f join knowledge_documents k on k.id = f.importacao_id
     where k.enviado_por in (select id from auth.users where email like '%@teste.local')`
  for (const { storage_path } of caminhos) {
    const [bucket, ...resto] = storage_path.split('/')
    await getAdmin().storage.from(bucket!).remove([resto.join('/')])
  }
  await sql`delete from menu_files where titulo like ${'%' + SUFIXO + '%'} or storage_path in (${daImportacao})`
  await sql`delete from knowledge_documents where enviado_por in (select id from auth.users where email like '%@teste.local')`
  // itens e exceções saem junto com a categoria (on delete cascade)
  await sql`delete from menu_categories where nome like ${'%' + SUFIXO + '%'}`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
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

/** Página sem rolagem horizontal (nada estoura a largura do celular). */
async function semRolagemHorizontal(page: Page) {
  const { largura, visivel } = await page.evaluate(() => ({
    largura: document.documentElement.scrollWidth,
    visivel: document.documentElement.clientWidth,
  }))
  expect(largura).toBeLessThanOrEqual(visivel)
}

test('dono cadastra categoria e item com preço; o simulador responde o preço do banco', async ({ page }) => {
  await entrarComoGestor(page)
  await page.goto('/conteudo?aba=cardapio&sub=itens')
  await expect(page.getByRole('heading', { level: 1, name: 'Conteúdo' })).toBeVisible()

  await page.getByRole('button', { name: 'Nova categoria' }).click()
  const folhaCategoria = page.getByRole('dialog', { name: 'Nova categoria' })
  await folhaCategoria.getByLabel(/^Nome da categoria/).fill(CATEGORIA)
  await folhaCategoria.getByRole('button', { name: 'Salvar categoria' }).click()
  await expect(page.getByText('Categoria salva')).toBeVisible()

  await page.getByRole('button', { name: `Item em ${CATEGORIA}` }).click()
  const folhaItem = page.getByRole('dialog', { name: 'Novo item' })
  await folhaItem.getByLabel(/^Nome do item/).fill(ITEM)
  await folhaItem.getByLabel(/^Descrição/).fill('Com farofa e vinagrete')
  await folhaItem.getByLabel(/^Preço/).fill('8990')
  await expect(folhaItem.getByLabel(/^Preço/)).toHaveValue('R$ 89,90')
  await folhaItem.getByRole('button', { name: 'Salvar item' }).click()
  await expect(page.getByText('Item salvo. A IA já passa a usar o cardápio atualizado.')).toBeVisible()
  await expect(page.getByRole('region', { name: CATEGORIA })).toContainText(ITEM)
  await expect(page.getByRole('region', { name: CATEGORIA })).toContainText('R$ 89,90')

  const [gravado] = await getSql()`select i.preco_centavos, i.descricao from menu_items i
    join menu_categories c on c.id = i.category_id where c.nome = ${CATEGORIA}`
  expect(gravado).toEqual({ preco_centavos: 8990, descricao: 'Com farofa e vinagrete' })

  await abrirSimuladorLimpo(page)
  await perguntar(page, `tem picanha na ${UNIDADE}?`)
  const resposta = simulador(page).getByText(new RegExp(`Picanha na brasa ${SUFIXO}`))
  await expect(resposta).toBeVisible({ timeout: 20_000 })
  // preço só do banco, com o nome em negrito do WhatsApp
  await expect(resposta).toContainText(`*${ITEM}*`)
  await expect(resposta).toContainText(/R\$\s89,90/)
})

test('dono envia o arquivo do cardápio; "manda o cardápio" no simulador vira documento', async ({ page }) => {
  await entrarComoGestor(page)
  await page.goto('/conteudo?aba=cardapio&sub=arquivos')
  await page.getByLabel(/^Arquivo/).setInputFiles({ name: 'cardapio.pdf', mimeType: 'application/pdf', buffer: pdf('arquivo') })
  await page.getByLabel(/^Título/).fill(ARQUIVO)
  await expect(page.getByLabel(/^Vale para/)).toHaveValue('')
  await page.getByRole('button', { name: 'Enviar arquivo' }).click()
  await expect(page.getByText('Arquivo enviado')).toBeVisible()
  await expect(page.getByText(ARQUIVO, { exact: true })).toBeVisible()
  await expect(page.getByText(/Todas as unidades · PDF/).first()).toBeVisible()

  await abrirSimuladorLimpo(page)
  await perguntar(page, 'manda o cardápio')
  // bolha de documento com o título do arquivo; simulação nunca sai pela Meta
  await expect(simulador(page).getByText(ARQUIVO, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(simulador(page).getByRole('link', { name: 'Abrir' }).last()).toBeVisible()
  const enviados = await getSql()`select m.tipo, m.status_envio from messages m
    join conversations c on c.id = m.conversation_id join customers cu on cu.id = c.customer_id
    where cu.simulado and m.tipo = 'documento' and m.texto = ${ARQUIVO}`
  expect(enviados).toEqual([{ tipo: 'documento', status_envio: 'simulado' }])
})

test('importar CSV: revisão com itens novos, confirmar e os itens aparecem no cardápio', async ({ page }) => {
  await entrarComoGestor(page)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/conteudo?aba=cardapio&sub=importar')
  await semRolagemHorizontal(page)
  await page.getByLabel(/^Planilha CSV/).setInputFiles({ name: 'cardapio.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await page.getByRole('button', { name: 'Ler planilha' }).click()

  const confirmar = page.getByRole('button', { name: 'Confirmar importação' })
  await expect(confirmar).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: `Categoria ${CATEGORIA_CSV}` })).toBeVisible()
  await expect(page.getByRole('group', { name: `Suco de caju ${SUFIXO}` })).toContainText('Novo')
  await semRolagemHorizontal(page)
  // nada gravado antes de confirmar (PRD I10)
  expect(await getSql()`select 1 from menu_categories where nome = ${CATEGORIA_CSV}`).toHaveLength(0)

  await confirmar.click()
  await expect(page.getByRole('status').filter({ hasText: 'Cardápio atualizado: 2 novos, 0 atualizados' })).toBeVisible()

  await page.goto('/conteudo?aba=cardapio&sub=itens')
  const secao = page.getByRole('region', { name: CATEGORIA_CSV })
  await expect(secao).toContainText(`Suco de caju ${SUFIXO}`)
  await expect(secao).toContainText('R$ 12,90')
  await expect(secao).toContainText(`Água com gás ${SUFIXO}`)
  const itens = await getSql()`select i.nome, i.preco_centavos, i.tags, i.outros_nomes from menu_items i
    join menu_categories c on c.id = i.category_id where c.nome = ${CATEGORIA_CSV} order by i.preco_centavos`
  expect(itens).toEqual([
    { nome: `Água com gás ${SUFIXO}`, preco_centavos: 650, tags: ['bebida'], outros_nomes: [] },
    { nome: `Suco de caju ${SUFIXO}`, preco_centavos: 1290, tags: ['bebida'], outros_nomes: ['suco natural'] },
  ])
})

test('importar PDF: lista de arquivos, "Lendo o cardápio…", revisão com o rascunho da IA, editar, usar como arquivo de envio e confirmar', async ({ page }) => {
  await entrarComoGestor(page)
  // o endereço antigo (Cardápio → Importar) leva à aba Importar
  await page.goto('/conteudo?aba=cardapio&sub=importar')
  await expect(page).toHaveURL(/aba=importar&alvo=cardapio/)
  await page.getByLabel(/^Arquivos/).setInputFiles({ name: 'cardapio-peixes.pdf', mimeType: 'application/pdf', buffer: pdf('importacao') })
  await page.getByRole('button', { name: 'Enviar arquivos' }).click()
  await expect(page.getByRole('list', { name: 'Arquivos para ler' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('button', { name: 'Ler arquivos' }).click()
  await expect(page.getByText('Lendo o cardápio…')).toBeVisible()
  liberarLeitura()

  const confirmar = page.getByRole('button', { name: 'Confirmar importação' })
  await expect(confirmar).toBeVisible({ timeout: 30_000 })
  // PDF enviado ao modelo como parte `file` (caminho OpenAI de produção), com store:false conferido pelo servidor falso
  expect(falso!.leituras).toEqual([{ pdfNativo: true }])
  expect(falso!.provedores.at(-1)).toBe('openai')
  const moqueca = page.getByRole('group', { name: ITEM_PDF })
  await expect(moqueca).toContainText('Novo')
  await expect(moqueca.getByLabel(/^Preço/)).toHaveValue('R$ 119,90')
  // a revisão corrige o preço antes de virar dado oficial
  await moqueca.getByLabel(/^Preço/).fill('12490')
  expect(await getSql()`select 1 from menu_categories where nome = ${CATEGORIA_PDF}`).toHaveLength(0)
  // como na Etapa 05: o arquivo importado vira o cardápio para enviar aos clientes (I3)
  await page.getByLabel('Usar este arquivo como cardápio para enviar aos clientes').check()
  await expect(page.getByLabel(/^Vale para/)).toHaveValue('')

  await confirmar.click()
  await expect(page.getByRole('status').filter({ hasText: 'Cardápio atualizado: 2 novos, 0 atualizados' })).toBeVisible()
  const envio = await getSql()`select m.titulo, m.unit_id, m.mime, m.ativo from menu_files m
    where m.storage_path in (select replace(f.storage_path, 'importacoes/', 'cardapio/') from knowledge_document_files f
      join knowledge_documents k on k.id = f.importacao_id where k.enviado_por in (select id from auth.users where email like '%@teste.local'))`
  expect(envio).toEqual([{ titulo: expect.stringMatching(/^Cardápio importado em /), unit_id: null, mime: 'application/pdf', ativo: true }])
  const itens = await getSql()`select i.nome, i.preco_centavos from menu_items i
    join menu_categories c on c.id = i.category_id where c.nome = ${CATEGORIA_PDF} order by i.preco_centavos nulls last`
  expect(itens).toEqual([
    { nome: ITEM_PDF, preco_centavos: 12490 },
    { nome: `Peixe do dia ${SUFIXO}`, preco_centavos: null },
  ])
  const [doc] = await getSql()`select k.status, k.revisado_por is not null as revisado from knowledge_documents k
    join auth.users u on u.id = k.enviado_por where u.email like '%@teste.local' and k.origem = 'arquivo'`
  expect(doc).toEqual({ status: 'aprovado', revisado: true })
})

test('atendente consulta o cardápio sem botões de edição; aba Conteúdo cabe em 360 px', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/conteudo?aba=cardapio&sub=itens')
  await expect(page.getByRole('region', { name: CATEGORIA })).toContainText(ITEM)
  await semRolagemHorizontal(page)
  await expect(page.getByRole('button', { name: 'Nova categoria' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Novo item' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Editar ${ITEM}` })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Editar categoria ${CATEGORIA}` })).toHaveCount(0)
  // importar é só de dono/gerente
  await expect(page.getByRole('link', { name: 'Importar' })).toHaveCount(0)

  await page.goto('/conteudo?aba=cardapio&sub=arquivos')
  await expect(page.getByText(ARQUIVO, { exact: true })).toBeVisible()
  await semRolagemHorizontal(page)
  await expect(page.getByRole('button', { name: 'Enviar arquivo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Desativar: ${ARQUIVO}` })).toHaveCount(0)
})
