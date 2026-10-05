import { AppShell } from '@/components/shell/app-shell'
import { requireStaff } from '@/lib/dal'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()
  return <AppShell>{children}</AppShell>
}
