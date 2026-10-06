import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const acoes = {
  importarCsvAction: vi.fn(),
  importarArquivoAction: vi.fn(),
  estadoImportacaoAction: vi.fn(),
  aplicarRascunhoAction: vi.fn(),
  descartarImportacaoAction: vi.fn(),
}
const push = vi.fn()
const refresh = vi.fn()
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/app/(painel)/conteudo/importar-actions', () => acoes)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('sonner', () => ({ toast }))
const { Importar, AcompanharImportacao } = await import('./importar')

const ID = '00000000-0000-4000-8000-000000000011'
const URL_IMP = `/conteudo?aba=cardapio&sub=importar&imp=${ID}`

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('Importar', () => {
  it('CSV com erros por linha: mostra os erros e não abre a revisão', async () => {
    const user = userEvent.setup()
    acoes.importarCsvAction.mockResolvedValue({ ok: true, data: { id: null, erros: ['Linha 2: preço inválido.', 'Linha 5: nome vazio.'] } })
    render(<Importar importacoes={[]} />)
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
    render(<Importar importacoes={[]} />)
    await user.upload(screen.getByLabelText(/^Planilha CSV/), new File(['x'], 'c.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: 'Ler planilha' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(URL_IMP))
    expect(screen.getByRole('link', { name: /Baixar o modelo de planilha/ })).toHaveAttribute('href', '/modelo-cardapio.csv')
  })

  it('upload falso recusado: a mensagem do servidor aparece no campo', async () => {
    const user = userEvent.setup()
    acoes.importarArquivoAction.mockResolvedValue({ ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' } })
    render(<Importar importacoes={[]} />)
    await user.upload(screen.getByLabelText(/^PDF ou foto/), new File(['MZ'], 'cardapio.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Enviar para leitura' }))
    expect(await screen.findByText('Envie um PDF ou uma imagem (JPEG, PNG ou WebP).')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('PDF enviado vai ao acompanhamento; arquivo já importado avisa e leva ao estado atual', async () => {
    const user = userEvent.setup()
    acoes.importarArquivoAction.mockResolvedValueOnce({ ok: true, data: { id: ID, status: 'enviado' } })
    render(<Importar importacoes={[]} />)
    const campo = screen.getByLabelText(/^PDF ou foto/)
    await user.upload(campo, new File(['%PDF'], 'c.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Enviar para leitura' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(URL_IMP))
    expect(toast.info).not.toHaveBeenCalled()
    acoes.importarArquivoAction.mockResolvedValueOnce({ ok: true, data: { id: ID, status: 'aprovado' } })
    await user.upload(campo, new File(['%PDF'], 'c.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Enviar para leitura' }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Esse arquivo já tinha sido enviado. Mostrando a importação dele.'))
  })

  it('lista as importações recentes com status', () => {
    render(
      <Importar
        importacoes={[
          { id: ID, origem: 'arquivo', mime: 'application/pdf', status: 'rascunho', criadoEm: '2026-10-05T15:00:00.000Z' },
          { id: 'b', origem: 'csv', mime: 'text/csv', status: 'rejeitado', criadoEm: '2026-10-04T15:00:00.000Z' },
        ]}
      />,
    )
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
    render(<AcompanharImportacao id={ID} status="enviado" erro={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lendo o cardápio…')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(acoes.estadoImportacaoAction).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('erro mostra a mensagem amigável e não consulta', async () => {
    vi.useFakeTimers()
    render(<AcompanharImportacao id={ID} status="erro" erro="Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV." />)
    expect(screen.getByRole('alert')).toHaveTextContent('Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV.')
    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(acoes.estadoImportacaoAction).not.toHaveBeenCalled()
  })
})
