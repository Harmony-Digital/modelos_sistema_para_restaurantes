import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionResult } from '@/lib/action-result'
import type { ResultadoBusca } from '@/lib/busca-rapida'

type Buscar = (t: string) => Promise<ActionResult<ResultadoBusca[]>>

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const abrirSimulador = vi.fn()
vi.mock('@/components/simulator/abrir', () => ({ abrirSimulador }))
const { BuscaRapida, abrirBusca } = await import('./busca-rapida')

const R = (tipo: ResultadoBusca['tipo'], id: string, titulo: string, extra: Partial<ResultadoBusca> = {}): ResultadoBusca =>
  ({ tipo, id, titulo, detalhe: null, simulada: false, ...extra })

function montar(buscar = vi.fn<Buscar>(async () => ({ ok: true, data: [] })), papel: 'dono' | 'atendente' = 'dono') {
  render(
    <div>
      <textarea aria-label="Resposta" />
      <BuscaRapida papel={papel} buscar={buscar} />
    </div>,
  )
  return buscar
}
const paleta = () => screen.queryByRole('dialog', { name: 'Busca rápida' })

describe('BuscaRapida', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Ctrl+K e Cmd+K abrem a paleta com foco no campo; Esc fecha', async () => {
    const user = userEvent.setup()
    montar()
    expect(paleta()).toBeNull()
    await user.keyboard('{Control>}k{/Control}')
    expect(paleta()).not.toBeNull()
    expect(screen.getByRole('combobox', { name: 'Buscar no painel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(paleta()).toBeNull())
    await user.keyboard('{Meta>}k{/Meta}')
    expect(paleta()).not.toBeNull()
  })

  it('Ctrl+K com o foco num campo de texto não abre (é do campo)', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(screen.getByRole('textbox', { name: 'Resposta' }))
    await user.keyboard('{Control>}k{/Control}')
    expect(paleta()).toBeNull()
  })

  it('o botão da barra (evento) abre; sem termo lista as telas do papel', async () => {
    montar(undefined, 'atendente')
    act(() => abrirBusca())
    const lista = await screen.findByRole('listbox')
    const nomes = within(lista).getAllByRole('option').map((o) => o.textContent)
    expect(nomes).toEqual(['Início', 'Conversas', 'Agenda', 'Conteúdo', 'Unidades', 'Ajustes'])
  })

  it('setas movem a opção ativa (com volta) e Enter navega para a tela', async () => {
    const user = userEvent.setup()
    montar()
    await user.keyboard('{Control>}k{/Control}')
    const campo = screen.getByRole('combobox', { name: 'Buscar no painel' })
    await user.type(campo, 'con')
    const opcoes = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(opcoes.map((o) => o.textContent)).toEqual(['Conversas', 'Conteúdo'])
    expect(campo).toHaveAttribute('aria-activedescendant', opcoes[0]!.id)
    expect(opcoes[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(campo).toHaveAttribute('aria-activedescendant', opcoes[1]!.id)
    await user.keyboard('{ArrowDown}')
    expect(campo).toHaveAttribute('aria-activedescendant', opcoes[0]!.id)
    await user.keyboard('{ArrowUp}{Enter}')
    expect(push).toHaveBeenCalledWith('/conteudo')
    await waitFor(() => expect(paleta()).toBeNull())
  })

  it('busca no servidor a partir de 2 letras e mostra os grupos; Enter abre o resultado', async () => {
    const user = userEvent.setup()
    const buscar = montar(vi.fn<Buscar>(async (t) => ({
      ok: true as const,
      data: t === 'ma' ? [] : [
        R('unidade', 'u1', 'Asa Sul'),
        R('item', 'i1', 'Picanha', { detalhe: 'Pratos' }),
        R('conversa', 'c1', 'Maria', { detalhe: 'Asa Sul', simulada: true }),
      ],
    })))
    await user.keyboard('{Control>}k{/Control}')
    const campo = screen.getByRole('combobox', { name: 'Buscar no painel' })
    await user.type(campo, 'm')
    expect(buscar).not.toHaveBeenCalled()
    await user.type(campo, 'ar')
    await waitFor(() => expect(buscar).toHaveBeenLastCalledWith('mar'))
    const conversa = await screen.findByRole('option', { name: /Maria/ })
    expect(within(conversa).getByText('Simulação')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Unidades' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Cardápio' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Conversas' })).toBeInTheDocument()
    await user.keyboard('{ArrowUp}{Enter}')
    expect(push).toHaveBeenCalledWith('/conversas/c1')
  })

  it('resposta atrasada de um termo antigo não substitui a do termo atual', async () => {
    const user = userEvent.setup()
    let liberarAntiga!: () => void
    montar(vi.fn<Buscar>((t) => t === 'pi'
      ? new Promise<{ ok: true; data: ResultadoBusca[] }>((res) => { liberarAntiga = () => res({ ok: true, data: [R('item', 'velho', 'Pizza velha')] }) })
      : Promise.resolve({ ok: true as const, data: [R('item', 'novo', 'Picanha')] })))
    await user.keyboard('{Control>}k{/Control}')
    const campo = screen.getByRole('combobox', { name: 'Buscar no painel' })
    await user.type(campo, 'pi')
    await new Promise((r) => setTimeout(r, 300))
    await user.type(campo, 'c')
    expect(await screen.findByRole('option', { name: /Picanha/ })).toBeInTheDocument()
    await act(async () => liberarAntiga())
    expect(screen.queryByRole('option', { name: /Pizza velha/ })).toBeNull()
  })

  it('nada encontrado e falha na busca aparecem na paleta', async () => {
    const user = userEvent.setup()
    montar(vi.fn<Buscar>(async (t) => (t === 'zz' ? { ok: true as const, data: [] } : { ok: false as const, formError: 'x' })))
    await user.keyboard('{Control>}k{/Control}')
    const campo = screen.getByRole('combobox', { name: 'Buscar no painel' })
    await user.type(campo, 'zz')
    expect(await screen.findByText('Nada encontrado para “zz”.')).toBeInTheDocument()
    await user.clear(campo)
    await user.type(campo, 'qq')
    expect(await screen.findByText('Não foi possível buscar agora. Tente de novo.')).toBeInTheDocument()
  })

  it('a tela Simulador abre o simulador em vez de navegar', async () => {
    const user = userEvent.setup()
    montar()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('combobox', { name: 'Buscar no painel' }), 'simul')
    fireEvent.click(screen.getByRole('option', { name: 'Simulador' }))
    expect(abrirSimulador).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    await waitFor(() => expect(paleta()).toBeNull())
  })
})
