'use client'
import { CircleUser, LogOut, Moon, Search, Sun } from 'lucide-react'
import Link from 'next/link'
import { createContext, useContext } from 'react'
import { setTheme, signOut } from '@/app/(painel)/actions'
import type { StaffRole } from '@/lib/access'
import type { Tema } from '@/lib/theme'
import { abrirBusca } from './abrir-busca'
import { LogoRestaurante } from './logo-restaurante'

/** `faixa`: alertas do painel (ex.: gastos), mostrados abaixo da barra superior a partir de lg. */
type ValorShell = { tema: Tema; papel: StaffRole; faixa?: React.ReactNode; marca?: { nome: string; logo: string | null } }
const ShellContexto = createContext<ValorShell | null>(null)

/** Posto pelo AppShell: a barra superior de cada tela lê tema e papel daqui. */
export function ShellProvider(props: { valor: ValorShell; children: React.ReactNode }) {
  return <ShellContexto.Provider value={props.valor}>{props.children}</ShellContexto.Provider>
}

const PAPEL = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' } as const
const ICONE = 'flex size-11 items-center justify-center rounded-md text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'

/**
 * Faixa de alertas logo abaixo da barra superior (≥ lg, spec §2). Abaixo de lg o AppShell a mantém no topo da tela,
 * onde ela cobre o recuo do notch.
 */
export function FaixaDaBarra() {
  const shell = useContext(ShellContexto)
  if (!shell?.faixa) return null
  // contexto de empilhamento próprio: o z-40 da faixa não passa por cima da barra fixa ao rolar
  return <div className="relative z-20 hidden shrink-0 lg:block">{shell.faixa}</div>
}

/** Topo do celular (< lg): logo de 24 px e nome do restaurante acima do título. Sem logo, nada (a barra fica como antes). */
export function MarcaDaBarra() {
  const marca = useContext(ShellContexto)?.marca
  if (!marca?.logo) return null
  return (
    <div className="flex min-w-0 items-center gap-1.5 lg:hidden">
      <LogoRestaurante url={marca.logo} nome={marca.nome} tamanho={24} />
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{marca.nome}</span>
    </div>
  )
}

/** Lado direito da barra superior (≥ lg): busca rápida, tema e conta. Abaixo de lg isso fica em Ajustes. */
export function AcoesBarra() {
  const shell = useContext(ShellContexto)
  if (!shell) return null
  const outro: Tema = shell.tema === 'escuro' ? 'claro' : 'escuro'
  return (
    <div role="group" aria-label="Ações do painel" className="hidden shrink-0 items-center gap-1 lg:flex">
      <button
        type="button"
        onClick={abrirBusca}
        aria-keyshortcuts="Control+K Meta+K"
        className="mr-2 flex h-11 w-56 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Search aria-hidden="true" className="size-4" />
        <span>Busca rápida</span>
        <kbd aria-hidden="true" className="ml-auto font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <form action={setTheme}>
        <input type="hidden" name="tema" value={outro} />
        <button type="submit" aria-label={`Usar tema ${outro}`} title={`Usar tema ${outro}`} className={ICONE}>
          {outro === 'claro' ? <Sun aria-hidden="true" className="size-5" /> : <Moon aria-hidden="true" className="size-5" />}
        </button>
      </form>
      <Link href="/ajustes" aria-label={`Conta e ajustes (${PAPEL[shell.papel]})`} title={`Você entrou como ${PAPEL[shell.papel]}`} className={ICONE}>
        <CircleUser aria-hidden="true" className="size-5" />
      </Link>
      <form action={signOut}>
        <button type="submit" aria-label="Sair" title="Sair" className={ICONE}>
          <LogOut aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  )
}
