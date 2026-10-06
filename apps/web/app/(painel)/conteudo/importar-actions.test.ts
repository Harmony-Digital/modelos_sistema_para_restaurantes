import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const criarImportacao = vi.fn()
const lerImportacao = vi.fn()
const aplicarRascunho = vi.fn()
const rejeitarImportacao = vi.fn()
const enfileirar = vi.fn()
const enqueueIngest = vi.fn(() => enfileirar)
const upload = vi.fn()
const from = vi.fn(() => ({ upload }))
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/boss', () => ({ getBoss: async () => 'boss' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ storage: { from } }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ criarImportacao, lerImportacao, aplicarRascunho, rejeitarImportacao, enqueueIngest }))

const A = await import('./importar-actions')

const REST = '00000000-0000-4000-8000-0000000000aa'
const ID = '00000000-0000-4000-8000-000000000011'
const UNI = '00000000-0000-4000-8000-000000000002'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]
const fdCom = (f: File | string | null) => {
  const fd = new FormData()
  if (f !== null) fd.set('arquivo', f)
  return fd
}
const csv = (texto: string, nome = 'cardapio.csv') => new File([texto], nome, { type: 'text/csv' })
const bin = (bytes: number[], nome = 'foto.png', type = 'image/png') => new File([Uint8Array.from(bytes)], nome, { type })
const rascunho = {
  categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: null, precoCentavos: 8990, tags: [], outrosNomes: [], unidade: null, incluir: true }] }],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: REST, role: 'dono' })
})

describe('importarCsvAction', () => {
  it('erros por linha voltam antes de criar a importação', async () => {
    const r = await A.importarCsvAction(fdCom(csv('categoria;nome;preco\nCarnes;Picanha;abc\n;Sem categoria;10\nCarnes;Costela;45,90\n')))
    expect(r).toEqual({ ok: true, data: { id: null, erros: ['Linha 2: preço inválido.', 'Linha 3: categoria vazia.'] } })
    expect(criarImportacao).not.toHaveBeenCalled()
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('planilha válida ⇒ importação nasce com o rascunho lido no servidor', async () => {
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    const texto = 'categoria,nome,preco,tags\nCarnes,Picanha,"89,90",sem glúten\n'
    expect(await A.importarCsvAction(fdCom(csv(texto)))).toEqual({ ok: true, data: { id: ID, erros: [] } })
    const bytes = new TextEncoder().encode(texto)
    expect(criarImportacao).toHaveBeenCalledWith('db', { sub: 'u' }, {
      storagePath: null, mime: 'text/csv', tamanho: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), origem: 'csv',
      draft: { categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: null, precoCentavos: 8990, tags: ['sem_gluten'], outrosNomes: [], unidade: null, incluir: true }] }] },
    })
    expect(enfileirar).not.toHaveBeenCalled()
  })
  it('o modelo para baixar é lido sem erros', async () => {
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    const modelo = readFileSync(new URL('../../../public/modelo-cardapio.csv', import.meta.url))
    expect(await A.importarCsvAction(fdCom(new File([modelo], 'modelo-cardapio.csv')))).toEqual({ ok: true, data: { id: ID, erros: [] } })
    expect(criarImportacao.mock.calls[0]![2].draft.categorias.map((c: { nome: string }) => c.nome)).toEqual(['Carnes', 'Bebidas', 'Sobremesas'])
  })
  it('planilha salva no Excel em Windows-1252 é lida com acento', async () => {
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    // "Pão" em Windows-1252: 0xE3 para ã
    const bytes = Uint8Array.from([...new TextEncoder().encode('categoria;nome\nPadaria;P'), 0xe3, ...new TextEncoder().encode('o\n')])
    await A.importarCsvAction(fdCom(new File([bytes], 'c.csv')))
    expect(criarImportacao.mock.calls[0]![2].draft.categorias[0].itens[0].nome).toBe('Pão')
  })
  it('sem arquivo, planilha do Excel (.xlsx) ou grande demais é recusada', async () => {
    expect(await A.importarCsvAction(fdCom(null))).toEqual({ ok: false, fieldErrors: { arquivo: 'Escolha a planilha CSV.' } })
    const xlsx = bin([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00], 'c.xlsx')
    expect(await A.importarCsvAction(fdCom(xlsx))).toEqual({
      ok: false, fieldErrors: { arquivo: 'Envie a planilha salva como CSV (no Excel: Salvar como → CSV).' },
    })
    const grande = csv('x')
    Object.defineProperty(grande, 'size', { value: 2 * 1024 * 1024 + 1 })
    expect(await A.importarCsvAction(fdCom(grande))).toEqual({ ok: false, fieldErrors: { arquivo: 'A planilha passa de 2 MB.' } })
    expect(criarImportacao).not.toHaveBeenCalled()
  })
  it('atendente/sem permissão no banco vira mensagem', async () => {
    criarImportacao.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await A.importarCsvAction(fdCom(csv('categoria,nome\nCarnes,Picanha\n')))).toEqual({
      ok: false, formError: 'Só o dono ou o gerente importam o cardápio.',
    })
  })
})

describe('importarArquivoAction', () => {
  it('foto vai ao bucket importacoes, cria a importação e enfileira a leitura', async () => {
    upload.mockResolvedValue({ error: null })
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    lerImportacao.mockResolvedValue({ id: ID, status: 'enviado' })
    expect(await A.importarArquivoAction(fdCom(bin(PNG)))).toEqual({ ok: true, data: { id: ID, status: 'enviado' } })
    const sha = createHash('sha256').update(Uint8Array.from(PNG)).digest('hex')
    expect(from).toHaveBeenCalledWith('importacoes')
    expect(upload).toHaveBeenCalledWith(`${REST}/${sha}.png`, expect.anything(), { contentType: 'image/png', upsert: false })
    expect(criarImportacao).toHaveBeenCalledWith('db', { sub: 'u' }, {
      storagePath: `importacoes/${REST}/${sha}.png`, mime: 'image/png', tamanho: PNG.length, sha256: sha, origem: 'arquivo',
    })
    expect(enqueueIngest).toHaveBeenCalledWith('boss')
    expect(enfileirar).toHaveBeenCalledWith(ID)
  })
  it('upload falso (nome e MIME de PDF, bytes de executável) é recusado sem tocar o Storage', async () => {
    const r = await A.importarArquivoAction(fdCom(bin([0x4d, 0x5a, 0x90, 0x00], 'cardapio.pdf', 'application/pdf')))
    expect(r).toEqual({ ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' } })
    expect(upload).not.toHaveBeenCalled()
    expect(criarImportacao).not.toHaveBeenCalled()
  })
  it('mesmo arquivo já importado (aprovado ou em rascunho) não é reenfileirado: a tela vai ao estado atual', async () => {
    upload.mockResolvedValue({ error: { statusCode: '409', message: 'The resource already exists' } })
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    for (const status of ['aprovado', 'rascunho', 'processando'] as const) {
      lerImportacao.mockResolvedValueOnce({ id: ID, status })
      expect(await A.importarArquivoAction(fdCom(bin(PNG)))).toEqual({ ok: true, data: { id: ID, status } })
    }
    expect(enfileirar).not.toHaveBeenCalled()
  })
  it('fila fora do ar: avisa para tentar de novo (o reenvio do mesmo arquivo enfileira)', async () => {
    upload.mockResolvedValue({ error: null })
    criarImportacao.mockResolvedValue({ ok: true, valor: { id: ID } })
    lerImportacao.mockResolvedValue({ id: ID, status: 'enviado' })
    enfileirar.mockRejectedValueOnce(new Error('down'))
    expect(await A.importarArquivoAction(fdCom(bin(PNG)))).toEqual({
      ok: false, formError: 'Recebemos o arquivo, mas não foi possível começar a leitura agora. Envie de novo em instantes.',
    })
  })
  it('falha do Storage vira erro geral', async () => {
    upload.mockResolvedValue({ error: { statusCode: '500', message: 'boom' } })
    expect(await A.importarArquivoAction(fdCom(bin(PNG)))).toEqual({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
    expect(criarImportacao).not.toHaveBeenCalled()
  })
})

describe('estado, aplicar e descartar', () => {
  it('estado para o acompanhamento (polling)', async () => {
    lerImportacao.mockResolvedValue({ id: ID, status: 'erro', erro: 'Não consegui ler esse arquivo.' })
    expect(await A.estadoImportacaoAction(ID)).toEqual({ ok: true, data: { status: 'erro', erro: 'Não consegui ler esse arquivo.' } })
    lerImportacao.mockResolvedValue(null)
    expect(await A.estadoImportacaoAction(ID)).toMatchObject({ ok: false })
    expect(await A.estadoImportacaoAction('x')).toMatchObject({ ok: false })
  })
  it('aplicar: valida o rascunho e devolve as contagens e os ignorados', async () => {
    const ignorados = [{ categoria: 'Carnes', nome: 'Cupim', motivo: 'unidade_desconhecida' }]
    aplicarRascunho.mockResolvedValue({ ok: true, valor: { criados: 1, atualizados: 0, ignorados } })
    const opcoes = { usarComoArquivoDeEnvio: true, unitIdArquivo: UNI }
    expect(await A.aplicarRascunhoAction(ID, rascunho, opcoes)).toEqual({ ok: true, data: { criados: 1, atualizados: 0, ignorados } })
    expect(aplicarRascunho).toHaveBeenCalledWith('db', { sub: 'u' }, ID, rascunho, opcoes)
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('aplicar: rascunho inválido não chega ao banco', async () => {
    const ruim = { categorias: [{ nome: 'Carnes', itens: [{ ...rascunho.categorias[0]!.itens[0]!, precoCentavos: -1 }] }] }
    expect(await A.aplicarRascunhoAction(ID, ruim, { usarComoArquivoDeEnvio: false, unitIdArquivo: null })).toMatchObject({ ok: false })
    expect(await A.aplicarRascunhoAction(ID, rascunho, { usarComoArquivoDeEnvio: false, unitIdArquivo: 'x' })).toMatchObject({ ok: false })
    expect(aplicarRascunho).not.toHaveBeenCalled()
  })
  it('aplicar duas vezes ⇒ "Essa importação já foi aplicada."', async () => {
    aplicarRascunho.mockResolvedValue({ ok: false, erro: 'ja_aplicado' })
    expect(await A.aplicarRascunhoAction(ID, rascunho, { usarComoArquivoDeEnvio: false, unitIdArquivo: null })).toEqual({
      ok: false, formError: 'Essa importação já foi aplicada.',
    })
    aplicarRascunho.mockResolvedValue({ ok: false, erro: 'arquivo_invalido' })
    expect(await A.aplicarRascunhoAction(ID, rascunho, { usarComoArquivoDeEnvio: true, unitIdArquivo: null })).toEqual({
      ok: false, formError: 'Este arquivo não pode ser usado como cardápio para enviar aos clientes.',
    })
    aplicarRascunho.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await A.aplicarRascunhoAction(ID, rascunho, { usarComoArquivoDeEnvio: false, unitIdArquivo: null })).toEqual({
      ok: false, formError: 'Só o dono, ou gerente com acesso a todas as unidades, aplica a importação.',
    })
  })
  it('descartar', async () => {
    rejeitarImportacao.mockResolvedValue({ ok: true, valor: null })
    expect(await A.descartarImportacaoAction(ID)).toEqual({ ok: true, data: null })
    expect(rejeitarImportacao).toHaveBeenCalledWith('db', { sub: 'u' }, ID)
    rejeitarImportacao.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await A.descartarImportacaoAction(ID)).toEqual({ ok: false, formError: 'Essa importação já foi aplicada ou descartada.' })
    expect(await A.descartarImportacaoAction('x')).toMatchObject({ ok: false })
  })
})
