'use client'
import { useInbox } from '@/lib/realtime/use-inbox'

/** Conversa aberta: escuta `conversa:<id>` (novas mensagens e status de envio) e recarrega pela DAL. */
export function EscutarConversa({ topico }: { topico: string }) {
  useInbox([topico])
  return null
}
