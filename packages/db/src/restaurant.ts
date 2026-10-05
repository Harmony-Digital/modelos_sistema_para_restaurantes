import type { Db } from './client.ts'
import { restaurants } from './schema/restaurant.ts'

let cachedId: string | undefined

/** Projeto de um restaurante só (PRD §1.2). Lança se o banco tiver 0 ou >1. */
export async function getSingleRestaurantId(db: Db): Promise<string> {
  if (cachedId) return cachedId
  const rows = await db.select({ id: restaurants.id }).from(restaurants).limit(2)
  if (rows.length !== 1) throw new Error(`Esperado exatamente 1 restaurante; encontrado ${rows.length}`)
  cachedId = rows[0]!.id
  return cachedId
}
