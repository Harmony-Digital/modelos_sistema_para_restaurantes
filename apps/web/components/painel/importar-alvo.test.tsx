import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acoesAlvo = {
  novaImportacaoAction: vi.fn(),
  anexarArquivoAction: vi.fn(),
  removerArquivoAction: vi.fn(),
  lerArquivosAction: vi.fn(),
  aplicarImportacaoAction: vi.fn(),
}
const acoes = {
  importarCsvAction: vi.fn(),
  estadoImportacaoAction: vi.fn(),
  aplicarRascunhoAction: vi.fn(),
  descartarImportacaoAction: vi.fn(),
}
const push = vi.fn()
const refresh = vi.fn()
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/app/(painel)/conteudo/importar-alvo-actions', () => acoesAlvo)
vi.mock('@/app/(painel)/conteudo/importar-actions', () => acoes)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('sonner', () => ({ toast }))
const { ImportarAlvo, ArquivosImportacao } = await import('./importar-alvo')

const ID = '00000000-0000-4000-8000-000000000011'
const OUTRA = '00000000-0000-4000-8000-000000000012'
const URL_IMP = `/conteudo?aba=importar&imp=${ID}`
const pdf = (nome = 'cardapio.pdf') => new File(['%PDF'], nome, { type: 'application/pdf' })
const foto = (nome = 'foto.jpg') => new File(['x'], nome, { type: 'image/jpeg' })

beforeEach(() => vi.clearAllMocks())

describe('ImportarAlvo', () => {
  it('cardápio: escolhe o modo, cria a importação, envia um arquivo por requisição e abre a lista', async () => {
    const user = userEvent.setup()
    acoesAlvo.novaImportacaoAction.mockResolvedValue({ ok: true, data: { id: ID } })
    acoesAlvo.anexarArquivoAction.mockResolvedValueOnce({ ok: true, data: { ordem: 1 } }).mockResolvedValueOnce({ ok: true, data: { ordem: 2 } })
    render(<ImportarAlvo alvo="cardapio" importacoes={[]} />)
    await user.click(screen.getByRole('radio', { name: /Só preços/ }))
    await user.upload(screen.getByLabelText(/^Arquivos/), [pdf(), foto()])
    await user.click(screen.getByRole('button', { name: 'Enviar arquivos' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(URL_IMP))
    expect(acoesAlvo.novaImportacaoAction).toHaveBeenCalledWith({ alvo: 'cardapio', modo: 'so_precos' })
    expect(acoesAlvo.anexarArquivoAction).toHaveBeenCalledTimes(2)
    const [id, fd] = acoesAlvo.anexarArquivoAction.mock.calls[0]!
    expect(id).toBe(ID)
    expect((fd as FormData).get('arquivo')).toBeInstanceOf(File)
    expect(((acoesAlvo.anexarArquivoAction.mock.calls[1]![1] as FormData).get('arquivo') as File).name).toBe('foto.jpg')
    // a planilha CSV continua no cardápio
    expect(screen.getByLabelText(/^Planilha CSV/)).toBeInTheDocument()
  })

  it('outros alvos: sem modo e sem planilha', () => {
    render(<ImportarAlvo alvo="horarios" importacoes={[]} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Planilha CSV/)).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma importação de horários ainda.')).toBeInTheDocument()
  })

  it('gerente restrito a unidades: só a planilha CSV do cardápio, com aviso', () => {
    render(<ImportarAlvo alvo="cardapio" importacoes={[]} soPlanilha />)
    expect(screen.getByLabelText(/^Planilha CSV/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enviar arquivos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText(/PDF, fotos e os outros tipos de importação são do dono ou de gerente com acesso a todas as unidades/)).toBeInTheDocument()
  })

  it('mais de 10 arquivos ou arquivo grande demais: recusa antes de criar a importação', async () => {
    const user = userEvent.setup()
    render(<ImportarAlvo alvo="espacos" importacoes={[]} />)
    const campo = screen.getByLabelText(/^Arquivos/)
    await user.upload(campo, Array.from({ length: 11 }, (_, i) => foto(`f${i}.jpg`)))
    await user.click(screen.getByRole('button', { name: 'Enviar arquivos' }))
    expect(await screen.findByText('Escolha no máximo 10 arquivos.')).toBeInTheDocument()
    const grande = pdf('grande.pdf')
    Object.defineProperty(grande, 'size', { value: 50 * 1024 * 1024 })
    await user.upload(campo, [grande])
    await user.click(screen.getByRole('button', { name: 'Enviar arquivos' }))
    expect(await screen.findByText(/grande\.pdf: O arquivo passa de/)).toBeInTheDocument()
    expect(acoesAlvo.novaImportacaoAction).not.toHaveBeenCalled()
  })

  it('arquivo recusado pelo servidor: os outros seguem e o erro é avisado', async () => {
    const user = userEvent.setup()
    acoesAlvo.novaImportacaoAction.mockResolvedValue({ ok: true, data: { id: ID } })
    acoesAlvo.anexarArquivoAction
      .mockResolvedValueOnce({ ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' } })
      .mockResolvedValueOnce({ ok: true, data: { ordem: 1 } })
    render(<ImportarAlvo alvo="informacoes" importacoes={[]} />)
    await user.upload(screen.getByLabelText(/^Arquivos/), [pdf('falso.pdf'), foto()])
    await user.click(screen.getByRole('button', { name: 'Enviar arquivos' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(URL_IMP))
    expect(acoesAlvo.novaImportacaoAction).toHaveBeenCalledWith({ alvo: 'informacoes', modo: 'completo' })
    expect(toast.error).toHaveBeenCalledWith('falso.pdf: Envie um PDF ou uma imagem (JPEG, PNG ou WebP).')
  })

  it('histórico do alvo com status e quantidade de arquivos', () => {
    render(
      <ImportarAlvo
        alvo="horarios"
        importacoes={[
          { id: ID, origem: 'arquivo', modo: 'completo', mime: 'image/jpeg', arquivos: 3, status: 'enviado', recebendo: true, criadoEm: '2026-10-05T15:00:00.000Z' },
          { id: OUTRA, origem: 'arquivo', modo: 'completo', mime: 'application/pdf', arquivos: 1, status: 'rascunho', recebendo: false, criadoEm: '2026-10-04T15:00:00.000Z' },
        ]}
      />,
    )
    expect(screen.getByText('Recebendo arquivos')).toBeInTheDocument()
    expect(screen.getByText('Para revisar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir: 3 arquivos de 05\/10/ })).toHaveAttribute('href', URL_IMP)
    expect(screen.getByRole('link', { name: /Abrir: PDF de 04\/10/ })).toHaveAttribute('href', `/conteudo?aba=importar&imp=${OUTRA}`)
  })
})

describe('ArquivosImportacao', () => {
  const arquivos = [
    { ordem: 1, mime: 'application/pdf', tamanho: 2048 },
    { ordem: 2, mime: 'image/jpeg', tamanho: 1024 },
  ]

  it('lista os arquivos, remove (renumera) e adiciona mais', async () => {
    const user = userEvent.setup()
    acoesAlvo.removerArquivoAction.mockResolvedValue({ ok: true, data: null })
    acoesAlvo.anexarArquivoAction.mockResolvedValue({ ok: true, data: { ordem: 2 } })
    render(<ArquivosImportacao id={ID} alvo="cardapio" modo="completo" arquivos={arquivos} />)
    const lista = screen.getByRole('list', { name: 'Arquivos para ler' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remover Arquivo 1 (PDF)' }))
    await waitFor(() => expect(acoesAlvo.removerArquivoAction).toHaveBeenCalledWith(ID, 1))
    await waitFor(() => expect(within(lista).getAllByRole('listitem')).toHaveLength(1))
    // a foto subiu para a posição 1
    expect(screen.getByRole('button', { name: 'Remover Arquivo 1 (Foto)' })).toBeInTheDocument()
    await user.upload(screen.getByLabelText(/^Adicionar arquivos/), foto('mais.jpg'))
    await waitFor(() => expect(within(lista).getAllByRole('listitem')).toHaveLength(2))
    expect(within(lista).getByText('mais.jpg')).toBeInTheDocument()
  })

  it('"Ler arquivos" inicia a leitura e atualiza a tela; sem arquivos fica desabilitado', async () => {
    const user = userEvent.setup()
    acoesAlvo.lerArquivosAction.mockResolvedValue({ ok: true, data: { id: ID, existente: false } })
    const { rerender } = render(<ArquivosImportacao id={ID} alvo="espacos" modo="completo" arquivos={arquivos} />)
    await user.click(screen.getByRole('button', { name: 'Ler arquivos' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(acoesAlvo.lerArquivosAction).toHaveBeenCalledWith(ID)
    rerender(<ArquivosImportacao key="vazia" id={ID} alvo="espacos" modo="completo" arquivos={[]} />)
    expect(screen.getByRole('button', { name: 'Ler arquivos' })).toBeDisabled()
  })

  it('mesmos arquivos já importados: avisa e abre a importação existente', async () => {
    const user = userEvent.setup()
    acoesAlvo.lerArquivosAction.mockResolvedValue({ ok: true, data: { id: OUTRA, existente: true } })
    render(<ArquivosImportacao id={ID} alvo="espacos" modo="completo" arquivos={arquivos} />)
    await user.click(screen.getByRole('button', { name: 'Ler arquivos' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/conteudo?aba=importar&imp=${OUTRA}`))
    expect(toast.info).toHaveBeenCalledWith('Esses arquivos já foram importados. Mostrando a importação deles.')
  })

  it('limite de 10 arquivos ao adicionar', () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ ordem: i + 1, mime: 'image/jpeg', tamanho: 10 }))
    render(<ArquivosImportacao id={ID} alvo="espacos" modo="completo" arquivos={dez} />)
    expect(screen.getByLabelText(/^Adicionar arquivos/)).toBeDisabled()
    expect(screen.getByText('Limite de 10 arquivos atingido.')).toBeInTheDocument()
  })

  it('celular (360 px): nome longo quebra/corta dentro do cartão em vez de vazar', async () => {
    const user = userEvent.setup()
    acoesAlvo.anexarArquivoAction.mockResolvedValue({ ok: true, data: { ordem: 3 } })
    render(<ArquivosImportacao id={ID} alvo="cardapio" modo="completo" arquivos={arquivos} />)
    await user.upload(screen.getByLabelText(/^Adicionar arquivos/), foto(`${'cardapio-de-verao-'.repeat(8)}.jpg`))
    const nome = await screen.findByText(/cardapio-de-verao-cardapio/)
    expect(nome.className).toMatch(/truncate/)
    expect(nome.closest('li')!.className).toMatch(/min-w-0/)
    expect(nome.parentElement!.className).toMatch(/min-w-0/)
  })

  it('duplo clique em "Ler arquivos" chama uma vez', async () => {
    const user = userEvent.setup()
    let resolver: (v: unknown) => void = () => {}
    acoesAlvo.lerArquivosAction.mockReturnValue(new Promise((r) => { resolver = r }))
    render(<ArquivosImportacao id={ID} alvo="espacos" modo="completo" arquivos={arquivos} />)
    const botao = screen.getByRole('button', { name: 'Ler arquivos' })
    await user.dblClick(botao)
    resolver({ ok: true, data: { id: ID, existente: false } })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(acoesAlvo.lerArquivosAction).toHaveBeenCalledTimes(1)
  })

  it('descartar antes de ler: confirma e volta às importações do alvo', async () => {
    const user = userEvent.setup()
    acoes.descartarImportacaoAction.mockResolvedValue({ ok: true, data: null })
    render(<ArquivosImportacao id={ID} alvo="horarios" modo="completo" arquivos={arquivos} />)
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(acoes.descartarImportacaoAction).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Descartar importação' }))
    await waitFor(() => expect(acoes.descartarImportacaoAction).toHaveBeenCalledWith(ID))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/conteudo?aba=importar&alvo=horarios'))
    expect(toast.success).toHaveBeenCalledWith('Importação descartada')
  })
})
