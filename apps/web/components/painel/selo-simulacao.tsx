import { EtiquetaStatus } from '@/components/ui/etiqueta-status'

/** Marca o que nasceu no simulador (conversa, aviso, pedido de evento) quando aparece no painel. */
export function SeloSimulacao() {
  return <EtiquetaStatus variante="simulacao">Simulação</EtiquetaStatus>
}
