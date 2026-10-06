'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { carregarUnidadesPainel, removerExcecao, salvarEspaco, salvarExcecao, salvarHorarios, salvarUnidade } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { coordenadasDoLink } from '@/lib/maps-link'
import { resultadoDoPainel } from '@/lib/painel-erros'
import {
  dadosUnidadeSchema, excecaoSchema, horariosSchema, type DadosUnidadeForm, type ExcecaoForm, type HorariosForm,
} from '@/lib/schemas/unidades'
import { espacoSchema, type EspacoForm } from '@/lib/schemas/espacos'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa unidade.' }
const AVISO_SEM_LOCALIZACAO =
  'Link salvo, mas não consegui ler a localização exata; o cartão de localização não será enviado.'
const idValido = (id: string) => z.uuid().safeParse(id).success
const nulo = (v: string) => (v === '' ? null : v)

function revalidarUnidade(id: string) {
  revalidatePath('/unidades')
  revalidatePath(`/unidades/${id}`)
}

export async function salvarDadosUnidadeAction(id: string | null, input: DadosUnidadeForm): Promise<ActionResult<{ id: string; aviso?: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADA
  const p = dadosUnidadeSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const d = p.data
  const mapsUrl = nulo(d.mapsUrl)
  let coords: { lat: number; lng: number } | null = null
  let aviso: string | undefined
  if (mapsUrl) {
    const gravada = id === null ? undefined : (await carregarUnidadesPainel(getDb(), s.claims)).unidades.find((u) => u.id === id)
    if (gravada && gravada.mapsUrl === mapsUrl) {
      // Link inalterado: preserva o que já foi lido, sem ir à rede.
      coords = gravada.lat !== null && gravada.lng !== null ? { lat: gravada.lat, lng: gravada.lng } : null
    } else {
      coords = await coordenadasDoLink(mapsUrl)
      if (!coords) aviso = AVISO_SEM_LOCALIZACAO
    }
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
    mapsUrl,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    ativo: d.ativo,
  })
  if (r.ok) revalidarUnidade(r.valor.id)
  const resultado = resultadoDoPainel(r, { nome_duplicado: 'nome' })
  return resultado.ok && aviso && resultado.data ? { ok: true, data: { ...resultado.data, aviso } } : resultado
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

const MSG_ESPACO_REPETIDO = 'Já existe um espaço com esse nome nesta unidade.'
const MSG_CAPACIDADE = 'Confira as capacidades: de 1 a 1000, com o mínimo não maior que o máximo.'

/** `espacoId` nulo cria; senão edita. Desativar é editar com `ativo: false`. */
export async function salvarEspacoAction(unitId: string, espacoId: string | null, input: EspacoForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId) || (espacoId !== null && !idValido(espacoId))) return NAO_ENCONTRADA
  const p = espacoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarEspaco(getDb(), s.claims, espacoId, {
    unitId, nome: p.data.nome, capacidadeMin: p.data.capacidadeMin, capacidadeMax: p.data.capacidadeMax,
    descricao: nulo(p.data.descricao), condicoes: nulo(p.data.condicoes), ativo: p.data.ativo,
  })
  if (r.ok) {
    revalidarUnidade(unitId)
    return { ok: true, data: r.valor }
  }
  if (r.erro === 'nome_duplicado') return { ok: false, fieldErrors: { nome: MSG_ESPACO_REPETIDO } }
  if (r.erro === 'capacidade_invalida') return { ok: false, formError: MSG_CAPACIDADE }
  return resultadoDoPainel(r)
}
