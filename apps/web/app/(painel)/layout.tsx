import { getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { AppShell } from '@/components/shell/app-shell'
import { SimulatorLauncher } from '@/components/simulator/launcher'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()
  const db = getDb()
  const [r] = await db.select({ nome: schema.restaurants.nome }).from(schema.restaurants)
    .where(eq(schema.restaurants.id, await getSingleRestaurantId(db)))
  return <AppShell floating={<SimulatorLauncher restaurante={r?.nome ?? 'Restaurante'} />}>{children}</AppShell>
}
