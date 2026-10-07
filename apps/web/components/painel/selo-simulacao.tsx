import { Badge } from '@/components/ui/badge'

/** Marca o que nasceu no simulador (conversa, aviso, pedido de evento) quando aparece no painel. */
export function SeloSimulacao() {
  return <Badge variant="outline" className="border-border text-muted-foreground">Simulação</Badge>
}
