'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { removerExcecao, salvarExcecao, salvarHorarios, salvarUnidade } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { coordenadasDoLink } from '@/lib/maps-link'
import { resultadoDoPainel } from '@/lib/painel-erros'
import {
  dadosUnidadeSchema, excecaoSchema, horariosSchema, type DadosUnidadeForm, type ExcecaoForm, type HorariosForm,
} from '@/lib/schemas/unidades'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa unidade.' }
const LINK_ILEGIVEL =
  'Não consegui ler a localização desse link. Abra o local no Google Maps, toque em Compartilhar → Copiar link e cole aqui.'
const idValido = (id: string) => z.uuid().safeParse(id).success
const nulo = (v: string) => (v === '' ? null : v)

function revalidarUnidade(id: string) {
  revalidatePath('/unidades')
  revalidatePath(`/unidades/${id}`)
}

export async function salvarDadosUnidadeAction(id: string | null, input: DadosUnidadeForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADA
  const p = dadosUnidadeSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const d = p.data
  let coords: { lat: number; lng: number } | null = null
  if (d.mapsUrl) {
    coords = await coordenadasDoLink(d.mapsUrl)
    if (!coords) return { ok: false, fieldErrors: { mapsUrl: LINK_ILEGIVEL } }
  }
  const r = await salvarUnidade(getDb(), s.claims, s.restaurantId, id, {
    nome: d.nome,
    endereco: nulo(d.endereco),
    bairro: nulo(d.bairro),
    cidade: nulo(d.cidade),
    uf: nulo(d.uf),
    cep: nulo(d.cep),
    telefone: nulo(d.telefone),
    apelidos: d.apelidos,
    mapsUrl: nulo(d.mapsUrl),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    ativo: d.ativo,
  })
  if (r.ok) revalidarUnidade(r.valor.id)
  return resultadoDoPainel(r, { nome_duplicado: 'nome' })
}

export async function salvarHorariosAction(unitId: string, input: HorariosForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId)) return NAO_ENCONTRADA
  const p = horariosSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarHorarios(getDb(), s.claims, s.restaurantId, unitId, p.data.semanal)
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}

export async function salvarExcecaoAction(unitId: string, input: ExcecaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId)) return NAO_ENCONTRADA
  const p = excecaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarExcecao(getDb(), s.claims, s.restaurantId, unitId, {
    data: p.data.data,
    fechado: p.data.fechado,
    turnos: p.data.turnos,
    motivo: nulo(p.data.motivo),
  })
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}

export async function removerExcecaoAction(unitId: string, data: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId) || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return NAO_ENCONTRADA
  const r = await removerExcecao(getDb(), s.claims, s.restaurantId, unitId, data)
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}
