'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { ignorarAtalho } from '@/lib/atalhos'

/**
 * Teclado na lista + detalhe: ↑/↓ movem o foco pelos itens de `[data-lista-navegavel]` (Enter abre o link focado,
 * comportamento nativo) e Esc fecha o item aberto voltando para `voltar`. Nada dispara com o foco num campo de texto
 * ou dentro de um diálogo. As setas só agem com o foco na lista ou solto na página (não roubam a rolagem do detalhe).
 */
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
      if (!solto && !lista.contains(ativo)) return
      const itens = Array.from(lista.querySelectorAll<HTMLAnchorElement>('a[href]'))
      if (itens.length === 0) return
      let i = itens.findIndex((a) => a === ativo || a.contains(ativo))
      if (i < 0) i = itens.findIndex((a) => a.getAttribute('aria-current') === 'page')
      const proximo = e.key === 'ArrowDown'
        ? (i < 0 ? 0 : Math.min(i + 1, itens.length - 1))
        : (i < 0 ? 0 : Math.max(i - 1, 0))
      e.preventDefault()
      itens[proximo]!.focus()
      itens[proximo]!.scrollIntoView?.({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [voltar, aberta])
  return null
}
