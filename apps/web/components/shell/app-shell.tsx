import type { StaffRole } from '@/lib/access'
import type { EstadoMenu } from '@/lib/menu'
import type { Tema } from '@/lib/theme'
import { ShellProvider } from './acoes-barra'
import { BottomNav } from './bottom-nav'
import { MenuLateral } from './menu-lateral'

/** < lg: barra inferior; ≥ lg: menu lateral fixo e o conteúdo na largura que sobra. */
export function AppShell(props: {
  children: React.ReactNode
  papel: StaffRole
  restaurante: string
  tema: Tema
  menu: EstadoMenu
  floating?: React.ReactNode
  avisos?: React.ReactNode
  aguardando?: number
  /** Faixa no topo de todas as telas (ex.: alerta de gastos). */
  faixa?: React.ReactNode
}) {
  const aguardando = props.aguardando ?? 0
  return (
    <ShellProvider valor={{ tema: props.tema, papel: props.papel }}>
      <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:flex lg:pb-0">
        <MenuLateral papel={props.papel} restaurante={props.restaurante} estadoInicial={props.menu} aguardando={aguardando} />
        <div className="min-w-0 flex-1">
          {props.faixa}
          {props.children}
        </div>
        {props.floating}
        {props.avisos}
        <BottomNav papel={props.papel} aguardando={aguardando} />
      </div>
    </ShellProvider>
  )
}
