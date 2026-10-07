'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { agoraLocal } from '@atd/core/s1'
import { cancelarAvisoPainel, carregarUnidadesPainel, criarAvisoPainel } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { hojeLocal, validarAvisoNaUnidade } from '@/lib/previsao'
import { avisoSchema, type AvisoForm } from '@/lib/schemas/avisos'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const INDISPONIVEL = { ok: false as const, formError: 'Esse aviso não está mais disponível.' }

function revalidar() {
  revalidatePath('/agenda')
  revalidatePath('/')
}

export async function criarAvisoAction(input: AvisoForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  const p = avisoSchema(hojeLocal(new Date())).safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const v = p.data
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  // a RLS já esconde unidades fora do acesso; o insert não confere se a unidade está ativa nem aberta
  const unidade = unidades.find((u) => u.id === v.unitId && u.ativo)
  if (!unidade) return { ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } }
  const erros = validarAvisoNaUnidade(unidade, v.data, v.horario, restaurante.politicaFeriado, agoraLocal(new Date(), restaurante.timezone))
  if (erros) return { ok: false, fieldErrors: erros }
  const r = await criarAvisoPainel(getDb(), s.claims, {
    unitId: v.unitId, data: v.data, pessoas: v.pessoas, horarioAprox: v.horario === '' ? null : v.horario, nome: v.nome === '' ? null : v.nome,
  })
  if (!r.ok) {
    if (r.erro === 'lotado') {
      return { ok: false, formError: `A unidade está lotada nesse dia. ${r.vagas === 1 ? 'Resta 1 vaga' : `Restam ${r.vagas} vagas`}.` }
    }
    if (r.erro === 'transicao_invalida' || r.erro === 'duplicada') return INDISPONIVEL
    return resultadoDoPainel({ ok: false, erro: r.erro })
  }
  revalidar()
  return resultadoDoPainel(r)
}

export async function cancelarAvisoAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!z.uuid().safeParse(id).success) return INDISPONIVEL
  const r = await cancelarAvisoPainel(getDb(), s.claims, id)
  if (r.ok) revalidar()
  // gerente em outra unidade: a RLS esconde, vira "não encontrada"
  if (!r.ok && r.erro === 'nao_encontrada') return INDISPONIVEL
  return resultadoDoPainel(r)
}
