'use client'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { abrirSimulador } from '@/components/simulator/abrir'
import type { StaffRole } from '@/lib/access'
import { cookieDoMenu, type EstadoMenu } from '@/lib/menu'
import { gruposDoMenu, itemAtivo, type ItemNav } from '@/lib/navegacao'
import { cn } from '@/lib/utils'
import { ContadorAguardando } from './contador'

const ITEM = cn(
  'group relative flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
)

function Item(props: { item: ItemNav; recolhido: boolean; ativo: boolean; aguardando: number }) {
  const { item, recolhido, ativo } = props
  const Icone = item.icone
  const contador = item.contador === 'aguardando' ? props.aguardando : 0
  const nome = contador > 0 ? `${item.rotulo}, ${contador} aguardando` : undefined
  const classe = cn(
    ITEM,
    recolhido && 'justify-center px-0',
    ativo
      ? 'bg-accent text-foreground shadow-[inset_3px_0_0_var(--primary)]'
      : 'text-muted-foreground [@media(hover:hover)]:hover:bg-accent/60 [@media(hover:hover)]:hover:text-foreground',
  )
  const conteudo = (
    <>
      <span className="relative shrink-0">
        <Icone aria-hidden="true" className="size-5" strokeWidth={ativo ? 2.25 : 1.75} />
        {recolhido && <ContadorAguardando valor={contador} className="absolute -right-2.5 -top-2" />}
      </span>
      <span className={cn('truncate', recolhido && 'sr-only')}>{item.rotulo}</span>
      {!recolhido && <ContadorAguardando valor={contador} className="ml-auto" />}
      {recolhido && (
        // dica no modo recolhido (o nome acessível já vem do texto sr-only)
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block"
        >
          {item.rotulo}
        </span>
      )}
    </>
  )
  if (item.acao === 'simulador') {
    return <button type="button" className={classe} onClick={abrirSimulador}>{conteudo}</button>
  }
  return (
    <Link href={item.href!} aria-current={ativo ? 'page' : undefined} aria-label={nome} className={classe}>
      {conteudo}
    </Link>
  )
}

/** Menu lateral fixo (≥ lg), recolhível; o estado inicial vem do cookie lido no servidor. */
export function MenuLateral(props: { papel: StaffRole; restaurante: string; estadoInicial: EstadoMenu; aguardando: number }) {
  const caminho = usePathname()
  const [estado, setEstado] = useState<EstadoMenu>(props.estadoInicial)
  const recolhido = estado === 'recolhido'
  const alternar = () => {
    const novo: EstadoMenu = recolhido ? 'aberto' : 'recolhido'
    setEstado(novo)
    document.cookie = cookieDoMenu(novo)
  }
  return (
    <nav
      aria-label="Menu principal"
      data-estado={estado}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card lg:flex',
        recolhido ? 'w-14' : 'w-60',
      )}
    >
      <div className={cn('flex min-h-14 items-center gap-2 border-b border-border', recolhido ? 'justify-center' : 'pl-4 pr-2')}>
        {!recolhido && <span className="min-w-0 flex-1 truncate font-semibold text-primary">{props.restaurante}</span>}
        <button
          type="button"
          onClick={alternar}
          aria-expanded={!recolhido}
          aria-label={recolhido ? 'Abrir menu' : 'Recolher menu'}
          title={recolhido ? 'Abrir menu' : 'Recolher menu'}
          className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {recolhido ? <ChevronsRight aria-hidden="true" className="size-4" /> : <ChevronsLeft aria-hidden="true" className="size-4" />}
        </button>
      </div>
      {/* recolhido: sem overflow para a dica sair à direita do menu, exceto em tela baixa (aí os itens precisam rolar) */}
      <div className={cn('flex min-h-0 flex-1 flex-col gap-1 py-2', recolhido ? 'px-1.5 [@media(max-height:640px)]:overflow-y-auto' : 'overflow-y-auto px-2')}>
        {gruposDoMenu(props.papel).map((g) => {
          const titulo = g.rotulo ? `menu-grupo-${g.id}` : undefined
          return (
            <div key={g.id} className="flex flex-col gap-0.5">
              {g.rotulo && (
                <p
                  id={titulo}
                  className={cn(
                    'px-3 pb-1 pt-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                    recolhido && 'sr-only',
                  )}
                >
                  {g.rotulo}
                </p>
              )}
              {g.rotulo && recolhido && <hr aria-hidden="true" className="mx-2 my-1 border-border" />}
              <ul aria-labelledby={titulo} className="flex flex-col gap-0.5">
                {g.itens.map((i) => (
                  <li key={i.id}>
                    <Item item={i} recolhido={recolhido} ativo={Boolean(i.href && itemAtivo(caminho, i.href))} aguardando={props.aguardando} />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
