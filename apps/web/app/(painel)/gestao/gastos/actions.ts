'use server'
import { revalidatePath } from 'next/cache'
import { salvarCotacao, salvarLimite, type ResultadoGastos } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { cotacaoSchema, limiteSchema, type CotacaoForm, type LimiteForm } from '@/lib/schemas/gastos'
import { getDb } from '@/lib/server/db'

const VALOR_INVALIDO = 'Confira os valores informados.'

function resultado(r: ResultadoGastos, campo?: string): ActionResult<null> {
  if (r.ok) return { ok: true, data: null }
  if (r.erro === 'valor_invalido') {
    return campo ? { ok: false, fieldErrors: { [campo]: VALOR_INVALIDO } } : { ok: false, formError: VALOR_INVALIDO }
  }
  return resultadoDoPainel({ ok: false, erro: r.erro })
}

/** Só o dono. Limite em US$ (> 0 e ≤ 10.000) e alerta em % (1–100); o banco audita o antes/depois. */
export async function salvarLimiteAction(input: LimiteForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = limiteSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarLimite(getDb(), s.claims, p.data)
  // a faixa de alerta e o quadro do Início dependem do limite: revalida o painel todo
  if (r.ok) revalidatePath('/', 'layout')
  return resultado(r)
}

/** Só o dono. Cotação US$ → R$ (só exibição), entre 0,50 e 50. */
export async function salvarCotacaoAction(input: CotacaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = cotacaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarCotacao(getDb(), s.claims, p.data.cotacao)
  if (r.ok) revalidatePath('/', 'layout')
  return resultado(r, 'cotacao')
}
