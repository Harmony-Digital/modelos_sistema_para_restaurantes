import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PedidoTitular, ResumoTitular, RetencaoPainel } from '@atd/db'

const toastOk = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: toastOk, error: toastErro } }))

const { FilaPrivacidade, PrazosRetencao } = await import('./privacidade')
const { CartaoPrazoLgpd } = await import('@/components/home/cartao-prazo-lgpd')

const DIA = 86_400_000
const agora = new Date('2026-10-06T15:00:00Z')
const A = '00000000-0000-4000-8000-0000000000aa'
const E = '00000000-0000-4000-8000-0000000000ee'
const pedido = (over: Partial<PedidoTitular> = {}): PedidoTitular => ({
  id: A, tipo: 'acesso', status: 'aberto', prazo: new Date(agora.getTime() + 2 * DIA), criadoEm: new Date('2026-09-23T12:00:00Z'),
  temCliente: true, resposta: null, resolvidoPor: null, ...over,
})
const resumo: ResumoTitular = {
  pedidoId: A, nomePerfil: 'Ana', primeiraInteracao: '2026-09-01T12:00:00Z', ultimaInteracao: '2026-10-05T18:00:00Z', conversas: 2,
  mensagens: 10, avisos: [], eventos: [], pedidos: [],
}
const acoes = {
  gerarResumo: vi.fn(), revelarTelefone: vi.fn(), concluirAcesso: vi.fn(), excluir: vi.fn(), negar: vi.fn(), concluirCorrecao: vi.fn(),
}
const renderFila = (pedidos: PedidoTitular[]) =>
  render(<FilaPrivacidade pedidos={pedidos} agora={agora} timeZone="America/Sao_Paulo" acoes={acoes} />)

beforeEach(() => {
  vi.clearAllMocks()
  acoes.gerarResumo.mockResolvedValue({ ok: true, data: resumo })
  acoes.concluirAcesso.mockResolvedValue({ ok: true, data: null })
  acoes.excluir.mockResolvedValue({ ok: true, data: { contagens: { mensagens: 10, conversas: 2, avisos: 1, eventos: 0 } } })
  acoes.negar.mockResolvedValue({ ok: true, data: null })
  acoes.concluirCorrecao.mockResolvedValue({ ok: true, data: null })
})

describe('FilaPrivacidade', () => {
  it('lista tipo, status e prazo; destaca perto do prazo e vencido', () => {
    renderFila([pedido(), pedido({ id: E, tipo: 'exclusao', prazo: new Date(agora.getTime() - 2.5 * DIA) })])
    const itens = screen.getAllByRole('listitem')
    expect(itens[0]).toHaveTextContent('Acesso aos dados')
    expect(itens[0]).toHaveTextContent('Aberto')
    expect(itens[0]).toHaveTextContent('Faltam 2 dias')
    expect(itens[1]).toHaveTextContent('Exclusão dos dados')
    expect(itens[1]).toHaveTextContent('Prazo vencido há 2 dias')
  })

  it('sem pedidos em aberto: mensagem', () => {
    renderFila([pedido({ status: 'concluido' })])
    expect(screen.getByText('Nenhum pedido em aberto.')).toBeInTheDocument()
    expect(screen.getByText(/Resolvidos \(1\)/)).toBeInTheDocument()
  })

  it('acesso: gera o resumo sem telefone; copia, baixa .txt e conclui', async () => {
    const user = userEvent.setup()
    const criar = vi.fn(() => 'blob:x')
    const revogar = vi.fn()
    Object.assign(URL, { createObjectURL: criar, revokeObjectURL: revogar })
    renderFila([pedido()])
    await user.click(screen.getByRole('button', { name: 'Gerar resumo' }))
    const folha = await screen.findByRole('dialog')
    expect(acoes.gerarResumo).toHaveBeenCalledWith(A)
    expect(within(folha).getByText(/Nome no WhatsApp: Ana/)).toBeInTheDocument()
    expect(acoes.revelarTelefone).not.toHaveBeenCalled()

    await user.click(within(folha).getByRole('button', { name: 'Copiar' }))
    expect(await navigator.clipboard.readText()).toContain('Nome no WhatsApp: Ana')
    expect(toastOk).toHaveBeenCalledWith('Resumo copiado.')

    await user.click(within(folha).getByRole('button', { name: 'Baixar .txt' }))
    expect(criar).toHaveBeenCalledTimes(1)
    expect(revogar).toHaveBeenCalledWith('blob:x')

    await user.click(within(folha).getByRole('button', { name: 'Marcar como concluído' }))
    expect(acoes.concluirAcesso).toHaveBeenCalledWith(A)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('telefone só depois do clique (cada consulta é registrada)', async () => {
    const user = userEvent.setup()
    acoes.revelarTelefone.mockResolvedValue({ ok: true, data: { telefone: '+5561999990000' } })
    renderFila([pedido()])
    await user.click(screen.getByRole('button', { name: 'Gerar resumo' }))
    const folha = await screen.findByRole('dialog')
    expect(folha).not.toHaveTextContent('5561999990000')
    expect(within(folha).getByText('Cada consulta ao telefone fica registrada.')).toBeInTheDocument()
    await user.click(within(folha).getByRole('button', { name: 'Mostrar telefone' }))
    expect(await within(folha).findByText('+5561999990000')).toBeInTheDocument()
    expect(acoes.revelarTelefone).toHaveBeenCalledWith(A)
  })

  it('falha ao gerar o resumo vira aviso, sem abrir a folha', async () => {
    const user = userEvent.setup()
    acoes.gerarResumo.mockResolvedValue({ ok: false, formError: 'Não há dados desse cliente para resumir.' })
    renderFila([pedido()])
    await user.click(screen.getByRole('button', { name: 'Gerar resumo' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Não há dados desse cliente para resumir.'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('exclusão: explica o que some, só habilita depois de digitar EXCLUIR e mostra as contagens', async () => {
    const user = userEvent.setup()
    renderFila([pedido({ id: E, tipo: 'exclusao' })])
    expect(screen.queryByRole('button', { name: 'Gerar resumo' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir dados' }))
    const dialogo = await screen.findByRole('dialog')
    expect(dialogo).toHaveTextContent('apagadas')
    expect(dialogo).toHaveTextContent('anonimizados')
    expect(dialogo).toHaveTextContent('não pode ser desfeita')
    const confirmar = within(dialogo).getByRole('button', { name: 'Excluir definitivamente' })
    expect(confirmar).toBeDisabled()
    const campo = within(dialogo).getByLabelText('Para confirmar, digite EXCLUIR')
    await user.type(campo, 'exclui')
    expect(confirmar).toBeDisabled()
    expect(acoes.excluir).not.toHaveBeenCalled()
    await user.type(campo, 'r')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)
    expect(acoes.excluir).toHaveBeenCalledWith(E, 'excluir')
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith('Dados excluídos: 10 mensagens, 2 conversas, 1 aviso e 0 pedidos de evento.'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('exclusão recusada pelo servidor mantém o diálogo com o erro', async () => {
    const user = userEvent.setup()
    acoes.excluir.mockResolvedValue({ ok: false, formError: 'Esse pedido já foi resolvido ou não aceita essa ação.' })
    renderFila([pedido({ id: E, tipo: 'exclusao' })])
    await user.click(screen.getByRole('button', { name: 'Excluir dados' }))
    const dialogo = await screen.findByRole('dialog')
    await user.type(within(dialogo).getByLabelText('Para confirmar, digite EXCLUIR'), 'EXCLUIR')
    await user.click(within(dialogo).getByRole('button', { name: 'Excluir definitivamente' }))
    expect(await within(dialogo).findByText('Esse pedido já foi resolvido ou não aceita essa ação.')).toBeInTheDocument()
  })

  it('negar: resposta obrigatória e curta', async () => {
    const user = userEvent.setup()
    renderFila([pedido({ tipo: 'correcao' })])
    await user.click(screen.getByRole('button', { name: 'Negar' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Negar pedido' }))
    expect(await within(dialogo).findByText('Escreva o motivo em poucas palavras')).toBeInTheDocument()
    expect(acoes.negar).not.toHaveBeenCalled()
    await user.type(within(dialogo).getByLabelText('Resposta ao cliente'), 'Pedido em duplicidade.')
    await user.click(within(dialogo).getByRole('button', { name: 'Negar pedido' }))
    await waitFor(() => expect(acoes.negar).toHaveBeenCalledWith(A, { resposta: 'Pedido em duplicidade.' }))
  })

  it('correção: "Concluir correção" exige resposta curta e chama a ação; acesso não mostra o botão', async () => {
    const user = userEvent.setup()
    const { unmount } = renderFila([pedido()])
    expect(screen.queryByRole('button', { name: 'Concluir correção' })).toBeNull()
    unmount()
    renderFila([pedido({ tipo: 'correcao' })])
    await user.click(screen.getByRole('button', { name: 'Concluir correção' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Concluir correção' }))
    expect(await within(dialogo).findByText('Diga o que foi corrigido em poucas palavras')).toBeInTheDocument()
    expect(acoes.concluirCorrecao).not.toHaveBeenCalled()
    await user.type(within(dialogo).getByLabelText('Resposta ao cliente'), 'Nome corrigido.')
    await user.click(within(dialogo).getByRole('button', { name: 'Concluir correção' }))
    await waitFor(() => expect(acoes.concluirCorrecao).toHaveBeenCalledWith(A, { resposta: 'Nome corrigido.' }))
  })

  it('pedido resolvido não tem ações', () => {
    renderFila([pedido({ status: 'negado', resposta: 'Duplicado.' })])
    expect(screen.queryByRole('button', { name: 'Gerar resumo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Negar' })).not.toBeInTheDocument()
  })
})

describe('PrazosRetencao', () => {
  const itens: RetencaoPainel[] = [
    { dado: 'messages', dias: 90, acao: 'apagar', minimo: 7 },
    { dado: 'attendance_notices', dias: 365, acao: 'anonimizar', minimo: 30 },
  ]
  const acao = vi.fn()

  it('dono: valida o mínimo e salva', async () => {
    const user = userEvent.setup()
    acao.mockResolvedValue({ ok: true, data: null })
    render(<PrazosRetencao itens={itens} acao={acao} />)
    const campo = screen.getByLabelText('Mensagens das conversas (dias)')
    await user.clear(campo)
    await user.type(campo, '5')
    await user.click(screen.getAllByRole('button', { name: 'Salvar' })[0]!)
    expect(await screen.findByText('O mínimo é 7 dias.')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
    await user.clear(campo)
    await user.type(campo, '30')
    await user.click(screen.getAllByRole('button', { name: 'Salvar' })[0]!)
    await waitFor(() => expect(acao).toHaveBeenCalledWith({ dado: 'messages', dias: 30 }))
    expect(toastOk).toHaveBeenCalledWith('Prazo salvo.')
  })

  it('gerente: só leitura', () => {
    render(<PrazosRetencao itens={itens} acao={acao} somenteLeitura />)
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByText('90 dias')).toBeInTheDocument()
    expect(screen.getByText(/Só o dono altera/)).toBeInTheDocument()
  })
})

describe('CartaoPrazoLgpd', () => {
  it('nada perto do prazo: não aparece', () => {
    const { container } = render(<CartaoPrazoLgpd pedidos={[pedido({ prazo: new Date(agora.getTime() + 10 * DIA) })]} agora={agora} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('conta vencidos e perto do prazo e leva à Privacidade', () => {
    render(<CartaoPrazoLgpd pedidos={[pedido(), pedido({ prazo: new Date(agora.getTime() - DIA) }), pedido({ status: 'concluido' })]} agora={agora} />)
    const cartao = screen.getByRole('region', { name: 'Pedidos de privacidade (LGPD)' })
    expect(cartao).toHaveTextContent('1 pedido vencido')
    expect(cartao).toHaveTextContent('1 pedido vence em até 3 dias')
    expect(within(cartao).getByRole('link', { name: 'Ver pedidos' })).toHaveAttribute('href', '/mais/privacidade')
  })
})
