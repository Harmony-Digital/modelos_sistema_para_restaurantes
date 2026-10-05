'use client'
import { House, Menu, MessageSquareText, Store } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITENS = [
  { href: '/', label: 'Início', icon: House },
  { href: '/unidades', label: 'Unidades', icon: Store },
  { href: '/respostas', label: 'Respostas', icon: MessageSquareText },
  { href: '/mais', label: 'Mais', icon: Menu },
] as const

export function BottomNav() {
  const path = usePathname()
  const ativo = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'))
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {ITENS.map(({ href, label, icon: Icon }) => {
          const on = ativo(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-16 focus-visible:outline-offset-[-2px] flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150',
                  on ? 'text-link' : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
                )}
              >
                {on && <span aria-hidden="true" className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />}
                <Icon aria-hidden="true" className="size-6" strokeWidth={on ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
