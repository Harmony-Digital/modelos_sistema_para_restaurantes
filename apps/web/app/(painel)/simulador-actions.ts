'use server'
import { eq } from 'drizzle-orm'
import {
  abrirSimulacao, definirRelogioSimulado, detalhesSimulacao, enqueueProcess, enviarMensagemSimulada, listarCardapio,
  mensagensSimuladas, novoClienteSimulado, schema, type EstadoSimulacao,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import {
  buscarSimuladorSchema, conversaSimuladorSchema, enviarSimuladorSchema, relogioSimuladorSchema,
} from '@/lib/schemas/simulador'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import {
  arquivoDaMensagem, instanteDoHorarioLocal, MAX_DESLOCAMENTO_SEGUNDOS, type DetalheTela, type MensagemTela, type RespostaSimulador,
} from '@/lib/simulador-tela'
import { createClient } from '@/lib/supabase/server'

const SUMIU = 'Esta simulação não está mais disponível. Toque em "Novo cliente".'
const ENCERRADA = 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.'
const FUSO_PADRAO = 'America/Sao_Paulo'
/** URL assinada do arquivo do cardápio no simulador: curta (o balão a usa logo). */
const MIDIA_SEGUNDOS = 600

type Sessao = Awaited<ReturnType<typeof requireStaff>>
// simulador gasta IA real: só quem responde pelos custos
const sessao = () => requireStaff(['dono', 'gerente'])
const dono = (s: Sessao) => ({ restaurantId: s.restaurantId, userId: s.userId })

/**
 * Título e URL assinada curta dos arquivos do cardápio citados nas mensagens. Só arquivos que a RLS deixa o usuário ver
 * (lidos com as claims dele) e URL gerada com o cliente Supabase do próprio usuário (policies do Storage).
 */
async function midiasDasMensagens(s: Sessao, mensagens: readonly MensagemTela[]): Promise<Map<string, NonNullable<MensagemTela['midia']>>> {
  const ids = new Set(mensagens.map(arquivoDaMensagem).filter((id): id is string => id !== null))
  const out = new Map<string, NonNullable<MensagemTela['midia']>>()
  if (ids.size === 0) return out
  const { arquivos } = await listarCardapio(getDb(), s.claims)
  const supabase = await createClient()
  for (const a of arquivos.filter((x) => ids.has(x.id))) {
    const [bucket, ...resto] = a.storagePath.split('/')
    const { data, error } = bucket
      ? await supabase.storage.from(bucket).createSignedUrl(resto.join('/'), MIDIA_SEGUNDOS)
      : { data: null, error: true }
    out.set(a.id, { titulo: a.titulo, url: error || !data ? null : data.signedUrl })
  }
  return out
}

async function paraTela(s: Sessao, conversationId: string, e: EstadoSimulacao): Promise<RespostaSimulador> {
  const mensagens: MensagemTela[] = e.mensagens.map((m) => ({
    id: m.id, direcao: m.direcao, tipo: m.tipo, texto: m.texto, payload: m.payload, criadaEm: m.createdAt.toISOString(),
  }))
  const midias = await midiasDasMensagens(s, mensagens)
  return {
    conversationId,
    cursor: e.cursor,
    digitando: e.digitando,
    estado: e.estado,
    relogioOffsetSegundos: e.relogioOffsetSegundos,
    limiteSimulacao: e.limiteSimulacao,
    mensagens: mensagens.map((m) => {
      const id = arquivoDaMensagem(m)
      const midia = id ? midias.get(id) : undefined
      return midia ? { ...m, midia } : m
    }),
  }
}

async function estado(s: Sessao, conversationId: string, desdeId: number): Promise<ActionResult<RespostaSimulador>> {
  const e = await mensagensSimuladas(getDb(), { ...dono(s), conversationId, desdeId })
  return e ? { ok: true, data: await paraTela(s, conversationId, e) } : { ok: false, formError: SUMIU }
}

export async function abrirSimuladorAction(): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  // o simulador gasta IA real: a DAL grava a auditoria (com as claims) na mesma transação da mudança
  const { conversationId } = await abrirSimulacao(getDb(), dono(s), s.claims)
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
  const { conversationId } = await novoClienteSimulado(getDb(), dono(s), s.claims)
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
  const r = await definirRelogioSimulado(db, { ...dono(s), conversationId: p.data.conversationId, offsetSegundos: offset }, s.claims)
  if (r !== 'ok') return { ok: false, formError: SUMIU }
  return { ok: true, data: { relogioOffsetSegundos: offset } }
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
