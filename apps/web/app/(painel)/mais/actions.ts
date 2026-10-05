'use server'
import { revalidatePath } from 'next/cache'
import { salvarRestaurante } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { restauranteSchema, type RestauranteForm } from '@/lib/schemas/restaurante'
import { getDb } from '@/lib/server/db'

export async function salvarRestauranteAction(input: RestauranteForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = restauranteSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarRestaurante(getDb(), s.claims, s.restaurantId, {
    nome: p.data.nome,
    politicaFeriado: p.data.politicaFeriado,
    politicaUrl: p.data.politicaUrl === '' ? null : p.data.politicaUrl,
  })
  if (r.ok) revalidatePath('/', 'layout')
  return resultadoDoPainel(r)
}
