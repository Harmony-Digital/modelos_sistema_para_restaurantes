import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import type { PedidoTitular } from '@atd/db'
import { Button } from '@/components/ui/button'
import { contarPrazoLgpd, DIAS_ALERTA_PRAZO } from '@/lib/privacidade'

/**
 * Alerta do Início (dono/gerente): pedidos do titular vencidos ou a ≤ 3 dias do prazo de 15 dias.
 * Recebe os pedidos em aberto (`listarPedidosTitular(db, claims, { status: ['aberto', 'em_andamento'] })`); sem nenhum perto do prazo, não aparece.
 */
export function CartaoPrazoLgpd(props: { pedidos: readonly Pick<PedidoTitular, 'prazo' | 'status'>[]; agora: Date }) {
  const { perto, vencidos } = contarPrazoLgpd(props.pedidos, props.agora)
  if (perto === 0 && vencidos === 0) return null
  return (
    <section aria-labelledby="titulo-prazo-lgpd" className="flex flex-col gap-2 rounded-lg border border-warning bg-card p-4">
      <h2 id="titulo-prazo-lgpd" className="flex items-center gap-2 font-semibold text-foreground">
        <ShieldAlert aria-hidden="true" className="size-4 text-warning" /> Pedidos de privacidade (LGPD)
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {vencidos > 0 && (
          <li className="font-medium text-destructive">{vencidos === 1 ? '1 pedido vencido' : `${vencidos} pedidos vencidos`}</li>
        )}
        {perto > 0 && (
          <li className="text-foreground">
            {perto === 1 ? `1 pedido vence em até ${DIAS_ALERTA_PRAZO} dias` : `${perto} pedidos vencem em até ${DIAS_ALERTA_PRAZO} dias`}
          </li>
        )}
      </ul>
      <Button asChild variant="outline" className="self-start">
        <Link href="/gestao/privacidade">Ver pedidos</Link>
      </Button>
    </section>
  )
}
