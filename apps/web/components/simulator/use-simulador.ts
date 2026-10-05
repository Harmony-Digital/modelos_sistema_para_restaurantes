'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionResult } from '@/lib/action-result'
import {
  AVISO_SIMULACAO, avisoDoEstado, horaDe, paraSimMessage, rotuloRelogio,
  type DetalheTela, type MensagemTela, type RespostaSimulador,
} from '@/lib/simulador-tela'
import type { SimMessage } from './types'

export type AcoesSimulador = {
  abrir: () => Promise<ActionResult<RespostaSimulador>>
  buscar: (conversationId: string, desdeId: number) => Promise<ActionResult<RespostaSimulador>>
  enviar: (conversationId: string, texto: string, interativoId: string | null) => Promise<ActionResult>
  novoCliente: () => Promise<ActionResult<RespostaSimulador>>
  relogio: (conversationId: string, local: string | null) => Promise<ActionResult<{ relogioOffsetSegundos: number | null }>>
  detalhes: (conversationId: string) => Promise<ActionResult<DetalheTela[]>>
}

const INTERVALO_MS = 1000
const ERRO_GERAL = 'Não foi possível falar com o simulador. Tente de novo.'
const erroDe = (r: { formError?: string; fieldErrors?: Record<string, string> }) =>
  r.formError ?? Object.values(r.fieldErrors ?? {})[0] ?? ERRO_GERAL

export function useSimulador(acoes: AcoesSimulador, aberto: boolean, timezone: string) {
  const [servidor, setServidor] = useState<MensagemTela[]>([])
  const [otimistas, setOtimistas] = useState<SimMessage[]>([])
  const [estado, setEstado] = useState<RespostaSimulador['estado']>('ia')
  const [digitando, setDigitando] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)
  // o polling só limpa o erro que ele mesmo gerou; erro de ação fica até a próxima ação bem-sucedida
  const [erroPolling, setErroPolling] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<DetalheTela[] | 'erro' | null>(null)
  const conversa = useRef<string | null>(null)
  const cursor = useRef(0)

  const aplicar = useCallback((r: RespostaSimulador, recomecar: boolean) => {
    if (recomecar) {
      conversa.current = r.conversationId
      setOtimistas([])
    }
    cursor.current = r.cursor
    setServidor((atual) => {
      // o cursor pode voltar até uma resposta pendente: junta por id, sem duplicar
      const porId = new Map((recomecar ? [] : atual).map((m) => [m.id, m]))
      for (const m of r.mensagens) porId.set(m.id, m)
      return [...porId.values()].sort((a, b) => a.id - b.id)
    })
    if (r.mensagens.some((m) => m.direcao === 'in')) setOtimistas([])
    setEstado(r.estado)
    setDigitando(r.digitando)
    setOffset(r.relogioOffsetSegundos)
  }, [])

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    let ocupado = false
    const tick = async () => {
      if (ocupado) return
      ocupado = true
      const c = conversa.current
      try {
        const r = c ? await acoes.buscar(c, cursor.current) : await acoes.abrir()
        // resposta atrasada de uma conversa que já foi trocada por "Novo cliente": descarta
        if (!vivo || conversa.current !== c) return
        if (r.ok && r.data) {
          aplicar(r.data, c === null)
          setErroPolling(null)
        } else if (!r.ok) setErroPolling(erroDe(r))
      } catch {
        if (vivo) setErroPolling(ERRO_GERAL)
      } finally {
        ocupado = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), INTERVALO_MS)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [aberto, acoes, aplicar])

  const enviar = useCallback(async (texto: string, interativoId: string | null) => {
    const c = conversa.current
    if (!c) {
      setErroAcao(ERRO_GERAL)
      return
    }
    const id = `tmp-${crypto.randomUUID()}`
    const provisoria: SimMessage = { id, de: 'cliente', tipo: 'texto', texto, hora: horaDe(new Date().toISOString(), timezone, offset), status: 'enviando' }
    setOtimistas((os) => [...os, provisoria])
    const desfazer = (mensagem: string) => {
      setOtimistas((os) => os.filter((o) => o.id !== id))
      setErroAcao(mensagem)
    }
    try {
      const r = await acoes.enviar(c, texto, interativoId)
      if (!r.ok) desfazer(erroDe(r))
      else setErroAcao(null)
    } catch {
      desfazer(ERRO_GERAL)
    }
  }, [acoes, timezone, offset])

  const novoCliente = useCallback(async () => {
    try {
      const r = await acoes.novoCliente()
      if (r.ok && r.data) {
        aplicar(r.data, true)
        setDetalhes(null)
        setErroAcao(null)
      } else if (!r.ok) setErroAcao(erroDe(r))
    } catch {
      setErroAcao(ERRO_GERAL)
    }
  }, [acoes, aplicar])

  /** Devolve a mensagem de erro do campo, ou null se aplicou. */
  const mudarRelogio = useCallback(async (local: string | null): Promise<string | null> => {
    const c = conversa.current
    if (!c) return ERRO_GERAL
    try {
      const r = await acoes.relogio(c, local)
      if (!r.ok) return erroDe(r)
      setOffset(r.data?.relogioOffsetSegundos ?? null)
      setErroAcao(null)
      return null
    } catch {
      return ERRO_GERAL
    }
  }, [acoes])

  const verDetalhes = useCallback(async () => {
    const c = conversa.current
    if (!c) return
    setDetalhes(null)
    try {
      const r = await acoes.detalhes(c)
      if (r.ok) {
        setDetalhes(r.data ?? [])
        setErroAcao(null)
      } else setDetalhes('erro')
    } catch {
      setDetalhes('erro')
    }
  }, [acoes])

  const aviso = avisoDoEstado(estado)
  const mensagens: SimMessage[] = [
    AVISO_SIMULACAO,
    ...servidor.map((m) => paraSimMessage(m, timezone, offset)),
    ...otimistas,
    ...(aviso ? [aviso] : []),
  ]
  return {
    mensagens,
    digitando: digitando || otimistas.length > 0,
    erro: erroAcao ?? erroPolling,
    relogio: rotuloRelogio(offset, timezone, new Date()),
    offset,
    detalhes,
    enviar: (texto: string) => void enviar(texto, null),
    escolher: (_mensagemId: string, itemId: string, titulo: string) => void enviar(titulo, itemId),
    novoCliente,
    mudarRelogio,
    verDetalhes,
  }
}
