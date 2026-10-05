import Link from 'next/link'
import { cn } from '@/lib/utils'

export function Abas({ rotulo, itens }: { rotulo: string; itens: { href: string; rotulo: string; ativo: boolean }[] }) {
  return (
    <nav aria-label={rotulo} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-1">
        {itens.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.ativo ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150',
                i.ativo ? 'bg-secondary text-foreground' : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
              )}
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
