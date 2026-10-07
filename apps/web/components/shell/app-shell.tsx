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
  /** Paleta de busca rápida (Ctrl/Cmd+K), aberta também pelo botão da barra superior. */
  busca?: React.ReactNode
  avisos?: React.ReactNode
  aguardando?: number
  /** Faixa de alertas (ex.: gastos): no topo abaixo de lg; abaixo da barra superior (TopBar) a partir de lg. Só quando há alerta. */
  faixa?: React.ReactNode
}) {
  const aguardando = props.aguardando ?? 0
  return (
    <ShellProvider valor={{ tema: props.tema, papel: props.papel, faixa: props.faixa }}>
      <div
        className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:flex lg:pb-0"
        // altura reservada da faixa (~61 px numa linha): o simulador flutuante começa abaixo dela
        style={props.faixa ? ({ '--faixa-alertas': '4rem' } as React.CSSProperties) : undefined}
      >
        <MenuLateral papel={props.papel} restaurante={props.restaurante} estadoInicial={props.menu} aguardando={aguardando} />
        <div className="min-w-0 flex-1">
          {props.faixa && <div className="lg:hidden">{props.faixa}</div>}
          {props.children}
        </div>
        {props.floating}
        {props.busca}
        {props.avisos}
        <BottomNav papel={props.papel} aguardando={aguardando} />
      </div>
    </ShellProvider>
  )
}
