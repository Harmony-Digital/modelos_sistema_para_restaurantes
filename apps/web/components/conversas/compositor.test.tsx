import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { Compositor } from './compositor'

const ID = '11111111-1111-4111-8111-111111111111'
const respostas = [
  { id: 'q1', titulo: 'Saudação', texto: 'Olá! Sou da equipe, como posso ajudar?', ordem: 0, ativo: true },
  { id: 'q2', titulo: 'Horário', texto: 'Abrimos às 11h.', ordem: 1, ativo: true },
]

function desktop(sim: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: sim && q.includes('pointer: fine'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  desktop(true)
})

describe('Compositor', () => {
  it('fora da janela: campo e botão desabilitados com o texto da spec', () => {
    render(<Compositor conversationId={ID} foraDaJanela respostasRapidas={respostas} enviar={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(screen.getByText('O cliente não escreve há mais de 24 h. O WhatsApp só permite responder quando ele mandar uma nova mensagem.')).toBeInTheDocument()
  })

  it('respostas rápidas num menu: escolher preenche o campo', async () => {
    const user = userEvent.setup()
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={respostas} enviar={vi.fn()} />)
    const botao = screen.getByRole('button', { name: 'Respostas rápidas' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await user.click(botao)
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      expect.stringContaining('Saudação'), expect.stringContaining('Horário'),
    ])
    await user.click(screen.getByRole('menuitem', { name: /Horário/ }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toHaveValue('Abrimos às 11h.')
  })

  it('sem respostas rápidas: sem o menu', () => {
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Respostas rápidas' })).toBeNull()
  })

  it('Enter envia no desktop (Shift+Enter quebra linha) e limpa o campo', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn(async () => ({ ok: true as const, data: { messageId: 1, envioAtrasado: false } }))
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={enviar} />)
    const campo = screen.getByRole('textbox', { name: 'Resposta' })
    await user.type(campo, 'Linha 1{Shift>}{Enter}{/Shift}Linha 2')
    expect(enviar).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(enviar).toHaveBeenCalledWith(ID, { texto: 'Linha 1\nLinha 2' })
    expect(campo).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('Enviado')
  })

  it('no celular Enter quebra linha; envia pelo botão', async () => {
    desktop(false)
    const user = userEvent.setup()
    const enviar = vi.fn(async () => ({ ok: true as const, data: { messageId: 1, envioAtrasado: false } }))
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={enviar} />)
    await user.type(screen.getByRole('textbox', { name: 'Resposta' }), 'Oi{Enter}')
    expect(enviar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviar).toHaveBeenCalledWith(ID, { texto: 'Oi\n' })
  })

  it('vazio não envia; mais de 4096 mostra o erro', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn()
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={enviar} />)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviar).not.toHaveBeenCalled()
    const campo = screen.getByRole('textbox', { name: 'Resposta' })
    await user.click(campo)
    await user.paste('x'.repeat(4097))
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviar).not.toHaveBeenCalled()
    expect(screen.getByText('A resposta passa de 4096 caracteres.')).toBeInTheDocument()
  })

  it('falhou: mantém o texto, mostra o erro e "Tentar de novo" reenvia', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn()
      .mockResolvedValueOnce({ ok: false, formError: 'Esta conversa mudou de situação. Confira a tela antes de continuar.' })
      .mockResolvedValueOnce({ ok: true, data: { messageId: 2, envioAtrasado: false } })
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={enviar} />)
    await user.type(screen.getByRole('textbox', { name: 'Resposta' }), 'Oi')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Esta conversa mudou de situação.')
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toHaveValue('Oi')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(enviar).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox', { name: 'Resposta' })).toHaveValue('')
  })

  it('envio atrasado: avisa sem pedir para reenviar', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn(async () => ({ ok: true as const, data: { messageId: 1, envioAtrasado: true } }))
    render(<Compositor conversationId={ID} foraDaJanela={false} respostasRapidas={[]} enviar={enviar} />)
    await user.type(screen.getByRole('textbox', { name: 'Resposta' }), 'Oi{Enter}')
    expect(toast.warning).toHaveBeenCalledWith('Resposta salva. O envio pelo WhatsApp pode atrasar um pouco.')
  })
})
