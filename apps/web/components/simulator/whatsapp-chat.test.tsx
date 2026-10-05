import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SimMessage } from './types'
import { WhatsAppChat } from './whatsapp-chat'

const base = { restaurante: 'Casa Teste', digitando: false, onEnviar: vi.fn(), onEscolher: vi.fn() }

describe('WhatsAppChat', () => {
  it('cabeçalho, mensagens em ordem e região que anuncia novas mensagens', () => {
    const mensagens: SimMessage[] = [
      { id: '1', de: 'cliente', tipo: 'texto', texto: 'abre domingo?', hora: '10:01', status: 'lida' },
      { id: '2', de: 'restaurante', tipo: 'texto', texto: 'Abrimos domingo das 11h30 às 16h.', hora: '10:01' },
    ]
    render(<WhatsAppChat {...base} mensagens={mensagens} />)
    expect(screen.getByRole('heading', { name: 'Casa Teste' })).toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()
    const log = screen.getByRole('log')
    expect(within(log).getAllByRole('article').map((a) => a.textContent)).toEqual([
      expect.stringContaining('abre domingo?'),
      expect.stringContaining('Abrimos domingo das 11h30 às 16h.'),
    ])
    expect(screen.getByText('Lida')).toBeInTheDocument()
  })

  it('mostra "digitando…" no cabeçalho', () => {
    render(<WhatsAppChat {...base} mensagens={[]} digitando />)
    expect(screen.getByText('digitando…')).toBeInTheDocument()
  })

  it('envia com Enter e com o botão; não envia vazio', async () => {
    const user = userEvent.setup()
    const onEnviar = vi.fn()
    render(<WhatsAppChat {...base} mensagens={[]} onEnviar={onEnviar} />)
    const campo = screen.getByRole('textbox', { name: 'Mensagem' })
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    await user.type(campo, 'oi{Enter}')
    await user.type(campo, 'tem estacionamento?')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(onEnviar.mock.calls).toEqual([['oi'], ['tem estacionamento?']])
    expect(campo).toHaveValue('')
  })

  it('Shift+Enter quebra linha e não envia; Enter durante composição (IME) não envia', async () => {
    const user = userEvent.setup()
    const onEnviar = vi.fn()
    render(<WhatsAppChat {...base} mensagens={[]} onEnviar={onEnviar} />)
    const campo = screen.getByRole('textbox', { name: 'Mensagem' })
    await user.type(campo, 'linha 1{Shift>}{Enter}{/Shift}linha 2')
    expect(onEnviar).not.toHaveBeenCalled()
    expect(campo).toHaveValue('linha 1\nlinha 2')
    fireEvent.keyDown(campo, { key: 'Enter', isComposing: true })
    expect(onEnviar).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(onEnviar).toHaveBeenCalledWith('linha 1\nlinha 2')
  })

  it('lista interativa abre as opções e devolve a escolha', async () => {
    const user = userEvent.setup()
    const onEscolher = vi.fn()
    const lista: SimMessage = {
      id: 'l1', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Ver unidades', hora: '10:02',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Asa Sul', descricao: 'SCLS 404' }, { id: 'u2', titulo: 'Lago Sul' }] }],
    }
    render(<WhatsAppChat {...base} mensagens={[lista]} onEscolher={onEscolher} />)
    await user.click(screen.getByRole('button', { name: 'Ver unidades' }))
    const opcoes = screen.getByRole('dialog', { name: 'Ver unidades' })
    await user.click(within(opcoes).getByRole('button', { name: /Asa Sul/ }))
    expect(onEscolher).toHaveBeenCalledWith('l1', 'u1', 'Asa Sul')
  })

  it('localização mostra endereço e abre no Maps com as coordenadas', () => {
    const loc: SimMessage = { id: 'p1', de: 'restaurante', tipo: 'localizacao', nome: 'Casa Teste — Asa Sul', endereco: 'SCLS 404 Bloco C', lat: -15.8267, lng: -47.9218, hora: '10:03' }
    render(<WhatsAppChat {...base} mensagens={[loc]} />)
    expect(screen.getByText('SCLS 404 Bloco C')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir no Maps/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=-15.8267,-47.9218')
  })

  it('painel da lista: foco entra, Esc fecha só o painel e devolve o foco, Cancelar fecha', async () => {
    const user = userEvent.setup()
    const lista: SimMessage = {
      id: 'l1', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Ver unidades', hora: '10:02',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Asa Sul' }] }],
    }
    const aoEscape = vi.fn()
    document.addEventListener('keydown', aoEscape)
    render(<WhatsAppChat {...base} mensagens={[lista]} />)
    const botao = screen.getByRole('button', { name: 'Ver unidades' })
    await user.click(botao)
    const painel = screen.getByRole('dialog', { name: 'Ver unidades' })
    expect(painel).toHaveAttribute('aria-modal', 'true')
    expect(painel).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Ver unidades' })).toBeNull()
    expect(aoEscape).not.toHaveBeenCalled()
    expect(botao).toHaveFocus()
    await user.click(botao)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog', { name: 'Ver unidades' })).toBeNull()
    expect(botao).toHaveFocus()
    document.removeEventListener('keydown', aoEscape)
  })

  it('painel da lista: re-render do pai não rouba o foco e Tab circula dentro do painel', async () => {
    const user = userEvent.setup()
    const lista: SimMessage = {
      id: 'l1', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Ver unidades', hora: '10:02',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Asa Sul' }, { id: 'u2', titulo: 'Lago Sul' }] }],
    }
    const { rerender } = render(<WhatsAppChat {...base} mensagens={[lista]} />)
    await user.click(screen.getByRole('button', { name: 'Ver unidades' }))
    const painel = screen.getByRole('dialog', { name: 'Ver unidades' })
    await user.tab()
    const segunda = within(painel).getByRole('button', { name: 'Lago Sul' })
    expect(segunda).toHaveFocus()
    const nova: SimMessage = { id: 'm9', de: 'restaurante', tipo: 'texto', texto: 'Olá', hora: '10:03' }
    rerender(<WhatsAppChat {...base} mensagens={[lista, nova]} digitando />)
    expect(segunda).toHaveFocus()
    await user.tab()
    expect(within(painel).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    await user.tab()
    expect(within(painel).getByRole('button', { name: /Asa Sul/ })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(painel).getByRole('button', { name: 'Cancelar' })).toHaveFocus()
  })
})
