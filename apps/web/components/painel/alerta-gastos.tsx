import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { AlertaPainel } from '@atd/db'
import { textoAlerta } from '@/lib/gastos-tela'

const LINK = 'inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'

/** 100% antes de 80% (a ordem do banco já é essa; aqui garante para quem montar a lista à mão). */
const porGravidade = (alertas: AlertaPainel[]) => [...alertas].sort((a, b) => b.nivel - a.nivel)

/** Faixa no topo do painel (dono/gerente) enquanto o período do alerta durar. */
export function FaixaAlertaGastos(props: { alertas: AlertaPainel[] }) {
  if (props.alertas.length === 0) return null
  const [principal, ...outros] = porGravidade(props.alertas)
  return (
    <section aria-label="Alerta de gastos" className="border-b border-warning bg-card pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 text-sm text-foreground">
          <strong className="font-semibold">{textoAlerta(principal!)}</strong>
          {principal!.nivel === 100 && <span> — modo econômico até o próximo período ou até aumentar o limite.</span>}
          {outros.length > 0 && <span className="text-muted-foreground"> (e mais {outros.length} {outros.length === 1 ? 'alerta' : 'alertas'})</span>}
        </p>
        <Link href="/mais/gastos" className={LINK}>Ajustar limites</Link>
      </div>
    </section>
  )
}

/** Cartão do Início com todos os alertas do período corrente. */
export function CartaoAlertasGastos(props: { alertas: AlertaPainel[] }) {
  if (props.alertas.length === 0) return null
  return (
    <section aria-labelledby="alertas-gastos-titulo" className="flex flex-col gap-2 rounded-lg border border-warning bg-card p-4">
      <h2 id="alertas-gastos-titulo" className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle aria-hidden="true" className="size-4 text-warning" /> Alertas de gasto
      </h2>
      <ul className="flex flex-col gap-1 text-sm text-foreground">
        {porGravidade(props.alertas).map((a) => (
          <li key={`${a.escopo}:${a.periodo}`}>
            {textoAlerta(a)}
            {a.nivel === 100 && <span className="text-muted-foreground"> — modo econômico até o próximo período ou até aumentar o limite</span>}
          </li>
        ))}
      </ul>
      <Link href="/mais/gastos" className={LINK}>Ajustar limites</Link>
    </section>
  )
}
