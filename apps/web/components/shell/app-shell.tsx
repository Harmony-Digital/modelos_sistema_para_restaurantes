import { BottomNav } from './bottom-nav'

export function AppShell(props: { children: React.ReactNode; floating?: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      {props.children}
      {props.floating}
      <BottomNav />
    </div>
  )
}
