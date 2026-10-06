'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { listarRespostasRapidas, salvarHorarioHumano, salvarRespostaRapida } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import {
  horarioHumanoFormSchema, MAX_RESPOSTAS_ATIVAS, respostaRapidaSchema, type HorarioHumanoForm, type RespostaRapidaForm,
} from '@/lib/schemas/atendimento'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa resposta.' }

/** Só o dono. Sem nenhum turno = a equipe não promete horário ao cliente. */
export async function salvarHorarioHumanoAction(input: HorarioHumanoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = horarioHumanoFormSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarHorarioHumano(getDb(), s.claims, p.data)
  if (r.ok) revalidatePath('/mais/atendimento-humano')
  return resultadoDoPainel(r)
}

/** Dono/gerente criam e editam (inclusive ativar/desativar); atendente só consulta. */
export async function salvarRespostaRapidaAction(id: string | null, input: RespostaRapidaForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !z.uuid().safeParse(id).success) return NAO_ENCONTRADA
  const p = respostaRapidaSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const db = getDb()
  // a ordem não aparece no formulário: nova vai para o fim; editada mantém a posição
  const atuais = await listarRespostasRapidas(db, s.claims)
  const existente = id === null ? undefined : atuais.find((r) => r.id === id)
  if (id !== null && !existente) return NAO_ENCONTRADA
  const ordem = existente ? existente.ordem : atuais.reduce((m, r) => Math.max(m, r.ordem), 0) + 1
  const r = await salvarRespostaRapida(db, s.claims, id, { ...p.data, ordem })
  if (!r.ok && r.erro === 'limite') {
    return { ok: false, formError: `Você já tem ${MAX_RESPOSTAS_ATIVAS} respostas rápidas ativas. Desative uma para ativar outra.` }
  }
  if (r.ok) {
    revalidatePath('/conteudo')
    revalidatePath('/conversas')
  }
  return resultadoDoPainel(r)
}
