'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { MODELOS_S1, type ChaveModelo } from '@atd/core'
import { ignorarLacuna, removerFato, responderLacuna, restaurarModelo, salvarFato, salvarModelo } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { fatoSchema, modeloSchema, type FatoForm, type ModeloForm } from '@/lib/schemas/respostas'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADO = { ok: false as const, formError: 'Não encontramos esse item.' }
const idValido = (id: string) => z.uuid().safeParse(id).success
const ehChave = (c: string): c is ChaveModelo => Object.hasOwn(MODELOS_S1, c)

function revalidar() {
  revalidatePath('/conteudo')
  revalidatePath('/')
}

function paraFato(f: z.output<typeof fatoSchema>) {
  return { tema: f.tema, exemplos: f.exemplos, texto: f.texto, unitId: f.unitId === '' ? null : f.unitId, ativo: f.ativo }
}

export async function responderLacunaAction(lacunaId: string, input: FatoForm): Promise<ActionResult<{ factId: string }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(lacunaId)) return NAO_ENCONTRADO
  const p = fatoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await responderLacuna(getDb(), s.claims, s.restaurantId, lacunaId, paraFato(p.data))
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function ignorarLacunaAction(lacunaId: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(lacunaId)) return NAO_ENCONTRADO
  const r = await ignorarLacuna(getDb(), s.claims, s.restaurantId, lacunaId)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function salvarFatoAction(id: string | null, input: FatoForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADO
  const p = fatoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarFato(getDb(), s.claims, s.restaurantId, id, paraFato(p.data))
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function removerFatoAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADO
  const r = await removerFato(getDb(), s.claims, s.restaurantId, id)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function salvarModeloAction(chave: string, input: ModeloForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!ehChave(chave)) return { ok: false, formError: 'Modelo desconhecido.' }
  const p = modeloSchema(chave).safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarModelo(getDb(), s.claims, s.restaurantId, chave, p.data.texto)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function restaurarModeloAction(chave: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!ehChave(chave)) return { ok: false, formError: 'Modelo desconhecido.' }
  const r = await restaurarModelo(getDb(), s.claims, s.restaurantId, chave)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}
