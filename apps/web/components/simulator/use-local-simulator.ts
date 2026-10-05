'use client'
import { useCallback, useState } from 'react'
import type { SimMessage } from './types'

const AVISO: SimMessage = { id: 'aviso-02a', de: 'sistema', tipo: 'aviso', texto: 'Simulação visual — as respostas da IA serão ligadas na próxima etapa (02-C).' }
const hora = () => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date())

export function useLocalSimulator() {
  const [mensagens, setMensagens] = useState<SimMessage[]>([AVISO])
  const enviar = useCallback((texto: string) => {
    const id = crypto.randomUUID()
    setMensagens((ms) => [...ms, { id, de: 'cliente', tipo: 'texto', texto, hora: hora(), status: 'enviando' }])
    setTimeout(() => setMensagens((ms) => ms.map((m) => (m.id === id && m.tipo === 'texto' ? { ...m, status: 'entregue' } : m))), 300)
  }, [])
  const escolher = useCallback((_mensagemId: string, _itemId: string, titulo: string) => enviar(titulo), [enviar])
  return { mensagens, digitando: false, enviar, escolher }
}
