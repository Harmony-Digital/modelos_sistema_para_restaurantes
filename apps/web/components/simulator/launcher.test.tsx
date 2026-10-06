import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MensagemTela, RespostaSimulador } from '@/lib/simulador-tela'
let caminho = '/'
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof Navegacao>()), usePathname: () => caminho }))
const { SimulatorLauncher } = await import('./launcher')
import type { AcoesSimulador } from './use-simulador'
import type * as Navegacao from 'next/navigation'

const CONV = '00000000-0000-4000-8000-000000000001'
const resp = (mensagens: MensagemTela[] = [], extra: Partial<RespostaSimulador> = {}): RespostaSimulador =>
  ({ conversationId: CONV, mensagens, cursor: mensagens.at(-1)?.id ?? 0, digitando: false, estado: 'ia', relogioOffsetSegundos: null, limiteSimulacao: false, ...extra })
const msg = (id: number, direcao: 'in' | 'out', texto: string): MensagemTela =>
  ({ id, direcao, tipo: 'texto', texto, payload: null, criadaEm: '2026-10-05T17:00:00.000Z' })

function acoesFalsas(over: Partial<AcoesSimulador> = {}): AcoesSimulador {
  return {
    abrir: vi.fn(async () => ({ ok: true as const, data: resp() })),
    buscar: vi.fn(async () => ({ ok: true as const, data: resp() })),
    enviar: vi.fn(async () => ({ ok: true as const })),
    novoCliente: vi.fn(async () => ({ ok: true as const, data: resp([], { conversationId: '00000000-0000-4000-8000-000000000002' }) })),
    relogio: vi.fn(async () => ({ ok: true as const, data: { relogioOffsetSegundos: null } })),
    detalhes: vi.fn(async () => ({ ok: true as const, data: [] })),
    ...over,
  }
}

async function abrir(acoes: AcoesSimulador) {
  const user = userEvent.setup()
  render(<SimulatorLauncher restaurante="Casa Teste" timezone="America/Sao_Paulo" acoes={acoes} />)
  await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
  await screen.findByRole('dialog', { name: 'Simulador de WhatsApp' }, { timeout: 5000 })
  return user
}

describe('SimulatorLauncher', () => {
  // O diálogo vem por next/dynamic; pré-carregar o chunk evita que a 1ª importação no jsdom estoure o tempo sob carga.
  beforeAll(async () => {
    await import('./simulator-dialog')
  })

  it('mostra o aviso de limite de simulação com link para Gastos e limites; some quando a flag cai', async () => {
    let limite = true
    const acoes = acoesFalsas({ abrir: vi.fn(async () => ({ ok: true as const, data: resp([msg(1, 'in', 'oi')], { limiteSimulacao: limite }) })), buscar: vi.fn(async () => ({ ok: true as const, data: resp([], { limiteSimulacao: limite }) })) })
    await abrir(acoes)
    const link = await screen.findByRole('link', { name: 'Gastos e limites' })
    expect(link).toHaveAttribute('href', '/mais/gastos')
    expect(link.parentElement).toHaveTextContent('Limite de simulação atingido hoje — ajuste em Gastos e limites')
    limite = false
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Gastos e limites' })).toBeNull(), { timeout: 4000 })
  })

  it('o link do aviso tem alvo de toque de 44 px e navegar fecha o simulador', async () => {
    caminho = '/'
    const acoes = acoesFalsas({ abrir: vi.fn(async () => ({ ok: true as const, data: resp([msg(1, 'in', 'oi')], { limiteSimulacao: true }) })), buscar: vi.fn(async () => ({ ok: true as const, data: resp([], { limiteSimulacao: true }) })) })
    const user = userEvent.setup()
    const { rerender } = render(<SimulatorLauncher restaurante="Casa Teste" timezone="America/Sao_Paulo" acoes={acoes} />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    const link = await screen.findByRole('link', { name: 'Gastos e limites' }, { timeout: 5000 })
    expect(link.className).toContain('min-h-11')
    caminho = '/mais/gastos'
    rerender(<SimulatorLauncher restaurante="Casa Teste" timezone="America/Sao_Paulo" acoes={acoes} />)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull())
  })

  it('abre com foco no campo de mensagem, avisa que é simulação e fecha com Esc', async () => {
    const acoes = acoesFalsas()
    const user = await abrir(acoes)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus())
    expect(within(screen.getByRole('log')).getByText(/nunca são enviadas pelo WhatsApp/)).toBeInTheDocument()
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalledTimes(1))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveFocus())
  })

  it('mensagem vai ao servidor e a resposta gravada pelo pipeline aparece no polling', async () => {
    let n = 0
    const acoes = acoesFalsas({
      buscar: vi.fn(async () => ({ ok: true as const, data: n++ < 1 ? resp() : resp([msg(1, 'in', 'abre domingo?'), msg(2, 'out', 'Domingo (11/10), a unidade Asa Sul abre das 11h30 às 16h.')]) })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'abre domingo?{Enter}')
    expect(acoes.enviar).toHaveBeenCalledWith(CONV, 'abre domingo?', null)
    expect(await screen.findByText(/abre das 11h30 às 16h/, undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(within(screen.getByRole('log')).getAllByText('abre domingo?')).toHaveLength(1) // balão "enviando" substituído
  })

  it('erro ao enviar aparece e o balão provisório some', async () => {
    const acoes = acoesFalsas({
      enviar: vi.fn(async () => ({ ok: false as const, formError: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.' })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'oi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta conversa foi encerrada')
    expect(within(screen.getByRole('log')).queryByText('oi')).toBeNull()
    // o polling (1 s) não apaga o erro da ação
    await new Promise((r) => setTimeout(r, 1600))
    expect(screen.getByRole('alert')).toHaveTextContent('Esta conversa foi encerrada')
  })

  it('Novo cliente recomeça a conversa', async () => {
    const acoes = acoesFalsas({ abrir: vi.fn(async () => ({ ok: true as const, data: resp([msg(1, 'in', 'conversa antiga')]) })) })
    const user = await abrir(acoes)
    expect(await screen.findByText('conversa antiga')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await waitFor(() => expect(screen.queryByText('conversa antiga')).toBeNull())
    expect(acoes.novoCliente).toHaveBeenCalledTimes(1)
  })

  it('mensagem enviada logo após "Novo cliente" vai para a conversa nova', async () => {
    const NOVA = '00000000-0000-4000-8000-000000000002'
    let liberar!: () => void
    const acoes = acoesFalsas({
      novoCliente: vi.fn(() => new Promise<{ ok: true; data: RespostaSimulador }>((res) => {
        liberar = () => res({ ok: true, data: resp([], { conversationId: NOVA }) })
      })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'oi{Enter}')
    expect(acoes.enviar).not.toHaveBeenCalled()
    liberar()
    await waitFor(() => expect(acoes.enviar).toHaveBeenCalledWith(NOVA, 'oi', null))
    expect(acoes.enviar).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('polling pausa com a aba escondida e volta quando ela fica visível', async () => {
    const acoes = acoesFalsas()
    await abrir(acoes)
    await waitFor(() => expect(acoes.buscar).toHaveBeenCalled())
    const escondida = (v: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    try {
      escondida(true)
      await new Promise((r) => setTimeout(r, 50))
      const antes = vi.mocked(acoes.buscar).mock.calls.length
      await new Promise((r) => setTimeout(r, 1600))
      expect(acoes.buscar).toHaveBeenCalledTimes(antes)
      escondida(false)
      await waitFor(() => expect(vi.mocked(acoes.buscar).mock.calls.length).toBeGreaterThan(antes))
    } finally {
      // volta ao getter do protótipo
      delete (document as { hidden?: boolean }).hidden
    }
  })

  it('Simular data e hora aplica e volta ao relógio real', async () => {
    const acoes = acoesFalsas()
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Simular data e hora' }))
    const campo = screen.getByLabelText('Data e hora simuladas')
    await user.clear(campo)
    await user.type(campo, '2026-10-11T12:00')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(acoes.relogio).toHaveBeenCalledWith(CONV, '2026-10-11T12:00')
    // aplicar fecha o painel: reabrir para voltar ao relógio real
    await user.click(screen.getByRole('button', { name: 'Simular data e hora' }))
    await user.click(screen.getByRole('button', { name: 'Usar relógio real' }))
    expect(acoes.relogio).toHaveBeenLastCalledWith(CONV, null)
  })

  it('Ver detalhes lista as chamadas da IA desta conversa', async () => {
    const acoes = acoesFalsas({
      detalhes: vi.fn(async () => ({
        ok: true as const,
        data: [{ id: 1, etapa: 'triagem', modelo: 'fake/m', promptVersion: 'triage-v2', intent: 'horario_unidades:aberto_agora', resultado: 'ok', erro: null, costUsd: '0.000100', latenciaMs: 812, itensValidos: 2, itensRespondidos: 1, criadaEm: '2026-10-05T17:00:00.000Z' }],
      })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da IA' })
    expect(await within(painel).findByText(/horario_unidades:aberto_agora/)).toBeInTheDocument()
    expect(within(painel).getByText(/US\$ 0,000100/)).toBeInTheDocument()
    expect(within(painel).getByText(/812 ms/)).toBeInTheDocument()
    expect(within(painel).getByText('Respondeu 1 de 2 perguntas com dado cadastrado')).toBeInTheDocument()
  })

  it('Ver detalhes com falha mostra a mensagem e deixa tentar de novo', async () => {
    const acoes = acoesFalsas({ detalhes: vi.fn(async () => ({ ok: false as const, formError: 'x' })) })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da IA' })
    expect(await within(painel).findByText('Não foi possível carregar os detalhes.')).toBeInTheDocument()
    await user.click(within(painel).getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(acoes.detalhes).toHaveBeenCalledTimes(2))
  })
})
