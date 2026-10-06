import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const criarImportacao = vi.fn()
const lerImportacao = vi.fn()
const aplicarRascunho = vi.fn()
const rejeitarImportacao = vi.fn()
const copy = vi.fn()
const from = vi.fn(() => ({ copy }))
const revalidatePath = vi.fn()
// o pacote `server-only` lança fora do bundle de servidor do Next (upload-arquivo.ts o importa)
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ storage: { from } }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ criarImportacao, lerImportacao, aplicarRascunho, rejeitarImportacao }))

const A = await import('./importar-actions')

const REST = '00000000-0000-4000-8000-0000000000aa'
const ID = '00000000-0000-4000-8000-000000000011'
const UNI = '00000000-0000-4000-8000-000000000002'
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

describe('estado, aplicar e descartar', () => {
  it('estado para o acompanhamento (polling)', async () => {
    lerImportacao.mockResolvedValue({ id: ID, status: 'erro', erro: 'Não consegui ler esse arquivo.', loteAtual: 0, lotesTotal: null })
    expect(await A.estadoImportacaoAction(ID)).toEqual({ ok: true, data: { status: 'erro', erro: 'Não consegui ler esse arquivo.', loteAtual: 0, lotesTotal: null } })
    // vários arquivos: o progresso por lote vai para "Lendo n de m"
    lerImportacao.mockResolvedValue({ id: ID, status: 'processando', erro: null, loteAtual: 2, lotesTotal: 5 })
    expect(await A.estadoImportacaoAction(ID)).toEqual({ ok: true, data: { status: 'processando', erro: null, loteAtual: 2, lotesTotal: 5 } })
    lerImportacao.mockResolvedValue(null)
    expect(await A.estadoImportacaoAction(ID)).toMatchObject({ ok: false })
    expect(await A.estadoImportacaoAction('x')).toMatchObject({ ok: false })
  })
  it('aplicar: valida o rascunho e devolve as contagens e os ignorados', async () => {
    const ignorados = [{ categoria: 'Carnes', nome: 'Cupim', motivo: 'unidade_desconhecida' }]
    aplicarRascunho.mockResolvedValue({ ok: true, valor: { criados: 1, atualizados: 0, ignorados } })
    lerImportacao.mockResolvedValue({ id: ID, storagePath: `importacoes/${REST}/abc.pdf` })
    copy.mockResolvedValue({ data: { path: `${REST}/abc.pdf` }, error: null })
    const opcoes = { usarComoArquivoDeEnvio: true, unitIdArquivo: UNI }
    expect(await A.aplicarRascunhoAction(ID, rascunho, opcoes)).toEqual({ ok: true, data: { criados: 1, atualizados: 0, ignorados } })
    expect(aplicarRascunho).toHaveBeenCalledWith('db', { sub: 'u' }, ID, rascunho, opcoes)
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    // arquivo de envio: copiado para o bucket cardapio (a equipe toda vê a prévia) antes de aplicar (M5)
    expect(from).toHaveBeenCalledWith('importacoes')
    expect(copy).toHaveBeenCalledWith(`${REST}/abc.pdf`, `${REST}/abc.pdf`, { destinationBucket: 'cardapio' })
  })
  it('aplicar com arquivo de envio: cópia já existente é aceita; falha do Storage não aplica nada (M5)', async () => {
    lerImportacao.mockResolvedValue({ id: ID, storagePath: `importacoes/${REST}/abc.pdf` })
    aplicarRascunho.mockResolvedValue({ ok: true, valor: { criados: 1, atualizados: 0, ignorados: [] } })
    const opcoes = { usarComoArquivoDeEnvio: true, unitIdArquivo: null }
    copy.mockResolvedValue({ data: null, error: { statusCode: '409', message: 'The resource already exists' } })
    expect(await A.aplicarRascunhoAction(ID, rascunho, opcoes)).toMatchObject({ ok: true })
    aplicarRascunho.mockClear()
    copy.mockResolvedValue({ data: null, error: { statusCode: '500', message: 'boom' } })
    expect(await A.aplicarRascunhoAction(ID, rascunho, opcoes)).toEqual({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
    expect(aplicarRascunho).not.toHaveBeenCalled()
    // sem arquivo de envio, não copia
    copy.mockClear()
    await A.aplicarRascunhoAction(ID, rascunho, { usarComoArquivoDeEnvio: false, unitIdArquivo: null })
    expect(copy).not.toHaveBeenCalled()
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
    lerImportacao.mockResolvedValue({ id: ID, storagePath: null })
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
    expect(await A.descartarImportacaoAction(ID)).toEqual({ ok: false, formError: 'Essa importação já foi aplicada, descartada ou está sendo lida.' })
    expect(await A.descartarImportacaoAction('x')).toMatchObject({ ok: false })
  })
})
