import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ignorarAtalho } from './atalhos'

function evento(alvo: Element | null, extra: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true, ...extra })
  if (alvo) Object.defineProperty(e, 'target', { value: alvo })
  return e
}

describe('ignorarAtalho', () => {
  it('foco no corpo da página: atalho vale', () => {
    expect(ignorarAtalho(evento(document.body))).toBe(false)
  })

  it('campo de texto, área de texto, seleção e conteúdo editável: atalho ignorado', () => {
    render(
      <div>
        <input aria-label="nome" />
        <input aria-label="busca" type="search" />
        <textarea aria-label="resposta" />
        <select aria-label="unidade"><option>a</option></select>
        <div aria-label="editor" contentEditable suppressContentEditableWarning role="textbox" />
      </div>,
    )
    for (const nome of ['nome', 'busca', 'resposta', 'unidade', 'editor']) {
      expect(ignorarAtalho(evento(screen.getByLabelText(nome))), nome).toBe(true)
    }
  })

  it('caixa de seleção e botão não são campo de texto: atalho vale', () => {
    render(<div><input type="checkbox" aria-label="sim" /><button type="button">ok</button></div>)
    expect(ignorarAtalho(evento(screen.getByLabelText('sim')))).toBe(false)
    expect(ignorarAtalho(evento(screen.getByRole('button')))).toBe(false)
  })

  it('dentro de um diálogo aberto (confirmação, folha, simulador): atalho ignorado', () => {
    render(<div role="alertdialog"><button type="button">Confirmar</button></div>)
    expect(ignorarAtalho(evento(screen.getByRole('button')))).toBe(true)
  })

  it('com Ctrl, Cmd ou Alt, repetido ou já tratado: atalho ignorado', () => {
    expect(ignorarAtalho(evento(document.body, { ctrlKey: true }))).toBe(true)
    expect(ignorarAtalho(evento(document.body, { metaKey: true }))).toBe(true)
    expect(ignorarAtalho(evento(document.body, { altKey: true }))).toBe(true)
    expect(ignorarAtalho(evento(document.body, { repeat: true }))).toBe(true)
    const tratado = evento(document.body)
    tratado.preventDefault()
    expect(ignorarAtalho(tratado)).toBe(true)
  })
})
