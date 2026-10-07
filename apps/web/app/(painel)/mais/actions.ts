'use server'
import { revalidatePath } from 'next/cache'
import { salvarModoDemonstracao, salvarRestaurante } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { modoDemonstracaoSchema, restauranteSchema, type ModoDemonstracaoForm, type RestauranteForm } from '@/lib/schemas/restaurante'
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

/** Modo demonstração: só o dono; muda o que todas as telas mostram, então revalida o painel inteiro. */
export async function salvarModoDemonstracaoAction(input: ModoDemonstracaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = modoDemonstracaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarModoDemonstracao(getDb(), s.claims, s.restaurantId, p.data.ligado)
  if (r.ok) revalidatePath('/', 'layout')
  return resultadoDoPainel(r)
}
