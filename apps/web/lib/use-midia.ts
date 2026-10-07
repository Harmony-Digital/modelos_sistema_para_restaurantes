'use client'
import { useEffect, useState } from 'react'

/** Breakpoints do Tailwind usados no painel. */
export const MIDIA_LG = '(min-width: 1024px)'
export const MIDIA_XL = '(min-width: 1280px)'

/** Se a media query vale agora; `null` até saber (como no SSR), para quem precisa evitar piscar. */
export function useMidia(query: string): boolean | null {
  const [vale, setVale] = useState<boolean | null>(null)
  useEffect(() => {
    const m = window.matchMedia(query)
    const atualizar = () => setVale(m.matches)
    atualizar()
    m.addEventListener('change', atualizar)
    return () => m.removeEventListener('change', atualizar)
  }, [query])
  return vale
}
