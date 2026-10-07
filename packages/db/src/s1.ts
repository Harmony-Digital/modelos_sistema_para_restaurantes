import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  agoraLocal, MODELOS_S1, somarDias, validarModelo,
  type ChaveModelo, type ContextoS1, type Lacuna, type Turno, type UnidadeS1,
} from '@atd/core'
import type { Db } from './client.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { aiRuns } from './schema/ops.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { knowledgeFacts, knowledgeGaps, replyTemplates, unitHourExceptions, unitHours } from './schema/s1.ts'

const MAX_FATOS = 500
const FUSO_PADRAO = 'America/Sao_Paulo'
const hhmm = (t: string) => t.slice(0, 5) // time do Postgres vem como HH:MM:SS
const ehChaveModelo = (c: string): c is ChaveModelo => Object.hasOwn(MODELOS_S1, c)

type LinhaUnidade = typeof units.$inferSelect
type LinhaHorario = { unitId: string; weekday: number; abre: string; fecha: string }
type LinhaExcecao = { unitId: string; data: string; fechado: boolean; turnos: { abre: string; fecha: string }[]; motivo: string | null }

/** Monta as unidades com agenda (turnos HH:MM) na ordem de `us`. Compartilhado com o painel. */
export function montarUnidades(us: readonly LinhaUnidade[], hs: readonly LinhaHorario[], exs: readonly LinhaExcecao[]): UnidadeS1[] {
  const porId = new Map<string, UnidadeS1>()
  const unidades = us.map((u) => {
    const x: UnidadeS1 = {
      id: u.id, nome: u.nome, apelidos: u.apelidos, ordem: u.ordem,
      endereco: u.endereco, bairro: u.bairro, cidade: u.cidade, uf: u.uf,
      lat: u.lat, lng: u.lng, mapsUrl: u.mapsUrl,
      semanal: Array.from({ length: 7 }, () => [] as Turno[]),
      excecoes: {},
    }
    porId.set(u.id, x)
    return x
  })
  for (const h of hs) porId.get(h.unitId)?.semanal[h.weekday]?.push({ abre: hhmm(h.abre), fecha: hhmm(h.fecha) })
  for (const e of exs) {
    const u = porId.get(e.unitId)
    if (u) u.excecoes[e.data] = { fechado: e.fechado, turnos: e.turnos.map((t) => ({ abre: hhmm(t.abre), fecha: hhmm(t.fecha) })), motivo: e.motivo }
  }
  return unidades
}

/** Contexto da resolução de S1. Roda como worker_app (RLS ampla): filtra restaurant_id em toda consulta. */
export async function carregarContextoS1(db: Db | Tx, restaurantId: string, agora: Date = new Date()): Promise<ContextoS1> {
  const [r] = await db
    .select({ nome: restaurants.nome, timezone: restaurants.timezone, politica: restaurants.politicaFeriado })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
  if (!r) throw new Error('Restaurante não encontrado')
  const ontem = somarDias(agoraLocal(agora, r.timezone).data, -1)

  const us = await db.select().from(units)
    .where(and(eq(units.restaurantId, restaurantId), eq(units.ativo, true)))
    .orderBy(asc(units.ordem), asc(units.nome))
  const idsAtivos = us.map((u) => u.id)
  // filtra por unit_id (índices únicos começam por unit_id); sem unidade ativa não há o que consultar
  const hs = idsAtivos.length === 0 ? [] : await db
    .select({ unitId: unitHours.unitId, weekday: unitHours.weekday, abre: unitHours.abre, fecha: unitHours.fecha })
    .from(unitHours)
    .where(and(eq(unitHours.restaurantId, restaurantId), inArray(unitHours.unitId, idsAtivos)))
    .orderBy(asc(unitHours.unitId), asc(unitHours.weekday), asc(unitHours.abre))
  const exs = idsAtivos.length === 0 ? [] : await db
    .select({ unitId: unitHourExceptions.unitId, data: unitHourExceptions.data, fechado: unitHourExceptions.fechado, turnos: unitHourExceptions.turnos, motivo: unitHourExceptions.motivo })
    .from(unitHourExceptions)
    .where(and(eq(unitHourExceptions.restaurantId, restaurantId), inArray(unitHourExceptions.unitId, idsAtivos), gte(unitHourExceptions.data, ontem)))
  const fatos = await db
    .select({ id: knowledgeFacts.id, tema: knowledgeFacts.tema, exemplos: knowledgeFacts.exemplos, texto: knowledgeFacts.texto, unitId: knowledgeFacts.unitId })
    .from(knowledgeFacts)
    .where(and(
      eq(knowledgeFacts.restaurantId, restaurantId),
      eq(knowledgeFacts.ativo, true),
      idsAtivos.length === 0 ? isNull(knowledgeFacts.unitId) : or(isNull(knowledgeFacts.unitId), inArray(knowledgeFacts.unitId, idsAtivos)),
    ))
    .orderBy(asc(knowledgeFacts.tema))
    .limit(MAX_FATOS)
  const modelos = await db
    .select({ chave: replyTemplates.chave, texto: replyTemplates.texto })
    .from(replyTemplates)
    .where(eq(replyTemplates.restaurantId, restaurantId))

  const unidades = montarUnidades(us, hs, exs)
  const personalizados: Partial<Record<ChaveModelo, string>> = {}
  for (const m of modelos) {
    // modelo inválido (variável removida, por exemplo) cai no padrão em vez de quebrar a resposta
    if (ehChaveModelo(m.chave) && validarModelo(m.chave, m.texto) === null) personalizados[m.chave] = m.texto
  }
  return {
    restaurante: r.nome,
    timezone: r.timezone,
    politicaFeriado: r.politica,
    unidades,
    fatos,
    modelos: personalizados,
  }
}

/** Uma lacuna aberta por (restaurante, chave, unidade): soma ocorrência ou cria. */
export async function registrarLacunas(tx: Tx, p: { restaurantId: string; lacunas: readonly Lacuna[]; pergunta: string }): Promise<void> {
  // ordem estável evita deadlock entre transações concorrentes
  const ordenadas = [...p.lacunas].sort((a, b) => a.chave.localeCompare(b.chave) || (a.unitId ?? '').localeCompare(b.unitId ?? ''))
  for (const l of ordenadas) {
    const filtro = and(
      eq(knowledgeGaps.restaurantId, p.restaurantId),
      eq(knowledgeGaps.chaveNormalizada, l.chave),
      l.unitId ? eq(knowledgeGaps.unitId, l.unitId) : isNull(knowledgeGaps.unitId),
      eq(knowledgeGaps.status, 'aberta'),
    )
    const somar = () =>
      tx.update(knowledgeGaps)
        .set({ ocorrencias: sql`${knowledgeGaps.ocorrencias} + 1`, ultimaVez: sql`now()`, perguntaMascarada: p.pergunta })
        .where(filtro)
        .returning({ id: knowledgeGaps.id })
    if ((await somar()).length > 0) continue
    const criada = await tx
      .insert(knowledgeGaps)
      .values({ restaurantId: p.restaurantId, unitId: l.unitId, chaveNormalizada: l.chave, perguntaMascarada: p.pergunta })
      .onConflictDoNothing()
      .returning({ id: knowledgeGaps.id })
    if (criada.length === 0) await somar() // outra transação criou ao mesmo tempo
  }
}

/** Indicador "% respondido pela IA": itens de S1 respondidos com dado ÷ itens válidos (simulação só no modo demonstração). */
export function taxaRespostaIa(db: Db, claims: JwtClaims, agora: Date = new Date()) {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select({ tz: restaurants.timezone }).from(restaurants).limit(1)
    const tz = r?.tz ?? FUSO_PADRAO
    const hoje = agoraLocal(agora, tz).data
    const inicioHoje = sql`((${hoje})::date)::timestamp at time zone ${tz}`
    const inicio7 = sql`((${somarDias(hoje, -6)})::date)::timestamp at time zone ${tz}`
    const [x] = await tx
      .select({
        validosHoje: sql<number>`coalesce(sum(${aiRuns.itensValidos}) filter (where ${aiRuns.createdAt} >= ${inicioHoje}), 0)::int`,
        respondidosHoje: sql<number>`coalesce(sum(${aiRuns.itensRespondidos}) filter (where ${aiRuns.createdAt} >= ${inicioHoje}), 0)::int`,
        validos7: sql<number>`coalesce(sum(${aiRuns.itensValidos}), 0)::int`,
        respondidos7: sql<number>`coalesce(sum(${aiRuns.itensRespondidos}), 0)::int`,
      })
      .from(aiRuns)
      .where(and(filtroSimulacao(aiRuns.simulado, await lerModoDemonstracao(tx)), sql`${aiRuns.createdAt} >= ${inicio7}`))
    return {
      hoje: { validos: x?.validosHoje ?? 0, respondidos: x?.respondidosHoje ?? 0 },
      seteDias: { validos: x?.validos7 ?? 0, respondidos: x?.respondidos7 ?? 0 },
    }
  })
}
