'use client'
import { Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { abrirSimulador } from '@/components/simulator/abrir'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { StaffRole } from '@/lib/access'
import { itemAtivo, navegacaoInferior } from '@/lib/navegacao'
import { cn } from '@/lib/utils'
import { ContadorAguardando } from './contador'

const BOTAO = 'relative flex min-h-16 w-full focus-visible:outline-offset-[-2px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150'
const COR = (on: boolean) => (on ? 'text-link' : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground')
const Marca = () => <span aria-hidden="true" className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />

/** Barra inferior (< lg): 4 destinos e a folha "Mais" com o restante do menu (mesma configuração do menu lateral). */
export function BottomNav({ papel, aguardando = 0 }: { papel: StaffRole; aguardando?: number }) {
  const path = usePathname()
  const [folha, setFolha] = useState(false)
  const { principais, mais } = navegacaoInferior(papel)
  const maisAtivo = mais.some((i) => i.href && itemAtivo(path, i.href))
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {principais.map(({ id, href, rotulo, icone: Icon, contador: tipo }) => {
          const on = itemAtivo(path, href!)
          const contador = tipo === 'aguardando' ? aguardando : 0
          return (
            <li key={id}>
              <Link
                href={href!}
                aria-current={on ? 'page' : undefined}
                aria-label={contador > 0 ? `${rotulo}, ${contador} aguardando` : undefined}
                className={cn(BOTAO, COR(on))}
              >
                {on && <Marca />}
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" strokeWidth={on ? 2.25 : 1.75} />
                  <ContadorAguardando valor={contador} className="absolute -right-2.5 -top-1.5" />
                </span>
                {rotulo}
              </Link>
            </li>
          )
        })}
        <li>
          <button type="button" aria-current={maisAtivo ? 'page' : undefined} onClick={() => setFolha(true)} className={cn(BOTAO, COR(maisAtivo))}>
            {maisAtivo && <Marca />}
            <Menu aria-hidden="true" className="size-6" strokeWidth={maisAtivo ? 2.25 : 1.75} />
            Mais
          </button>
        </li>
      </ul>
      <Sheet open={folha} onOpenChange={setFolha}>
        <SheetContent side="bottom" className="gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="px-0">
            <SheetTitle>Mais</SheetTitle>
            <SheetDescription className="sr-only">Outras telas do painel</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1">
            {mais.map((i) => {
              const Icone = i.icone
              const on = Boolean(i.href && itemAtivo(path, i.href))
              const classe = cn(
                'flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-foreground [@media(hover:hover)]:hover:bg-accent',
                on && 'bg-accent shadow-[inset_3px_0_0_var(--primary)]',
              )
              const conteudo = <><Icone aria-hidden="true" className="size-5 text-muted-foreground" />{i.rotulo}</>
              return (
                <li key={i.id}>
                  {i.acao === 'simulador' ? (
                    <button type="button" className={classe} onClick={() => { setFolha(false); abrirSimulador() }}>{conteudo}</button>
                  ) : (
                    <Link href={i.href!} className={classe} onClick={() => setFolha(false)}>{conteudo}</Link>
                  )}
                </li>
              )
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  )
}
