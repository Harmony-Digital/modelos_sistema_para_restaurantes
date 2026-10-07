'use server'
import { buscarNoPainel } from '@atd/db'
import { z } from 'zod'
import type { ActionResult } from '@/lib/action-result'
import type { ResultadoBusca } from '@/lib/busca-rapida'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

const termoSchema = z.string().max(200)

/**
 * Busca rápida (Ctrl+K): qualquer papel do painel, com a RLS do próprio usuário (gerente restrito só acha as unidades
 * dele). O termo não vai para log.
 */
export async function buscarNoPainelAction(termo: unknown): Promise<ActionResult<ResultadoBusca[]>> {
  const s = await requireStaff()
  const t = termoSchema.safeParse(termo)
  if (!t.success) return { ok: false, formError: 'Busca inválida.' }
  return { ok: true, data: await buscarNoPainel(getDb(), s.claims, t.data) }
}
