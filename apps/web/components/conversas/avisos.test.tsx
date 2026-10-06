import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const useInbox = vi.hoisted(() => vi.fn())
vi.mock('@/lib/realtime/use-inbox', () => ({ useInbox }))
vi.mock('next/navigation', () => ({ usePathname: () => '/conversas' }))

import { Avisos, ControlesAvisos } from './avisos'

const notificacoes: { titulo: string; opts: unknown }[] = []
class NotificationFalsa {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => NotificationFalsa.permission)
  constructor(titulo: string, opts?: unknown) { notificacoes.push({ titulo, opts }) }
}
const play = vi.fn(async () => undefined)
class AudioFalso {
  constructor(public src: string) {}
  play = play
}

let oculto = false
beforeEach(() => {
  notificacoes.length = 0
  vi.clearAllMocks()
  NotificationFalsa.permission = 'granted'
  vi.stubGlobal('Notification', NotificationFalsa)
  vi.stubGlobal('Audio', AudioFalso)
  oculto = false
  vi.spyOn(document, 'hasFocus').mockImplementation(() => !oculto)
  localStorage.clear()
  document.title = 'Atendimento IA'
})
afterEach(() => vi.unstubAllGlobals())

describe('Avisos', () => {
  it('assina os tópicos e põe o contador no título', () => {
    const { rerender } = render(<Avisos aguardando={2} topicos={['inbox:r:r1']} />)
    expect(useInbox).toHaveBeenCalledWith(['inbox:r:r1'])
    expect(document.title).toBe('(2) Atendimento IA')
    rerender(<Avisos aguardando={0} topicos={['inbox:r:r1']} />)
    expect(document.title).toBe('Atendimento IA')
  })

  it('notifica (texto fixo, sem PII) só quando o contador sobe e a aba não está em foco', () => {
    localStorage.setItem('atd-avisos-notificacao', '1')
    const { rerender } = render(<Avisos aguardando={1} topicos={[]} />)
    expect(notificacoes).toHaveLength(0) // carga inicial não avisa
    rerender(<Avisos aguardando={2} topicos={[]} />) // em foco
    expect(notificacoes).toHaveLength(0)
    oculto = true
    rerender(<Avisos aguardando={1} topicos={[]} />) // desceu
    expect(notificacoes).toHaveLength(0)
    rerender(<Avisos aguardando={3} topicos={[]} />)
    expect(notificacoes).toEqual([{ titulo: 'Nova conversa aguardando atendente', opts: expect.objectContaining({ tag: 'atd-aguardando' }) }])
  })

  it('sem avisos ativados ou sem permissão: não notifica', () => {
    oculto = true
    const { rerender } = render(<Avisos aguardando={0} topicos={[]} />)
    rerender(<Avisos aguardando={1} topicos={[]} />)
    localStorage.setItem('atd-avisos-notificacao', '1')
    NotificationFalsa.permission = 'denied'
    rerender(<Avisos aguardando={2} topicos={[]} />)
    expect(notificacoes).toHaveLength(0)
  })

  it('som curto quando sobe, se ligado', () => {
    const { rerender } = render(<Avisos aguardando={0} topicos={[]} />)
    rerender(<Avisos aguardando={1} topicos={[]} />)
    expect(play).not.toHaveBeenCalled()
    localStorage.setItem('atd-avisos-som', '1')
    rerender(<Avisos aguardando={2} topicos={[]} />)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('localStorage bloqueado não quebra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado') })
    const { rerender } = render(<Avisos aguardando={0} topicos={[]} />)
    expect(() => rerender(<Avisos aguardando={1} topicos={[]} />)).not.toThrow()
    vi.restoreAllMocks()
  })
})

describe('ControlesAvisos', () => {
  it('"Ativar avisos" pede permissão e liga as notificações', async () => {
    NotificationFalsa.permission = 'default'
    NotificationFalsa.requestPermission.mockImplementation(async () => { NotificationFalsa.permission = 'granted'; return 'granted' })
    render(<ControlesAvisos />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ativar avisos' }))
    expect(NotificationFalsa.requestPermission).toHaveBeenCalled()
    expect(localStorage.getItem('atd-avisos-notificacao')).toBe('1')
    expect(screen.queryByRole('button', { name: 'Ativar avisos' })).toBeNull()
    expect(screen.getByText('Avisos do navegador ativados.')).toBeInTheDocument()
  })

  it('permissão negada: explica como liberar', async () => {
    NotificationFalsa.permission = 'default'
    NotificationFalsa.requestPermission.mockImplementation(async () => { NotificationFalsa.permission = 'denied'; return 'denied' })
    render(<ControlesAvisos />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ativar avisos' }))
    expect(localStorage.getItem('atd-avisos-notificacao')).toBeNull()
    expect(screen.getByText(/O navegador bloqueou os avisos/)).toBeInTheDocument()
  })

  it('liga e desliga o som (preferência local)', async () => {
    const user = userEvent.setup()
    render(<ControlesAvisos />)
    const som = screen.getByRole('switch', { name: 'Som de aviso' })
    expect(som).toHaveAttribute('aria-checked', 'false')
    await user.click(som)
    expect(localStorage.getItem('atd-avisos-som')).toBe('1')
    await act(async () => { await user.click(som) })
    expect(localStorage.getItem('atd-avisos-som')).toBe('0')
  })
})
