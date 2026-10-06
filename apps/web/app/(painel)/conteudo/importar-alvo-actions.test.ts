import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const criarImportacaoArquivos = vi.fn()
const anexarArquivo = vi.fn()
const removerArquivo = vi.fn()
const iniciarLeitura = vi.fn()
const aplicarImportacao = vi.fn()
const lerImportacao = vi.fn()
const enfileirar = vi.fn()
const enqueueIngest = vi.fn(() => enfileirar)
const upload = vi.fn()
const from = vi.fn(() => ({ upload }))
const revalidatePath = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/boss', () => ({ getBoss: async () => 'boss' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ storage: { from } }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ criarImportacaoArquivos, anexarArquivo, removerArquivo, iniciarLeitura, aplicarImportacao, lerImportacao, enqueueIngest }))

const A = await import('./importar-alvo-actions')

const REST = '00000000-0000-4000-8000-0000000000aa'
const ID = '00000000-0000-4000-8000-000000000011'
const OUTRA = '00000000-0000-4000-8000-000000000012'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]
const fdCom = (f: File | null) => {
  const fd = new FormData()
  if (f !== null) fd.set('arquivo', f)
  return fd
}
const bin = (bytes: number[], nome = 'foto.png', type = 'image/png') => new File([Uint8Array.from(bytes)], nome, { type })
const SEM_PERMISSAO = 'Só o dono, ou gerente com acesso a todas as unidades, importa arquivos.'

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: REST, role: 'dono' })
})

describe('novaImportacaoAction', () => {
  it('cria a importação do alvo (dono/gerente; o banco confere o acesso a todas as unidades)', async () => {
    criarImportacaoArquivos.mockResolvedValue({ ok: true, valor: { id: ID } })
    expect(await A.novaImportacaoAction({ alvo: 'cardapio', modo: 'so_precos' })).toEqual({ ok: true, data: { id: ID } })
    expect(criarImportacaoArquivos).toHaveBeenCalledWith('db', { sub: 'u' }, { alvo: 'cardapio', modo: 'so_precos' })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('alvo desconhecido ou "só preços" fora do cardápio não chega ao banco', async () => {
    expect(await A.novaImportacaoAction({ alvo: 'clientes' as never, modo: 'completo' })).toMatchObject({ ok: false })
    expect(await A.novaImportacaoAction({ alvo: 'horarios', modo: 'so_precos' })).toMatchObject({ ok: false })
    expect(criarImportacaoArquivos).not.toHaveBeenCalled()
  })
  it('gerente restrito a uma unidade: mensagem de permissão', async () => {
    criarImportacaoArquivos.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await A.novaImportacaoAction({ alvo: 'horarios', modo: 'completo' })).toEqual({ ok: false, formError: SEM_PERMISSAO })
  })
})

describe('anexarArquivoAction (um arquivo por requisição)', () => {
  it('valida os bytes, sobe para o bucket importacoes e anexa na lista', async () => {
    upload.mockResolvedValue({ error: null })
    anexarArquivo.mockResolvedValue({ ok: true, valor: { ordem: 2 } })
    expect(await A.anexarArquivoAction(ID, fdCom(bin(PNG)))).toEqual({ ok: true, data: { ordem: 2 } })
    const sha = createHash('sha256').update(Uint8Array.from(PNG)).digest('hex')
    expect(from).toHaveBeenCalledWith('importacoes')
    expect(anexarArquivo).toHaveBeenCalledWith('db', { sub: 'u' }, ID, {
      storagePath: `importacoes/${REST}/${sha}.png`, mime: 'image/png', tamanho: PNG.length, sha256: sha,
    })
  })
  it('upload falso, vazio ou grande demais é recusado sem tocar o Storage', async () => {
    expect(await A.anexarArquivoAction(ID, fdCom(bin([0x4d, 0x5a], 'c.pdf', 'application/pdf')))).toEqual({
      ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' },
    })
    expect(await A.anexarArquivoAction(ID, fdCom(null))).toMatchObject({ ok: false, fieldErrors: { arquivo: expect.any(String) } })
    const grande = bin(PNG)
    Object.defineProperty(grande, 'size', { value: 21 * 1024 * 1024 })
    expect(await A.anexarArquivoAction(ID, fdCom(grande))).toMatchObject({ ok: false, fieldErrors: { arquivo: expect.stringMatching(/passa de/) } })
    expect(upload).not.toHaveBeenCalled()
    expect(anexarArquivo).not.toHaveBeenCalled()
  })
  it('id inválido não sobe nada', async () => {
    expect(await A.anexarArquivoAction('x', fdCom(bin(PNG)))).toMatchObject({ ok: false })
    expect(upload).not.toHaveBeenCalled()
  })
  it('mais de 10 arquivos, leitura já iniciada e falha do Storage viram mensagem', async () => {
    upload.mockResolvedValue({ error: null })
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: 'limite_arquivos' })
    expect(await A.anexarArquivoAction(ID, fdCom(bin(PNG)))).toEqual({ ok: false, formError: 'No máximo 10 arquivos por importação.' })
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: 'ja_iniciada' })
    expect(await A.anexarArquivoAction(ID, fdCom(bin(PNG)))).toEqual({
      ok: false, formError: 'A leitura destes arquivos já começou. Para mudar a lista, comece outra importação.',
    })
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: 'sem_permissao' })
    expect(await A.anexarArquivoAction(ID, fdCom(bin(PNG)))).toEqual({ ok: false, formError: SEM_PERMISSAO })
    upload.mockResolvedValue({ error: { statusCode: '500', message: 'boom' } })
    anexarArquivo.mockClear()
    expect(await A.anexarArquivoAction(ID, fdCom(bin(PNG)))).toEqual({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
    expect(anexarArquivo).not.toHaveBeenCalled()
  })
})

describe('removerArquivoAction', () => {
  it('remove pela posição; posição inválida não chega ao banco', async () => {
    removerArquivo.mockResolvedValue({ ok: true, valor: null })
    expect(await A.removerArquivoAction(ID, 3)).toEqual({ ok: true, data: null })
    expect(removerArquivo).toHaveBeenCalledWith('db', { sub: 'u' }, ID, 3)
    expect(await A.removerArquivoAction(ID, 0)).toMatchObject({ ok: false })
    expect(await A.removerArquivoAction(ID, 11)).toMatchObject({ ok: false })
    expect(await A.removerArquivoAction('x', 1)).toMatchObject({ ok: false })
    expect(removerArquivo).toHaveBeenCalledTimes(1)
    removerArquivo.mockResolvedValue({ ok: false, erro: 'ja_iniciada' })
    expect(await A.removerArquivoAction(ID, 1)).toMatchObject({ ok: false, formError: expect.stringMatching(/já começou/) })
  })
})

describe('lerArquivosAction', () => {
  it('fecha a lista e enfileira a leitura', async () => {
    iniciarLeitura.mockResolvedValue({ ok: true, valor: null })
    expect(await A.lerArquivosAction(ID)).toEqual({ ok: true, data: { id: ID, existente: false } })
    expect(enfileirar).toHaveBeenCalledWith(ID)
    expect(revalidatePath).toHaveBeenCalledWith('/conteudo')
  })
  it('mesmo conjunto já importado: devolve a importação existente sem enfileirar', async () => {
    iniciarLeitura.mockResolvedValue({ ok: false, erro: 'ja_importado', id: OUTRA })
    expect(await A.lerArquivosAction(ID)).toEqual({ ok: true, data: { id: OUTRA, existente: true } })
    expect(enfileirar).not.toHaveBeenCalled()
  })
  it('sem arquivos ⇒ mensagem', async () => {
    iniciarLeitura.mockResolvedValue({ ok: false, erro: 'sem_arquivos' })
    expect(await A.lerArquivosAction(ID)).toEqual({ ok: false, formError: 'Envie ao menos um arquivo antes de ler.' })
  })
  it('fila fora do ar: pede para tentar de novo; o novo clique reenfileira (a leitura já iniciada e ainda na fila)', async () => {
    iniciarLeitura.mockResolvedValueOnce({ ok: true, valor: null })
    enfileirar.mockRejectedValueOnce(new Error('down'))
    expect(await A.lerArquivosAction(ID)).toEqual({
      ok: false, formError: 'Recebemos os arquivos, mas não foi possível começar a leitura agora. Tente de novo em instantes.',
    })
    iniciarLeitura.mockResolvedValueOnce({ ok: false, erro: 'ja_iniciada' })
    lerImportacao.mockResolvedValueOnce({ id: ID, status: 'enviado', recebendo: false })
    expect(await A.lerArquivosAction(ID)).toEqual({ ok: true, data: { id: ID, existente: false } })
    expect(enfileirar).toHaveBeenCalledTimes(2)
    // já lendo ou em rascunho: só mostra o estado atual
    iniciarLeitura.mockResolvedValueOnce({ ok: false, erro: 'ja_iniciada' })
    lerImportacao.mockResolvedValueOnce({ id: ID, status: 'processando', recebendo: false })
    expect(await A.lerArquivosAction(ID)).toEqual({ ok: true, data: { id: ID, existente: false } })
    expect(enfileirar).toHaveBeenCalledTimes(2)
  })
})

describe('aplicarImportacaoAction (Zod pelo alvo)', () => {
  const informacoes = { fatos: [{ tema: 'Estacionamento', texto: 'Temos estacionamento.', exemplos: [], unidade: null, incluir: true }] }
  const horarios = {
    unidades: [{ unidade: 'Centro', semana: [{ dia: 1, turnos: [{ abre: '11:00', fecha: '15:00' }], conflito: false }], excecoes: [], incluir: true }],
  }
  const espacos = { espacos: [{ nome: 'Salão', unidade: 'Centro', capacidadeMin: 10, capacidadeMax: 40, descricao: null, condicoes: null, incluir: true }] }
  const soPrecos = { itens: [{ nome: 'Picanha', categoria: null, precoCentavos: 9990, incluir: true }] }
  const cardapio = {
    categorias: [{ nome: 'Carnes', itens: [{ nome: 'Picanha', descricao: null, precoCentavos: 8990, precoConflito: [8990, 9490], tags: [], outrosNomes: [], unidade: null, incluir: true }] }],
  }

  it.each([
    ['informacoes', 'completo', informacoes],
    ['horarios', 'completo', horarios],
    ['espacos', 'completo', espacos],
    ['cardapio', 'so_precos', soPrecos],
    ['cardapio', 'completo', cardapio],
  ] as const)('%s/%s válido chega ao banco e devolve as contagens', async (alvo, modo, rascunho) => {
    aplicarImportacao.mockResolvedValue({ ok: true, valor: { criados: 1, atualizados: 2, ignorados: 3 } })
    expect(await A.aplicarImportacaoAction(ID, { alvo, modo, rascunho })).toEqual({ ok: true, data: { criados: 1, atualizados: 2, ignorados: 3 } })
    expect(aplicarImportacao).toHaveBeenCalledWith('db', { sub: 'u' }, ID, expect.objectContaining(rascunho))
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })

  it('rascunho fora do schema do alvo não chega ao banco', async () => {
    const ruins = [
      { alvo: 'horarios', modo: 'completo', rascunho: { unidades: [{ ...horarios.unidades[0]!, semana: [{ dia: 1, turnos: [{ abre: '11:00', fecha: '11:00' }] }] }] } },
      { alvo: 'espacos', modo: 'completo', rascunho: { espacos: [{ ...espacos.espacos[0]!, capacidadeMin: 50, capacidadeMax: 10 }] } },
      { alvo: 'informacoes', modo: 'completo', rascunho: { fatos: [{ ...informacoes.fatos[0]!, texto: '' }] } },
      { alvo: 'cardapio', modo: 'so_precos', rascunho: { itens: [{ ...soPrecos.itens[0]!, precoCentavos: -5 }] } },
      // rascunho de outro alvo
      { alvo: 'horarios', modo: 'completo', rascunho: informacoes },
      { alvo: 'espacos', modo: 'so_precos', rascunho: espacos },
    ] as const
    for (const r of ruins) {
      expect(await A.aplicarImportacaoAction(ID, r as never)).toEqual({ ok: false, formError: 'Algum dado está inválido. Confira e tente de novo.' })
    }
    expect(await A.aplicarImportacaoAction('x', { alvo: 'espacos', modo: 'completo', rascunho: espacos })).toMatchObject({ ok: false })
    expect(aplicarImportacao).not.toHaveBeenCalled()
  })

  it('erros do banco viram mensagens (unidade não escolhida, já aplicada, permissão)', async () => {
    const casos = [
      ['unidade_nao_escolhida', 'Escolha a unidade de cada horário ou espaço marcado (ou deixe-o de fora) antes de confirmar.'],
      ['ja_aplicado', 'Essa importação já foi aplicada.'],
      ['rascunho_invalido', 'Algum dado está inválido. Confira e tente de novo.'],
      ['sem_permissao', 'Só o dono, ou gerente com acesso a todas as unidades, aplica a importação.'],
    ] as const
    for (const [erro, msg] of casos) {
      aplicarImportacao.mockResolvedValueOnce({ ok: false, erro })
      expect(await A.aplicarImportacaoAction(ID, { alvo: 'horarios', modo: 'completo', rascunho: horarios })).toEqual({ ok: false, formError: msg })
    }
  })
})
