'use server'
import { eq } from 'drizzle-orm'
import {
  abrirSimulacao, definirRelogioSimulado, detalhesSimulacao, enqueueProcess, enviarMensagemSimulada, mensagensSimuladas,
  novoClienteSimulado, schema, type EstadoSimulacao,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import {
  buscarSimuladorSchema, conversaSimuladorSchema, enviarSimuladorSchema, relogioSimuladorSchema,
} from '@/lib/schemas/simulador'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import { instanteDoHorarioLocal, MAX_DESLOCAMENTO_SEGUNDOS, type DetalheTela, type RespostaSimulador } from '@/lib/simulador-tela'

const SUMIU = 'Esta simulação não está mais disponível. Toque em "Novo cliente".'
const ENCERRADA = 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.'
const FUSO_PADRAO = 'America/Sao_Paulo'

type Sessao = Awaited<ReturnType<typeof requireStaff>>
// simulador gasta IA real: só quem responde pelos custos
const sessao = () => requireStaff(['dono', 'gerente'])
const dono = (s: Sessao) => ({ restaurantId: s.restaurantId, userId: s.userId })

function paraTela(conversationId: string, e: EstadoSimulacao): RespostaSimulador {
  return {
    conversationId,
    cursor: e.cursor,
    digitando: e.digitando,
    estado: e.estado,
    relogioOffsetSegundos: e.relogioOffsetSegundos,
    mensagens: e.mensagens.map((m) => ({
      id: m.id, direcao: m.direcao, tipo: m.tipo, texto: m.texto, payload: m.payload, criadaEm: m.createdAt.toISOString(),
    })),
  }
}

async function estado(s: Sessao, conversationId: string, desdeId: number): Promise<ActionResult<RespostaSimulador>> {
  const e = await mensagensSimuladas(getDb(), { ...dono(s), conversationId, desdeId })
  return e ? { ok: true, data: paraTela(conversationId, e) } : { ok: false, formError: SUMIU }
}

export async function abrirSimuladorAction(): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const { conversationId } = await abrirSimulacao(getDb(), dono(s))
  return estado(s, conversationId, 0)
}

export async function buscarSimuladorAction(conversationId: string, desdeId: number): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const p = buscarSimuladorSchema.safeParse({ conversationId, desdeId })
  if (!p.success) return { ok: false, formError: SUMIU }
  return estado(s, p.data.conversationId, p.data.desdeId)
}

export async function enviarSimuladorAction(conversationId: string, texto: string, interativoId: string | null): Promise<ActionResult> {
  const s = await sessao()
  const p = enviarSimuladorSchema.safeParse({ conversationId, texto, interativoId })
  if (!p.success) return actionErrorFromZod(p.error)
  const enqueue = enqueueProcess(await getBoss())
  const r = await enviarMensagemSimulada(getDb(), { ...dono(s), ...p.data }, enqueue)
  if (r === 'nao_encontrada') return { ok: false, formError: SUMIU }
  if (r === 'encerrada') return { ok: false, formError: ENCERRADA }
  return { ok: true }
}

export async function novoClienteSimuladorAction(): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const { conversationId } = await novoClienteSimulado(getDb(), dono(s))
  return estado(s, conversationId, 0)
}

export async function relogioSimuladorAction(
  conversationId: string,
  local: string | null,
): Promise<ActionResult<{ relogioOffsetSegundos: number | null }>> {
  const s = await sessao()
  const p = relogioSimuladorSchema.safeParse({ conversationId, local })
  if (!p.success) return actionErrorFromZod(p.error)
  const db = getDb()
  let offset: number | null = null
  if (p.data.local !== null) {
    const [r] = await db.select({ tz: schema.restaurants.timezone }).from(schema.restaurants).where(eq(schema.restaurants.id, s.restaurantId))
    const instante = instanteDoHorarioLocal(p.data.local, r?.tz ?? FUSO_PADRAO)
    if (!instante) return { ok: false, fieldErrors: { local: 'Essa data não existe.' } }
    offset = Math.round((instante.getTime() - Date.now()) / 1000)
    if (Math.abs(offset) > MAX_DESLOCAMENTO_SEGUNDOS) {
      return { ok: false, fieldErrors: { local: 'Escolha uma data até um ano antes ou depois de hoje.' } }
    }
  }
  const r = await definirRelogioSimulado(db, { ...dono(s), conversationId: p.data.conversationId, offsetSegundos: offset })
  return r === 'ok' ? { ok: true, data: { relogioOffsetSegundos: offset } } : { ok: false, formError: SUMIU }
}

export async function detalhesSimuladorAction(conversationId: string): Promise<ActionResult<DetalheTela[]>> {
  const s = await sessao()
  const p = conversaSimuladorSchema.safeParse({ conversationId })
  if (!p.success) return { ok: false, formError: SUMIU }
  const d = await detalhesSimulacao(getDb(), s.claims, { ...dono(s), conversationId: p.data.conversationId })
  if (!d) return { ok: false, formError: SUMIU }
  return {
    ok: true,
    data: d.map((x) => ({
      id: x.id, etapa: x.etapa, modelo: x.modelo, promptVersion: x.promptVersion, intent: x.intent, resultado: x.resultado,
      erro: x.erro, costUsd: x.costUsd, latenciaMs: x.latenciaMs, itensValidos: x.itensValidos,
      itensRespondidos: x.itensRespondidos, criadaEm: x.createdAt.toISOString(),
    })),
  }
}
