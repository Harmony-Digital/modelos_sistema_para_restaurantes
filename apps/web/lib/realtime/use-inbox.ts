'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/** O pedaço do cliente Supabase que o hook usa (permite um cliente falso nos testes). */
export type CanalRealtime = {
  on(tipo: 'broadcast', filtro: { event: string }, cb: (payload: unknown) => void): CanalRealtime
  subscribe(cb: (status: string, err?: Error) => void): CanalRealtime
}
export type ClienteRealtime = {
  realtime: { setAuth(token?: string | null): Promise<void> }
  channel(topico: string, opts: { config: { private: boolean } }): CanalRealtime
  removeChannel(canal: CanalRealtime): Promise<unknown>
}

export const DEBOUNCE_MS = 500
export const FALLBACK_MS = 60_000
const CAIU = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/**
 * Escuta os tópicos privados do Realtime (evento `mudou`, payload só com ids) e recarrega a rota pela DAL
 * (`router.refresh()`, com debounce). Enquanto algum tópico estiver sem conexão, recarrega a cada 60 s; ao reconectar
 * depois de cair, recarrega uma vez (eventos perdidos). O supabase-js reconecta sozinho os canais.
 */
export function useInbox(topicos: readonly string[], opts: { cliente?: ClienteRealtime } = {}): void {
  const router = useRouter()
  // a referência do router pode mudar entre renders; os canais não devem ser refeitos por isso
  const routerRef = useRef(router)
  routerRef.current = router
  const chave = topicos.join('|')
  const cliente = opts.cliente
  useEffect(() => {
    const lista = chave === '' ? [] : chave.split('|')
    if (lista.length === 0) return
    const sb: ClienteRealtime = cliente ?? (createClient() as unknown as ClienteRealtime)
    let vivo = true
    let debounce: ReturnType<typeof setTimeout> | undefined
    let fallback: ReturnType<typeof setInterval> | undefined
    const conectados = new Set<string>()
    const jaCairam = new Set<string>()
    const canais: CanalRealtime[] = []

    const recarregar = () => {
      clearTimeout(debounce)
      debounce = setTimeout(() => { if (vivo) routerRef.current.refresh() }, DEBOUNCE_MS)
    }
    const ajustarFallback = () => {
      const todos = lista.every((t) => conectados.has(t))
      if (todos && fallback !== undefined) {
        clearInterval(fallback)
        fallback = undefined
      } else if (!todos && fallback === undefined) {
        fallback = setInterval(() => { if (vivo) routerRef.current.refresh() }, FALLBACK_MS)
      }
    }
    ajustarFallback()

    void (async () => {
      // canal privado: o token do usuário vai antes da assinatura (as policies de realtime.messages decidem)
      try {
        await sb.realtime.setAuth()
      } catch {
        /* segue: sem token o canal recusa e o fallback de 60 s cobre */
      }
      if (!vivo) return
      for (const topico of lista) {
        const canal = sb
          .channel(topico, { config: { private: true } })
          .on('broadcast', { event: 'mudou' }, recarregar)
          .subscribe((status) => {
            if (!vivo) return
            if (status === 'SUBSCRIBED') {
              conectados.add(topico)
              if (jaCairam.delete(topico)) recarregar()
            } else if (CAIU.has(status)) {
              conectados.delete(topico)
              jaCairam.add(topico)
            }
            ajustarFallback()
          })
        canais.push(canal)
      }
    })()

    return () => {
      vivo = false
      clearTimeout(debounce)
      clearInterval(fallback)
      for (const c of canais) void sb.removeChannel(c)
    }
  }, [chave, cliente])
}
