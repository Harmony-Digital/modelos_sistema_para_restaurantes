import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, entrarComoGestor, getAdmin, getSql } from './helpers'
import { iniciarOpenRouterFalso, type LeituraCardapioFalsa, type LeituraPedida } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

/**
 * Etapa 07: importação por IA de informações, horários, espaços e cardápio (várias fotos, PDF em lotes, só preços).
 * A "IA" é o servidor falso: cada teste diz o que ela lê (`leitor`) a partir do schema pedido e dos anexos do lote.
 * Nada vira dado oficial antes de "Confirmar importação" (PRD I10).
 */

const SUFIXO = Date.now().toString(36)
// unidades próprias: a importação de horários substitui a semana inteira da unidade
const UNIDADE_A = `E2E Importa A ${SUFIXO}`
const UNIDADE_B = `E2E Importa B ${SUFIXO}`
const UNIDADE_LIDA = `Lago Norte ${SUFIXO}` // não existe: a revisão exige escolher a unidade ou ignorar
const TEMA_1 = `Estacionamento ${SUFIXO}`
const TEMA_2 = `Pet ${SUFIXO}`
const ESPACO_SALAO = `Salão ${SUFIXO}`
const ESPACO_VARANDA = `Varanda ${SUFIXO}`
const CATEGORIA = `Grelhados ${SUFIXO}`
const CATEGORIA_2 = `Doces ${SUFIXO}`
const FILE = `Filé na chapa ${SUFIXO}`
const ARROZ = `Arroz biro-biro ${SUFIXO}`
const PUDIM = `Pudim ${SUFIXO}`
const ITEM_NOVO = `Prato novo ${SUFIXO}`

let unidadeA = ''
let unidadeB = ''

/** O que a "IA" lê no teste corrente (trocado por cada teste antes de "Ler arquivos"). */
let leitor: (p: LeituraPedida) => unknown = () => {
  throw new Error('leitura não esperada')
}

/** Portão: segura a leitura de um lote até o teste ver o estado da tela. */
const portoes: (() => void)[] = []
function portao() {
  let abrir: () => void = () => {}
  const aberto = new Promise<void>((ok) => { abrir = ok })
  portoes.push(abrir)
  return { aberto, abrir }
}

/** PDF de `n` páginas (o upload e o worker conferem os magic bytes; o pdf-lib do worker conta e copia as páginas). */
function pdf(n: number, marca: string): Buffer {
  const paginas = Array.from({ length: n }, (_, i) => `${3 + i} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n`)
  const kids = paginas.map((_, i) => `${3 + i} 0 R`).join(' ')
  return Buffer.from(
    `%PDF-1.4\n% ${marca} ${SUFIXO}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[${kids}]/Count ${n}>>endobj\n` +
      `${paginas.join('')}trailer<</Root 1 0 R>>\n%%EOF\n`,
  )
}

/** PNG 1×1; os bytes depois do IEND deixam o sha256 único (a "foto" de cada página). */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const png = (marca: string) => Buffer.concat([Buffer.from(PNG_1X1, 'base64'), Buffer.from(`${marca} ${SUFIXO}`)])
const foto = (marca: string) => ({ name: `${marca}.png`, mimeType: 'image/png', buffer: png(marca) })

const itemLido = (nome: string, precoCentavos: number | null) => ({ nome, descricao: null, precoCentavos, tags: [], unidade: null })

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id from restaurants limit 1`
  // cada lote reserva orçamento antes de chamar a IA
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'ia', ${periodo}, 5) on conflict do nothing`
  }
  const [a] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE_A}, ${'e2e-importa-a-' + SUFIXO}, 'Rua A, 1') returning id`
  const [b] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE_B}, ${'e2e-importa-b-' + SUFIXO}, 'Rua B, 2') returning id`
  unidadeA = a!.id as string
  unidadeB = b!.id as string
  falso = await iniciarOpenRouterFalso(() => ({ itens: [], fora_escopo: true }), { leituraDocumento: (p) => leitor(p) })
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  for (const abrir of portoes) abrir()
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`enviado_por in (select id from auth.users where email like '%@teste.local')`
  // arquivos no Storage antes das linhas que guardam o caminho (os arquivos saem junto com a importação: cascade)
  const caminhos = await sql<{ storage_path: string }[]>`
    select f.storage_path from knowledge_document_files f join knowledge_documents k on k.id = f.importacao_id where ${doTeste}`
  for (const { storage_path } of caminhos) {
    const [bucket, ...resto] = storage_path.split('/')
    await getAdmin().storage.from(bucket!).remove([resto.join('/')])
  }
  await sql`delete from knowledge_documents where ${doTeste}`
  await sql`delete from knowledge_facts where tema like ${'%' + SUFIXO}`
  await sql`delete from menu_categories where nome like ${'%' + SUFIXO}`
  // horários, exceções, espaços e fatos da unidade saem junto (on delete cascade)
  await sql`delete from units where id in (${unidadeA}, ${unidadeB})`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

/** Aba Importar do alvo → envia os arquivos → lista em ordem → "Ler arquivos". */
async function importar(page: Page, alvo: string, arquivos: { name: string; mimeType: string; buffer: Buffer }[], modo?: 'Só preços') {
  await page.goto(`/conteudo?aba=importar&alvo=${alvo}`)
  if (modo) await page.getByRole('radio', { name: new RegExp(`^${modo}`) }).check()
  await page.getByLabel(/^Arquivos/).setInputFiles(arquivos)
  await page.getByRole('button', { name: 'Enviar arquivos' }).click()
  await expect(page.getByRole('list', { name: 'Arquivos para ler' }).getByRole('listitem')).toHaveCount(arquivos.length, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Ler arquivos' }).click()
}

const confirmar = (page: Page) => page.getByRole('button', { name: 'Confirmar importação' })

test('informações: PDF de 7 páginas lido em 2 lotes com "Lendo n de m", um rascunho só, confirmar e aparecem em Informações', async ({ page }) => {
  const lote1 = portao()
  const lote2 = portao()
  leitor = async (p) => {
    expect(p.schema).toBe('rascunho_informacoes')
    if (p.partes[0]?.nome === 'documento-1-paginas-1-a-5.pdf') {
      await lote1.aberto
      return { fatos: [{ tema: TEMA_1, texto: 'Gratuito, com manobrista, das 18h às 23h.', exemplos: ['tem estacionamento?'], unidade: null }] }
    }
    await lote2.aberto
    return { fatos: [{ tema: TEMA_2, texto: 'Aceitamos animais de pequeno porte na área externa.', exemplos: [], unidade: UNIDADE_A }] }
  }
  await entrarComoGestor(page)
  await importar(page, 'informacoes', [{ name: 'informacoes.pdf', mimeType: 'application/pdf', buffer: pdf(7, 'informacoes') }])
  await expect(page.getByText('Lendo os arquivos…')).toBeVisible()
  // o worker conta as páginas (sem IA) e lê de 5 em 5: páginas 1–5, depois 6–7
  await expect(page.getByText('Lendo 1 de 2')).toBeVisible({ timeout: 30_000 })
  lote1.abrir()
  await expect(page.getByText('Lendo 2 de 2')).toBeVisible({ timeout: 30_000 })
  lote2.abrir()

  await expect(confirmar(page)).toBeVisible({ timeout: 30_000 })
  expect(falso!.documentos.filter((d) => d.schema === 'rascunho_informacoes').map((d) => d.partes)).toEqual([
    [{ tipo: 'pdf', nome: 'documento-1-paginas-1-a-5.pdf' }],
    [{ tipo: 'pdf', nome: 'documento-1-paginas-6-a-7.pdf' }],
  ])
  // a junção dos dois lotes: um rascunho com as duas informações
  await expect(page.getByRole('group', { name: TEMA_1 })).toContainText('Novo')
  await expect(page.getByRole('group', { name: TEMA_2 }).getByLabel(/^Unidade/)).toHaveValue(UNIDADE_A)
  expect(await getSql()`select 1 from knowledge_facts where tema like ${'%' + SUFIXO}`).toHaveLength(0)

  await confirmar(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Informações atualizadas: 2 novos, 0 atualizados' })).toBeVisible()
  await page.getByRole('link', { name: 'Ver as informações' }).click()
  const fato2 = page.getByRole('listitem').filter({ hasText: TEMA_2 })
  await expect(fato2).toContainText(UNIDADE_A)
  await expect(page.getByRole('listitem').filter({ hasText: TEMA_1 })).toContainText('Todas as unidades')
  const fatos = await getSql()`select tema, unit_id from knowledge_facts where tema like ${'%' + SUFIXO} order by tema`
  expect(fatos).toEqual([{ tema: TEMA_1, unit_id: null }, { tema: TEMA_2, unit_id: unidadeA }])
})

test('horários: unidade não reconhecida exige escolher; escolhida, confirmar atualiza a grade', async ({ page }) => {
  leitor = (p) => {
    expect(p.schema).toBe('rascunho_horarios')
    return {
      unidades: [
        {
          unidade: UNIDADE_A,
          dias: [{ dia: 0, turnos: [] }, { dia: 1, turnos: [{ abre: '11:30', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' }] }],
          excecoes: [],
        },
        { unidade: UNIDADE_LIDA, dias: [{ dia: 2, turnos: [{ abre: '12:00', fecha: '22:00' }] }], excecoes: [] },
      ],
    }
  }
  await entrarComoGestor(page)
  await importar(page, 'horarios', [{ name: 'horarios.pdf', mimeType: 'application/pdf', buffer: pdf(1, 'horarios') }])
  await expect(confirmar(page)).toBeVisible({ timeout: 30_000 })

  const desconhecida = page.getByRole('region', { name: `Horários de ${UNIDADE_LIDA}` })
  await expect(desconhecida).toContainText(`Lido como “${UNIDADE_LIDA}”, que não corresponde a nenhuma unidade.`)
  // confirmar sem escolher a unidade é recusado e nada é gravado (Review Focus 1)
  await confirmar(page).click()
  await expect(desconhecida.getByText('Escolha a unidade ou ignore estes horários.')).toBeVisible()
  expect(await getSql()`select 1 from unit_hours where unit_id in (${unidadeA}, ${unidadeB})`).toHaveLength(0)

  await desconhecida.getByLabel(/^Unidade/).selectOption({ label: UNIDADE_B })
  await confirmar(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Horários atualizados: 2 novos, 0 atualizados' })).toBeVisible()
  const grade = await getSql()`select unit_id, weekday, turno, to_char(abre, 'HH24:MI') as abre, to_char(fecha, 'HH24:MI') as fecha
    from unit_hours where unit_id in (${unidadeA}, ${unidadeB}) order by unit_id = ${unidadeB}, weekday, turno`
  expect(grade).toEqual([
    { unit_id: unidadeA, weekday: 1, turno: 1, abre: '11:30', fecha: '15:00' },
    { unit_id: unidadeA, weekday: 1, turno: 2, abre: '18:00', fecha: '23:00' },
    { unit_id: unidadeB, weekday: 2, turno: 1, abre: '12:00', fecha: '22:00' },
  ])
  await page.goto(`/unidades/${unidadeB}?aba=horarios`)
  await expect(page.getByRole('group', { name: 'Terça-feira' }).getByLabel(/^Abre/)).toHaveValue('12:00')
})

test('espaços: capacidade incompleta pede conferência; confirmados aparecem na unidade', async ({ page }) => {
  leitor = (p) => {
    expect(p).toEqual({ schema: 'rascunho_espacos', partes: [{ tipo: 'imagem', nome: null }] })
    return {
      espacos: [
        { unidade: UNIDADE_A, nome: ESPACO_SALAO, capacidadeMin: 20, capacidadeMax: 80, descricao: 'Climatizado', condicoes: null },
        // "até 30 pessoas": só a máxima foi lida
        { unidade: UNIDADE_A, nome: ESPACO_VARANDA, capacidadeMin: null, capacidadeMax: 30, descricao: null, condicoes: 'Consumação mínima' },
      ],
    }
  }
  await entrarComoGestor(page)
  await importar(page, 'espacos', [foto('espacos')])
  await expect(confirmar(page)).toBeVisible({ timeout: 30_000 })

  const varanda = page.getByRole('group', { name: ESPACO_VARANDA })
  await expect(varanda).toContainText('Só uma capacidade foi lida: confira a capacidade mínima e a máxima.')
  await expect(varanda.getByLabel(/^Capacidade mínima/)).toHaveValue('1')
  await expect(varanda.getByLabel(/^Capacidade máxima/)).toHaveValue('30')
  await expect(page.getByRole('group', { name: ESPACO_SALAO })).toContainText('Novo')
  await varanda.getByLabel(/^Capacidade mínima/).fill('10')
  await expect(varanda).not.toContainText('Só uma capacidade foi lida')
  expect(await getSql()`select 1 from event_spaces where unit_id = ${unidadeA}`).toHaveLength(0)

  await confirmar(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Espaços atualizados: 2 novos, 0 atualizados' })).toBeVisible()
  const espacos = await getSql()`select nome, capacidade_min, capacidade_max from event_spaces where unit_id = ${unidadeA} order by nome`
  expect(espacos).toEqual([
    { nome: ESPACO_SALAO, capacidade_min: 20, capacidade_max: 80 },
    { nome: ESPACO_VARANDA, capacidade_min: 10, capacidade_max: 30 },
  ])
  await page.goto(`/unidades/${unidadeA}?aba=espacos`)
  await expect(page.getByRole('listitem', { name: ESPACO_VARANDA })).toContainText('de 10 a 30 pessoas')
})

test('cardápio: 4 fotos em 2 lotes viram um rascunho; o mesmo item com preços diferentes vira um item com conflito', async ({ page }) => {
  leitor = (p) => {
    expect(p.schema).toBe('rascunho_cardapio')
    // imagens em grupos de 3: fotos 1–3, depois a 4
    const leitura: LeituraCardapioFalsa = p.partes.length === 3
      ? { categorias: [{ nome: CATEGORIA, itens: [itemLido(FILE, 9990), itemLido(ARROZ, 1500)] }] }
      : { categorias: [{ nome: CATEGORIA, itens: [itemLido(FILE, 10490)] }, { nome: CATEGORIA_2, itens: [itemLido(PUDIM, 1690)] }] }
    return leitura
  }
  await entrarComoGestor(page)
  await importar(page, 'cardapio', [foto('pagina-1'), foto('pagina-2'), foto('pagina-3'), foto('pagina-4')])
  await expect(confirmar(page)).toBeVisible({ timeout: 30_000 })
  expect(falso!.documentos.filter((d) => d.schema === 'rascunho_cardapio').map((d) => d.partes.length)).toEqual([3, 1])

  // um item só, com o aviso dos dois preços lidos
  const file = page.getByRole('group', { name: FILE })
  await expect(file).toHaveCount(1)
  await expect(file).toContainText(/Preços diferentes nos arquivos: R\$\s99,90 e R\$\s104,90\. Confira o preço\./)
  await file.getByLabel(/^Preço/).fill('10490')
  expect(await getSql()`select 1 from menu_categories where nome like ${'%' + SUFIXO}`).toHaveLength(0)

  await confirmar(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Cardápio atualizado: 3 novos, 0 atualizados' })).toBeVisible()
  const itens = await getSql()`select i.nome, i.preco_centavos from menu_items i
    join menu_categories c on c.id = i.category_id where c.nome like ${'%' + SUFIXO} order by i.nome`
  expect(itens).toEqual([
    { nome: ARROZ, preco_centavos: 1500 },
    { nome: FILE, preco_centavos: 10490 },
    { nome: PUDIM, preco_centavos: 1690 },
  ])
})

test('só preços: antes → depois, item novo e preço não lido ficam de fora; confirmar muda só o preço', async ({ page }) => {
  leitor = (p) => {
    expect(p.schema).toBe('rascunho_cardapio')
    return { categorias: [{ nome: CATEGORIA, itens: [itemLido(FILE, 11290), itemLido(ARROZ, null), itemLido(ITEM_NOVO, 5000)] }] }
  }
  await entrarComoGestor(page)
  await importar(page, 'cardapio', [foto('tabela-de-precos')], 'Só preços')
  await expect(confirmar(page)).toBeVisible({ timeout: 30_000 })

  await expect(page.getByRole('group', { name: FILE })).toContainText(/R\$\s104,90 → R\$\s112,90/)
  const fora = page.getByRole('region', { name: 'Ficam de fora' })
  await expect(fora.getByRole('listitem').filter({ hasText: ITEM_NOVO })).toContainText('não está no cardápio')
  await expect(fora.getByRole('listitem').filter({ hasText: ARROZ })).toContainText('preço não lido (o atual fica)')

  await confirmar(page).click()
  await expect(page.getByRole('status').filter({ hasText: /^Preços atualizados: 1 item/ })).toBeVisible()
  const itens = await getSql()`select i.nome, i.preco_centavos from menu_items i
    join menu_categories c on c.id = i.category_id where c.nome like ${'%' + SUFIXO} order by i.nome`
  // o item novo não entra e o preço não lido não zera o atual
  expect(itens).toEqual([
    { nome: ARROZ, preco_centavos: 1500 },
    { nome: FILE, preco_centavos: 11290 },
    { nome: PUDIM, preco_centavos: 1690 },
  ])
})
