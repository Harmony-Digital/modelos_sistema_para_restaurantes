'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { encryptPhone } from '@atd/core'
import { agoraLocal } from '@atd/core/s1'
import { carregarUnidadesPainel, criarAvisoPainel, mudarStatusReserva, revelarContatoReserva, type StatusReserva } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { hojeLocal, validarAvisoNaUnidade } from '@/lib/previsao'
import { reservaSchema, statusReservaSchema, type ReservaForm } from '@/lib/schemas/avisos'
import { getDb } from '@/lib/server/db'
import { env } from '@/lib/server/env'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const INDISPONIVEL = { ok: false as const, formError: 'Essa reserva não está mais disponível.' }

function revalidar() {
  revalidatePath('/agenda')
  revalidatePath('/')
}

const lotado = (vagas: number) => ({
  ok: false as const,
  formError: `A unidade está lotada nesse dia. ${vagas === 0 ? 'Não resta nenhuma vaga' : vagas === 1 ? 'Resta 1 vaga' : `Restam ${vagas} vagas`}.`,
})

/** Reserva pelo painel (dono/gerente): nome e horário obrigatórios; contato opcional, cifrado aqui (nunca em claro no banco). */
export async function criarReservaAction(input: ReservaForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  const p = reservaSchema(hojeLocal(new Date())).safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const v = p.data
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  // a RLS já esconde unidades fora do acesso; o insert não confere se a unidade está ativa nem aberta
  const unidade = unidades.find((u) => u.id === v.unitId && u.ativo)
  if (!unidade) return { ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } }
  const erros = validarAvisoNaUnidade(unidade, v.data, v.horario, restaurante.politicaFeriado, agoraLocal(new Date(), restaurante.timezone))
  if (erros) return { ok: false, fieldErrors: erros }
  const r = await criarAvisoPainel(getDb(), s.claims, {
    unitId: v.unitId, data: v.data, pessoas: v.pessoas, horario: v.horario, nome: v.nome,
    contatoCifrado: v.contato === null ? null : encryptPhone(v.contato, env().phoneKey),
  })
  if (!r.ok) {
    if (r.erro === 'lotado') return lotado(r.vagas)
    if (r.erro === 'transicao_invalida' || r.erro === 'duplicada') return INDISPONIVEL
    return resultadoDoPainel({ ok: false, erro: r.erro })
  }
  revalidar()
  return resultadoDoPainel(r)
}

/**
 * Confirmada, Cancelada ou Não veio (dono/gerente da unidade; auditado na DAL). Reconfirmar passa pela lotação do dia:
 * sem vaga, nada muda e a mensagem diz quantas vagas restam.
 */
export async function mudarStatusReservaAction(id: string, status: StatusReserva): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!z.uuid().safeParse(id).success) return INDISPONIVEL
  const st = statusReservaSchema.safeParse(status)
  if (!st.success) return { ok: false, formError: 'Escolha confirmada, cancelada ou não veio.' }
  const r = await mudarStatusReserva(getDb(), s.claims, id, st.data)
  if (r.ok) {
    revalidar()
    return { ok: true, data: null }
  }
  if (r.erro === 'lotado') return lotado(r.vagas)
  if (r.erro === 'transicao_invalida') {
    return { ok: false, formError: 'Confirmada e Cancelada valem de hoje em diante; Não veio, só no dia da reserva ou depois.' }
  }
  if (r.erro === 'duplicada') return { ok: false, formError: 'O cliente já tem outra reserva confirmada nessa unidade e nesse dia.' }
  // gerente em outra unidade: a RLS esconde, vira "não encontrada"
  if (r.erro === 'nao_encontrada') return INDISPONIVEL
  return resultadoDoPainel({ ok: false, erro: r.erro })
}

/** "Ver contato": o número só existe aqui (nunca nas props da página). Cada chamada é auditada no banco. */
export async function revelarContatoReservaAction(id: string): Promise<ActionResult<{ telefone: string; origem: 'informado' | 'whatsapp' }>> {
  const s = await requireStaff()
  if (!z.uuid().safeParse(id).success) return INDISPONIVEL
  const r = await revelarContatoReserva(getDb(), s.claims, id, env().phoneKey)
  if (!r.ok && r.erro === 'nao_encontrada') return INDISPONIVEL
  return resultadoDoPainel(r)
}
