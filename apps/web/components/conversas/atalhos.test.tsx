import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))

import { AtalhosLista } from './atalhos'

function Tela(props: { aberta?: boolean; atual?: number }) {
  return (
    <div>
      <ul data-lista-navegavel="">
        {['Ana', 'Bia', 'Caio'].map((n, i) => (
          <li key={n}><a href={`/conversas/${i}`} aria-current={props.atual === i ? 'page' : undefined}>{n}</a></li>
        ))}
      </ul>
      <textarea aria-label="Resposta" />
      <div role="dialog" aria-label="Encerrar"><button type="button">Cancelar</button></div>
      <AtalhosLista voltar="/conversas?aba=ia" aberta={props.aberta ?? false} />
    </div>
  )
}

const tecla = (key: string, alvo: Element = document.body) => fireEvent.keyDown(alvo, { key })

beforeEach(() => {
  push.mockReset()
  ;(document.activeElement as HTMLElement | null)?.blur()
})

describe('AtalhosLista (Conversas)', () => {
  it('↓ e ↑ percorrem a lista movendo o foco (Enter abre o link focado)', () => {
    render(<Tela />)
    tecla('ArrowDown')
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveFocus()
    tecla('ArrowDown', document.activeElement!)
    expect(screen.getByRole('link', { name: 'Bia' })).toHaveFocus()
    tecla('ArrowDown', document.activeElement!)
    tecla('ArrowDown', document.activeElement!)
    expect(screen.getByRole('link', { name: 'Caio' })).toHaveFocus()
    tecla('ArrowUp', document.activeElement!)
    expect(screen.getByRole('link', { name: 'Bia' })).toHaveFocus()
  })

  it('com uma conversa aberta, ↓ parte dela', () => {
    render(<Tela aberta atual={1} />)
    tecla('ArrowDown')
    expect(screen.getByRole('link', { name: 'Caio' })).toHaveFocus()
  })

  it('Esc fecha a conversa aberta e volta para a lista com os filtros', () => {
    render(<Tela aberta atual={0} />)
    tecla('Escape')
    expect(push).toHaveBeenCalledWith('/conversas?aba=ia', { scroll: false })
  })

  it('Esc sem conversa aberta não faz nada', () => {
    render(<Tela />)
    tecla('Escape')
    expect(push).not.toHaveBeenCalled()
  })

  it('foco no compositor ou num diálogo: ↑/↓ e Esc ficam com o campo/diálogo', () => {
    render(<Tela aberta atual={0} />)
    const campo = screen.getByRole('textbox', { name: 'Resposta' })
    campo.focus()
    tecla('ArrowDown', campo)
    tecla('Escape', campo)
    expect(campo).toHaveFocus()
    const botao = screen.getByRole('button', { name: 'Cancelar' })
    botao.focus()
    tecla('Escape', botao)
    tecla('ArrowDown', botao)
    expect(botao).toHaveFocus()
    expect(push).not.toHaveBeenCalled()
  })
})
