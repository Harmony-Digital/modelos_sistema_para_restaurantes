'use client'
import { BookOpen, CalendarDays, House, Menu, MessagesSquare } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITENS = [
  { href: '/', label: 'Início', icon: House },
  { href: '/conversas', label: 'Conversas', icon: MessagesSquare },
  { href: '/agenda', label: 'Agenda', icon: CalendarDays },
  { href: '/conteudo', label: 'Conteúdo', icon: BookOpen },
  { href: '/mais', label: 'Mais', icon: Menu },
] as const

/** `aguardando`: conversas reais esperando atendente (contador no ícone de Conversas). */
export function BottomNav({ aguardando = 0 }: { aguardando?: number }) {
  const path = usePathname()
  const ativo = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'))
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {ITENS.map(({ href, label, icon: Icon }) => {
          const on = ativo(href)
          const contador = href === '/conversas' && aguardando > 0 ? aguardando : 0
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                aria-label={contador > 0 ? `${label}, ${contador} aguardando` : undefined}
                className={cn(
                  'relative flex min-h-16 focus-visible:outline-offset-[-2px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-150',
                  on ? 'text-link' : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
                )}
              >
                {on && <span aria-hidden="true" className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />}
                <span className="relative">
                  <Icon aria-hidden="true" className="size-6" strokeWidth={on ? 2.25 : 1.75} />
                  {contador > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-none text-destructive-foreground"
                    >
                      {contador > 99 ? '99+' : contador}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
