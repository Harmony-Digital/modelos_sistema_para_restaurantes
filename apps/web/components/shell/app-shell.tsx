import { BottomNav } from './bottom-nav'

export function AppShell(props: { children: React.ReactNode; floating?: React.ReactNode; avisos?: React.ReactNode; aguardando?: number }) {
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      {props.children}
      {props.floating}
      {props.avisos}
      <BottomNav aguardando={props.aguardando ?? 0} />
    </div>
  )
}
