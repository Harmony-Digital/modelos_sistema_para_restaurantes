'use server'
import { revalidatePath } from 'next/cache'
import { salvarModoDemonstracao, salvarRegrasReserva, salvarRestaurante } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import {
  modoDemonstracaoSchema, regrasReservaSchema, restauranteSchema, type ModoDemonstracaoForm, type RegrasReservaForm, type RestauranteForm,
} from '@/lib/schemas/restaurante'
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

/** Regras enviadas depois de confirmar a reserva: dono e gerente (o gerente só altera estas colunas, por gatilho no banco). */
export async function salvarRegrasReservaAction(input: RegrasReservaForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono', 'gerente'])
  const p = regrasReservaSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarRegrasReserva(getDb(), s.claims, s.restaurantId, p.data.texto)
  if (r.ok) {
    revalidatePath('/ajustes')
    return { ok: true, data: null }
  }
  if (r.erro === 'valor_invalido') return { ok: false, fieldErrors: { texto: 'Use de 1 a 600 caracteres.' } }
  return resultadoDoPainel({ ok: false, erro: r.erro })
}
