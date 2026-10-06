import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarCategoria = vi.fn()
const salvarItem = vi.fn()
const salvarExcecaoItem = vi.fn()
const registrarArquivoCardapio = vi.fn()
const ativarArquivo = vi.fn()
const listarCardapio = vi.fn()
const upload = vi.fn()
const createSignedUrl = vi.fn()
const from = vi.fn(() => ({ upload, createSignedUrl }))
// o pacote `server-only` lança fora do bundle de servidor do Next (upload-arquivo.ts o importa)
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ storage: { from } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@atd/db', () => ({ salvarCategoria, salvarItem, salvarExcecaoItem, registrarArquivoCardapio, ativarArquivo, listarCardapio }))

const A = await import('./cardapio-actions')

const CAT = '00000000-0000-4000-8000-000000000001'
const UNI = '00000000-0000-4000-8000-000000000002'
const REST = '00000000-0000-4000-8000-0000000000aa'
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]
const arquivo = (bytes: number[], name = 'cardapio.pdf', type = 'application/pdf') => new File([Uint8Array.from(bytes)], name, { type })
const form = (f: File | string | null, extra: Record<string, string> = {}) => {
  const fd = new FormData()
  if (f !== null) fd.set('arquivo', f)
  fd.set('titulo', extra.titulo ?? 'Cardápio do almoço')
  fd.set('unitId', extra.unitId ?? '')
  return fd
}
const itemOk: Parameters<typeof A.salvarItemAction>[1] = { categoryId: CAT, nome: 'Picanha', descricao: '', preco: 'R$ 89,90', tags: ['vegano'], outrosNomes: [], disponivel: true, ordem: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: REST, role: 'dono' })
})

describe('categoria e item', () => {
  it('papéis: só dono e gerente (requireStaff com os dois)', async () => {
    salvarCategoria.mockResolvedValue({ ok: true, valor: { id: 'c' } })
    await A.salvarCategoriaAction(null, { nome: 'Carnes', ordem: '1', ativo: true })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('entrada inválida não chega ao banco', async () => {
    expect(await A.salvarCategoriaAction(null, { nome: '', ordem: '1', ativo: true })).toMatchObject({ ok: false, fieldErrors: { nome: 'Informe o nome' } })
    expect(await A.salvarCategoriaAction('nao-uuid', { nome: 'x', ordem: '1', ativo: true })).toMatchObject({ ok: false })
    expect(await A.salvarItemAction(null, { ...itemOk, tags: ['<b>picante</b>' as never] })).toMatchObject({ ok: false })
    expect(salvarCategoria).not.toHaveBeenCalled()
    expect(salvarItem).not.toHaveBeenCalled()
  })
  it('item: preço vira centavos e descrição vazia vira nula', async () => {
    salvarItem.mockResolvedValue({ ok: true, valor: { id: 'i' } })
    expect(await A.salvarItemAction(null, itemOk)).toEqual({ ok: true, data: { id: 'i' } })
    expect(salvarItem).toHaveBeenCalledWith('db', { sub: 'u' }, null, {
      categoryId: CAT, nome: 'Picanha', descricao: null, precoCentavos: 8990, tags: ['vegano'], outrosNomes: [], disponivel: true, ordem: 2,
    })
  })
  it('gerente restrito e nome repetido viram mensagens em português', async () => {
    salvarItem.mockResolvedValueOnce({ ok: false, erro: 'sem_permissao' })
    expect(await A.salvarItemAction(null, itemOk)).toEqual({
      ok: false, formError: 'Só o dono, ou gerente com acesso a todas as unidades, altera categorias e itens.',
    })
    salvarItem.mockResolvedValueOnce({ ok: false, erro: 'nome_duplicado' })
    expect(await A.salvarItemAction(null, itemOk)).toEqual({ ok: false, fieldErrors: { nome: 'Já existe um item com esse nome nessa categoria.' } })
    salvarCategoria.mockResolvedValueOnce({ ok: false, erro: 'nome_duplicado' })
    expect(await A.salvarCategoriaAction(null, { nome: 'Carnes', ordem: '1', ativo: true })).toEqual({
      ok: false, fieldErrors: { nome: 'Já existe uma categoria com esse nome.' },
    })
  })
})

describe('exceção por unidade', () => {
  it('sem disponibilidade nem preço = remover (volta ao padrão)', async () => {
    salvarExcecaoItem.mockResolvedValue({ ok: true, valor: null })
    await A.salvarExcecaoAction({ itemId: CAT, unitId: UNI, disponivel: 'segue', preco: '' })
    expect(salvarExcecaoItem).toHaveBeenLastCalledWith('db', { sub: 'u' }, { itemId: CAT, unitId: UNI, remover: true })
    await A.salvarExcecaoAction({ itemId: CAT, unitId: UNI, disponivel: 'segue', preco: 'R$ 9,00' })
    expect(salvarExcecaoItem).toHaveBeenLastCalledWith('db', { sub: 'u' }, { itemId: CAT, unitId: UNI, disponivel: null, precoOverrideCentavos: 900 })
  })
  it('unidade fora do alcance do gerente', async () => {
    salvarExcecaoItem.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect((await A.salvarExcecaoAction({ itemId: CAT, unitId: UNI, disponivel: 'nao', preco: '' })).ok).toBe(false)
  })
})

describe('enviarArquivoAction', () => {
  it('envia ao Storage do usuário com nome por sha256 e registra', async () => {
    upload.mockResolvedValue({ error: null })
    registrarArquivoCardapio.mockResolvedValue({ ok: true, valor: { id: 'f' } })
    const r = await A.enviarArquivoAction(form(arquivo(PDF)))
    expect(r).toEqual({ ok: true, data: { id: 'f' } })
    const sha = createHash('sha256').update(Uint8Array.from(PDF)).digest('hex')
    expect(from).toHaveBeenCalledWith('cardapio')
    expect(upload).toHaveBeenCalledWith(`${REST}/${sha}.pdf`, expect.anything(), { contentType: 'application/pdf', upsert: false })
    expect(registrarArquivoCardapio).toHaveBeenCalledWith('db', { sub: 'u' }, {
      unitId: null, titulo: 'Cardápio do almoço', storagePath: `cardapio/${REST}/${sha}.pdf`, mime: 'application/pdf', tamanho: PDF.length, sha256: sha,
    })
  })
  it('arquivo falso (extensão e MIME de PDF, bytes de executável) é recusado sem tocar o Storage', async () => {
    const r = await A.enviarArquivoAction(form(arquivo([0x4d, 0x5a, 0x90, 0x00], 'cardapio.pdf', 'application/pdf')))
    expect(r).toEqual({ ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' } })
    expect(upload).not.toHaveBeenCalled()
    expect(registrarArquivoCardapio).not.toHaveBeenCalled()
  })
  it('arquivo acima de 20 MB é recusado pelo tamanho declarado, antes de ler o corpo', async () => {
    const grande = new File([new Uint8Array(1)], 'g.pdf', { type: 'application/pdf' })
    Object.defineProperty(grande, 'size', { value: 20 * 1024 * 1024 + 1 })
    const r = await A.enviarArquivoAction(form(grande))
    expect(r).toEqual({ ok: false, fieldErrors: { arquivo: 'O arquivo passa de 20 MB. Envie um menor.' } })
    expect(upload).not.toHaveBeenCalled()
  })
  it('sem arquivo, texto no lugar do arquivo e título vazio', async () => {
    expect(await A.enviarArquivoAction(form(null))).toMatchObject({ ok: false, fieldErrors: { arquivo: 'Escolha o arquivo do cardápio.' } })
    expect(await A.enviarArquivoAction(form('texto'))).toMatchObject({ ok: false, fieldErrors: { arquivo: 'Escolha o arquivo do cardápio.' } })
    expect(await A.enviarArquivoAction(form(arquivo(PDF), { titulo: ' ' }))).toMatchObject({ ok: false, fieldErrors: { titulo: 'Dê um título ao arquivo' } })
    expect(upload).not.toHaveBeenCalled()
  })
  it('mesmo conteúdo já no Storage é aceito (nome por sha256); falha do Storage vira erro geral', async () => {
    registrarArquivoCardapio.mockResolvedValue({ ok: true, valor: { id: 'f' } })
    upload.mockResolvedValueOnce({ error: { statusCode: '409', message: 'The resource already exists' } })
    expect((await A.enviarArquivoAction(form(arquivo(PDF)))).ok).toBe(true)
    upload.mockResolvedValueOnce({ error: { statusCode: '500', message: 'boom' } })
    expect(await A.enviarArquivoAction(form(arquivo(PDF)))).toEqual({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
  })
  it('sem permissão na unidade escolhida', async () => {
    upload.mockResolvedValue({ error: null })
    registrarArquivoCardapio.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await A.enviarArquivoAction(form(arquivo(PDF), { unitId: UNI }))).toEqual({
      ok: false, formError: 'Você só pode alterar o cardápio das unidades que gerencia.',
    })
  })
})

describe('ativar e prévia', () => {
  it('ativar exige dono/gerente e id válido', async () => {
    ativarArquivo.mockResolvedValue({ ok: true, valor: null })
    expect(await A.ativarArquivoAction('x', false)).toMatchObject({ ok: false })
    expect(await A.ativarArquivoAction(CAT, false)).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(ativarArquivo).toHaveBeenCalledWith('db', { sub: 'u' }, CAT, false)
  })
  it('prévia: URL assinada curta do arquivo visível; qualquer papel da equipe', async () => {
    listarCardapio.mockResolvedValue({ arquivos: [{ id: CAT, storagePath: `cardapio/${REST}/a.pdf`, mime: 'application/pdf', titulo: 'T' }] })
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/x' }, error: null })
    expect(await A.urlPreviaArquivoAction(CAT)).toEqual({ ok: true, data: { url: 'https://s/x', mime: 'application/pdf', titulo: 'T' } })
    expect(requireStaff).toHaveBeenCalledWith()
    expect(from).toHaveBeenCalledWith('cardapio')
    expect(createSignedUrl).toHaveBeenCalledWith(`${REST}/a.pdf`, 120)
    expect(await A.urlPreviaArquivoAction(UNI)).toMatchObject({ ok: false })
  })
})
