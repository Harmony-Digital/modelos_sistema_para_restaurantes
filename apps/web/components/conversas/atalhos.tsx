'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { ignorarAtalho } from '@/lib/atalhos'

/**
 * Teclado na lista + detalhe: ↑/↓ movem o foco pelos itens de `[data-lista-navegavel]` (Enter abre o link focado,
 * comportamento nativo) e Esc fecha o item aberto voltando para `voltar`. Nada dispara com o foco num campo de texto
 * ou dentro de um diálogo. As setas só agem com o foco dentro da lista, ou solto na página quando a lista está à
 * vista (≥ lg, ou < lg sem conversa aberta); abaixo de lg com a conversa aberta a lista está oculta e as setas rolam
 * a página. A tecla só é consumida (preventDefault) quando o foco de fato foi para um item.
 */
const LARGO = '(min-width: 1024px)'
export function AtalhosLista(props: { voltar: string; aberta: boolean }) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const { voltar, aberta } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignorarAtalho(e)) return
      if (e.key === 'Escape') {
        if (!aberta) return
        e.preventDefault()
        routerRef.current.push(voltar, { scroll: false })
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const lista = document.querySelector<HTMLElement>('[data-lista-navegavel]')
      if (!lista) return
      const ativo = document.activeElement
      const solto = ativo === null || ativo === document.body
      const listaVisivel = !aberta || window.matchMedia(LARGO).matches
      if (solto ? !listaVisivel : !lista.contains(ativo)) return
      const itens = Array.from(lista.querySelectorAll<HTMLAnchorElement>('a[href]'))
      if (itens.length === 0) return
      let i = itens.findIndex((a) => a === ativo || a.contains(ativo))
      if (i < 0) i = itens.findIndex((a) => a.getAttribute('aria-current') === 'page')
      const proximo = e.key === 'ArrowDown'
        ? (i < 0 ? 0 : Math.min(i + 1, itens.length - 1))
        : (i < 0 ? 0 : Math.max(i - 1, 0))
      const alvo = itens[proximo]!
      alvo.focus()
      if (document.activeElement !== alvo) return
      e.preventDefault()
      alvo.scrollIntoView?.({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voltar, aberta])
  return null
}
