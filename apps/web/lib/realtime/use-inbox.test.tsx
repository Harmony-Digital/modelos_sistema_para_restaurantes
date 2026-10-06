import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => { throw new Error('não deveria criar o cliente real') } }))

import { useInbox, type ClienteRealtime } from './use-inbox'

type CanalFalso = {
  topico: string
  opts: unknown
  handlers: { filtro: { event: string }; cb: (p: unknown) => void }[]
  status?: (s: string) => void
  on: (t: string, f: { event: string }, cb: (p: unknown) => void) => CanalFalso
  subscribe: (cb: (s: string) => void) => CanalFalso
}

function clienteFalso() {
  const canais: CanalFalso[] = []
  const ordem: string[] = []
  const cliente = {
    realtime: { setAuth: vi.fn(async () => { ordem.push('setAuth') }) },
    channel: vi.fn((topico: string, opts: unknown) => {
      ordem.push(`channel:${topico}`)
      const c: CanalFalso = {
        topico, opts, handlers: [],
        on(_t, filtro, cb) { c.handlers.push({ filtro, cb }); return c },
        subscribe(cb) { c.status = cb; return c },
      }
      canais.push(c)
      return c
    }),
    removeChannel: vi.fn(async () => 'ok'),
  }
  const emitir = (topico: string) => {
    for (const h of canais.find((c) => c.topico === topico)!.handlers) if (h.filtro.event === 'mudou') h.cb({ payload: { conversation_id: 'x' } })
  }
  const status = (topico: string, s: string) => canais.find((c) => c.topico === topico)!.status!(s)
  return { cliente: cliente as unknown as ClienteRealtime, raw: cliente, canais, ordem, emitir, status }
}

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
})
afterEach(() => vi.useRealTimers())

const montar = async (topicos: string[], f: ReturnType<typeof clienteFalso>) => {
  const h = renderHook(({ t }) => useInbox(t, { cliente: f.cliente }), { initialProps: { t: topicos } })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  return h
}

describe('useInbox', () => {
  it('autentica o Realtime antes e assina canais privados nos tópicos certos', async () => {
    const f = clienteFalso()
    await montar(['inbox:u:a', 'inbox:u:b'], f)
    expect(f.ordem).toEqual(['setAuth', 'channel:inbox:u:a', 'channel:inbox:u:b'])
    for (const c of f.canais) {
      expect(c.opts).toEqual({ config: { private: true } })
      expect(c.handlers.map((h) => h.filtro)).toEqual([{ event: 'mudou' }])
    }
  })

  it('várias mudanças seguidas ⇒ um só refresh depois de 500 ms', async () => {
    const f = clienteFalso()
    await montar(['inbox:r:r1'], f)
    act(() => { f.status('inbox:r:r1', 'SUBSCRIBED') })
    act(() => { f.emitir('inbox:r:r1'); f.emitir('inbox:r:r1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    act(() => { f.emitir('inbox:r:r1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(499) })
    expect(refresh).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('sem conexão ⇒ refresh a cada 60 s; conectado ⇒ para', async () => {
    const f = clienteFalso()
    await montar(['inbox:r:r1'], f)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => { f.status('inbox:r:r1', 'SUBSCRIBED') })
    refresh.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(refresh).not.toHaveBeenCalled()
    act(() => { f.status('inbox:r:r1', 'CHANNEL_ERROR') })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('reconectou depois de cair ⇒ recarrega (pode ter perdido eventos)', async () => {
    const f = clienteFalso()
    await montar(['inbox:r:r1'], f)
    act(() => { f.status('inbox:r:r1', 'SUBSCRIBED') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(refresh).not.toHaveBeenCalled()
    act(() => { f.status('inbox:r:r1', 'TIMED_OUT') })
    act(() => { f.status('inbox:r:r1', 'SUBSCRIBED') })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('desmontar remove os canais e para os timers', async () => {
    const f = clienteFalso()
    const h = await montar(['conversa:c1'], f)
    h.unmount()
    expect(f.raw.removeChannel).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('sem tópicos ⇒ não conecta nem recarrega', async () => {
    const f = clienteFalso()
    await montar([], f)
    expect(f.raw.channel).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('mesmos tópicos em novo array não reassinam', async () => {
    const f = clienteFalso()
    const h = await montar(['inbox:u:a'], f)
    h.rerender({ t: ['inbox:u:a'] })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(f.raw.channel).toHaveBeenCalledTimes(1)
  })
})
