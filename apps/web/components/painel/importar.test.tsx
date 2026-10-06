import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const acoes = {
  importarCsvAction: vi.fn(),
  estadoImportacaoAction: vi.fn(),
  aplicarRascunhoAction: vi.fn(),
  descartarImportacaoAction: vi.fn(),
}
const push = vi.fn()
const refresh = vi.fn()
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
const acoesAlvo = { lerArquivosAction: vi.fn() }
vi.mock('@/app/(painel)/conteudo/importar-actions', () => acoes)
vi.mock('@/app/(painel)/conteudo/importar-alvo-actions', () => acoesAlvo)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('sonner', () => ({ toast }))
const { ImportarCsv, HistoricoImportacoes, AcompanharImportacao } = await import('./importar')

const ID = '00000000-0000-4000-8000-000000000011'
const URL_IMP = `/conteudo?aba=importar&imp=${ID}`

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('ImportarCsv e histórico', () => {
  it('CSV com erros por linha: mostra os erros e não abre a revisão', async () => {
    const user = userEvent.setup()
    acoes.importarCsvAction.mockResolvedValue({ ok: true, data: { id: null, erros: ['Linha 2: preço inválido.', 'Linha 5: nome vazio.'] } })
    render(<ImportarCsv />)
    await user.upload(screen.getByLabelText(/^Planilha CSV/), new File(['x'], 'c.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Ler planilha' }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('A planilha tem 2 erros. Corrija e envie de novo.')
    expect(alerta).toHaveTextContent('Linha 2: preço inválido.')
    expect(alerta).toHaveTextContent('Linha 5: nome vazio.')
    expect(push).not.toHaveBeenCalled()
  })

  it('CSV válido abre a revisão da importação', async () => {
    const user = userEvent.setup()
    acoes.importarCsvAction.mockResolvedValue({ ok: true, data: { id: ID, erros: [] } })
    render(<ImportarCsv />)
    await user.upload(screen.getByLabelText(/^Planilha CSV/), new File(['x'], 'c.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Ler planilha' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(URL_IMP))
    expect(screen.getByRole('link', { name: /Baixar o modelo de planilha/ })).toHaveAttribute('href', '/modelo-cardapio.csv')
  })

  it('lista as importações recentes com status', () => {
    render(
      <HistoricoImportacoes
        vazio="Nenhuma importação ainda."
        importacoes={[
          { id: ID, origem: 'arquivo', modo: 'completo', mime: 'application/pdf', arquivos: 1, status: 'rascunho', recebendo: false, criadoEm: '2026-10-05T15:00:00.000Z' },
          { id: 'b', origem: 'csv', modo: 'completo', mime: 'text/csv', arquivos: 0, status: 'rejeitado', recebendo: false, criadoEm: '2026-10-04T15:00:00.000Z' },
          { id: 'c', origem: 'arquivo', modo: 'so_precos', mime: 'image/jpeg', arquivos: 4, status: 'processando', recebendo: false, criadoEm: '2026-10-03T15:00:00.000Z' },
        ]}
      />,
    )
    expect(screen.getByText('4 arquivos · só preços')).toBeInTheDocument()
    expect(screen.getByText('Para revisar')).toBeInTheDocument()
    expect(screen.getByText('Descartada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir: PDF de 05\/10/ })).toHaveAttribute('href', URL_IMP)
  })
})

describe('AcompanharImportacao', () => {
  it('"Lendo o cardápio…" consulta a cada 3 s e atualiza a tela quando termina', async () => {
    vi.useFakeTimers()
    acoes.estadoImportacaoAction.mockResolvedValueOnce({ ok: true, data: { status: 'processando', erro: null } })
    acoes.estadoImportacaoAction.mockResolvedValueOnce({ ok: true, data: { status: 'rascunho', erro: null } })
    render(<AcompanharImportacao id={ID} status="enviado" erro={null} desde={new Date().toISOString()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lendo o cardápio…')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('action com erro: para de consultar e mostra a mensagem', async () => {
    vi.useFakeTimers()
    acoes.estadoImportacaoAction.mockResolvedValue({ ok: false, formError: 'Não encontramos essa importação.' })
    render(<AcompanharImportacao id={ID} status="processando" erro={null} desde={new Date().toISOString()} />)
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByRole('alert')).toHaveTextContent('Não encontramos essa importação.')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Lendo o cardápio…')).not.toBeInTheDocument()
  })

  it('mais de 5 minutos lendo: avisa e para de consultar', async () => {
    vi.useFakeTimers()
    acoes.estadoImportacaoAction.mockResolvedValue({ ok: true, data: { status: 'processando', erro: null } })
    render(<AcompanharImportacao id={ID} status="enviado" erro={null} desde={new Date(Date.now() - 4 * 60_000).toISOString()} />)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    const chamadas = acoes.estadoImportacaoAction.mock.calls.length
    expect(screen.getByRole('alert')).toHaveTextContent('A leitura está demorando. Tente enviar de novo.')
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(chamadas)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('já criada há mais de 5 minutos: avisa sem consultar', async () => {
    vi.useFakeTimers()
    render(<AcompanharImportacao id={ID} status="enviado" erro={null} desde={new Date(Date.now() - 6 * 60_000).toISOString()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('A leitura está demorando. Tente enviar de novo.')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(acoes.estadoImportacaoAction).not.toHaveBeenCalled()
  })

  it('importação com erro pode ser descartada (com confirmação)', async () => {
    const user = userEvent.setup()
    acoes.descartarImportacaoAction.mockResolvedValue({ ok: true, data: null })
    render(<AcompanharImportacao id={ID} status="erro" erro="Não consegui ler." desde={new Date().toISOString()} />)
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Descartar importação' }))
    await waitFor(() => expect(acoes.descartarImportacaoAction).toHaveBeenCalledWith(ID))
    expect(toast.success).toHaveBeenCalledWith('Importação descartada')
    expect(push).toHaveBeenCalledWith('/conteudo?aba=importar')
  })

  it('vários arquivos: "Lendo n de m"; o prazo (10 min) recomeça a cada mudança salva (lote ou metade de lote)', async () => {
    vi.useFakeTimers()
    const estado = (loteAtual: number, atualizadoEm: string) =>
      acoes.estadoImportacaoAction.mockResolvedValue({ ok: true, data: { status: 'processando', erro: null, loteAtual, lotesTotal: 4, atualizadoEm } })
    estado(1, 'a')
    // criada há muito tempo (os arquivos foram enviados devagar): não conta da criação
    render(
      <AcompanharImportacao id={ID} status="enviado" erro={null} desde={new Date(Date.now() - 60 * 60_000).toISOString()} titulo="Lendo os arquivos…" lotes={{ atual: 0, total: null }} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Lendo os arquivos…')
    expect(screen.queryByText(/Lendo \d de/)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByRole('status')).toHaveTextContent('Lendo 2 de 4')
    // 9 min no mesmo lote (lote cortado lido em metades, retomada de um leitor morto): segue esperando
    await act(() => vi.advanceTimersByTimeAsync(9 * 60_000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // a metade do lote foi salva (muda a importação, não o lote): o prazo recomeça
    estado(1, 'b')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    await act(() => vi.advanceTimersByTimeAsync(9 * 60_000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Lendo 2 de 4')
    // mais de 10 min sem nenhuma mudança: oferece continuar de onde parou
    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000))
    expect(screen.getByRole('alert')).toHaveTextContent('A leitura não avança há alguns minutos.')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('vários arquivos parados: "Tentar de novo" reenfileira e volta a acompanhar; falha mostra a mensagem', async () => {
    vi.useFakeTimers()
    acoes.estadoImportacaoAction.mockResolvedValue({ ok: true, data: { status: 'processando', erro: null, loteAtual: 1, lotesTotal: 3, atualizadoEm: 'a' } })
    acoesAlvo.lerArquivosAction.mockResolvedValueOnce({ ok: false, formError: 'Recebemos os arquivos, mas não foi possível começar a leitura agora. Tente de novo em instantes.' })
    acoesAlvo.lerArquivosAction.mockResolvedValueOnce({ ok: true, data: { id: ID, existente: false } })
    render(<AcompanharImportacao id={ID} status="processando" erro={null} desde={new Date().toISOString()} titulo="Lendo os arquivos…" lotes={{ atual: 1, total: 3 }} />)
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000 + 3000))
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText(/não foi possível começar a leitura agora/)).toBeInTheDocument()
    expect(acoesAlvo.lerArquivosAction).toHaveBeenCalledWith(ID)
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole('status')).toHaveTextContent('Lendo os arquivos…')
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    // volta a consultar
    const antes = acoes.estadoImportacaoAction.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(acoes.estadoImportacaoAction.mock.calls.length).toBe(antes + 1)
  })

  it('arquivo único (Etapa 05) não oferece "Tentar de novo"', () => {
    render(<AcompanharImportacao id={ID} status="enviado" erro={null} desde={new Date(Date.now() - 6 * 60_000).toISOString()} />)
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })

  it('lendo não oferece Descartar', () => {
    render(<AcompanharImportacao id={ID} status="processando" erro={null} desde={new Date().toISOString()} />)
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument()
  })

  it('erro mostra a mensagem amigável e não consulta', async () => {
    vi.useFakeTimers()
    render(<AcompanharImportacao id={ID} status="erro" erro="Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV." desde={new Date().toISOString()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV.')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(acoes.estadoImportacaoAction).not.toHaveBeenCalled()
  })
})
