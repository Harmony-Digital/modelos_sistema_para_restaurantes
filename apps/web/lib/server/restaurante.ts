import 'server-only'
import { getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { urlPublicaLogo } from '@/lib/logo'
import { getDb } from './db'

/** Nome, fuso e URL pública da logo do restaurante (casca do painel e Ajustes); uma leitura por requisição. */
export const lerRestauranteDoPainel = cache(async (): Promise<{ nome: string; timezone: string; logo: string | null }> => {
  const db = getDb()
  const [r] = await db
    .select({ nome: schema.restaurants.nome, timezone: schema.restaurants.timezone, logoPath: schema.restaurants.logoPath })
    .from(schema.restaurants)
    .where(eq(schema.restaurants.id, await getSingleRestaurantId(db)))
  return { nome: r?.nome ?? 'Restaurante', timezone: r?.timezone ?? 'America/Sao_Paulo', logo: urlPublicaLogo(r?.logoPath ?? null) }
})
