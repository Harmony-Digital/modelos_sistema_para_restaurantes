import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LogoRestaurante } from './logo-restaurante'

describe('LogoRestaurante', () => {
  it('quadro fixo de 32×32 com object-contain e alt com o nome', () => {
    render(<LogoRestaurante url="https://x.test/l.png" nome="Casa Harmonia" />)
    const img = screen.getByRole('img', { name: 'Casa Harmonia' })
    expect(img).toHaveAttribute('src', 'https://x.test/l.png')
    expect(img).toHaveAttribute('width', '32')
    expect(img).toHaveAttribute('height', '32')
    expect(img.className).toMatch(/\bsize-8\b/)
    expect(img.className).toMatch(/\bobject-contain\b/)
    expect(img.className).toMatch(/\bshrink-0\b/)
  })

  it('decorativa (nome escrito ao lado): alt vazio, fora da árvore de acessibilidade', () => {
    const { container } = render(<LogoRestaurante url="https://x.test/l.png" nome="Casa Harmonia" decorativa />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('topo do celular: 24 px', () => {
    render(<LogoRestaurante url="https://x.test/l.png" nome="R" tamanho={24} />)
    const img = screen.getByRole('img', { name: 'R' })
    expect(img).toHaveAttribute('width', '24')
    expect(img).toHaveAttribute('height', '24')
    expect(img.className).toMatch(/\bsize-6\b/)
    expect(img.className).not.toMatch(/\bsize-8\b/)
  })

  it('imagem extrema (4000×200 ou 50×50) não muda o quadro: largura e altura vêm do quadro, nunca da imagem', () => {
    for (const [w, h] of [[4000, 200], [50, 50]] as const) {
      const { unmount } = render(<LogoRestaurante url={`https://x.test/${w}x${h}.png`} nome="R" />)
      const img = screen.getByRole('img', { name: 'R' }) as HTMLImageElement
      Object.defineProperty(img, 'naturalWidth', { value: w })
      Object.defineProperty(img, 'naturalHeight', { value: h })
      img.dispatchEvent(new Event('load'))
      expect(img.getAttribute('width')).toBe('32')
      expect(img.getAttribute('height')).toBe('32')
      expect(img.style.width).toBe('')
      expect(img.className).toMatch(/\bsize-8\b.*\bobject-contain\b|\bobject-contain\b.*\bsize-8\b/)
      unmount()
    }
  })
})
