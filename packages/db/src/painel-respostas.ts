import { and, asc, desc, eq } from 'drizzle-orm'
import { MODELOS_S1, type ChaveModelo } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { taxaRespostaIa } from './s1.ts'
import { units } from './schema/restaurant.ts'
import { knowledgeFacts, knowledgeGaps, replyTemplates } from './schema/s1.ts'

const GESTAO = ['dono', 'gerente'] as const
const ehChaveModelo = (c: string): c is ChaveModelo => Object.hasOwn(MODELOS_S1, c)

export type LacunaPainel = {
  id: string
  chave: string
  unitId: string | null
  unidade: string | null
  pergunta: string | null
  ocorrencias: number
  ultimaVez: Date
}
export type FatoInput = { tema: string; exemplos: string[]; texto: string; unitId: string | null; ativo: boolean }
export type FatoPainel = FatoInput & { id: string; unidade: string | null }

export function listarLacunas(db: Db, claims: JwtClaims, limite = 100): Promise<LacunaPainel[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: knowledgeGaps.id,
        chave: knowledgeGaps.chaveNormalizada,
        unitId: knowledgeGaps.unitId,
        unidade: units.nome,
        pergunta: knowledgeGaps.perguntaMascarada,
        ocorrencias: knowledgeGaps.ocorrencias,
        ultimaVez: knowledgeGaps.ultimaVez,
      })
      .from(knowledgeGaps)
      .leftJoin(units, eq(units.id, knowledgeGaps.unitId))
      .where(eq(knowledgeGaps.status, 'aberta'))
      .orderBy(desc(knowledgeGaps.ocorrencias), desc(knowledgeGaps.ultimaVez))
      .limit(limite),
  )
}

export function responderLacuna(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  lacunaId: string,
  fato: FatoInput,
): Promise<ResultadoPainel<{ factId: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [g] = await tx
      .select({ id: knowledgeGaps.id })
      .from(knowledgeGaps)
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
    if (!g) return falha('nao_encontrada')
    const [f] = await tx.insert(knowledgeFacts).values({ restaurantId, ...fato }).returning({ id: knowledgeFacts.id })
    const fechadas = await tx
      .update(knowledgeGaps)
      .set({ status: 'respondida', factId: f!.id })
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
      .returning({ id: knowledgeGaps.id })
    // lacuna visível mas não atualizável (policy) ou fechada por outra pessoa agora: desfaz o fato
    if (fechadas.length === 0) throw Object.assign(new Error('lacuna não pôde ser fechada'), { cause: { code: '42501' } })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'lacuna.respondida', entidade: 'knowledge_gap', entidadeId: lacunaId, diff: { factId: f!.id, tema: fato.tema } })
    return ok({ factId: f!.id })
  }))
}

export function ignorarLacuna(db: Db, claims: JwtClaims, restaurantId: string, lacunaId: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const r = await tx
      .update(knowledgeGaps)
      .set({ status: 'ignorada' })
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
      .returning({ id: knowledgeGaps.id })
    if (r.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'lacuna.ignorada', entidade: 'knowledge_gap', entidadeId: lacunaId })
    return ok(null)
  }))
}

export function listarFatos(db: Db, claims: JwtClaims): Promise<FatoPainel[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: knowledgeFacts.id,
        tema: knowledgeFacts.tema,
        exemplos: knowledgeFacts.exemplos,
        texto: knowledgeFacts.texto,
        unitId: knowledgeFacts.unitId,
        ativo: knowledgeFacts.ativo,
        unidade: units.nome,
      })
      .from(knowledgeFacts)
      .leftJoin(units, eq(units.id, knowledgeFacts.unitId))
      .orderBy(asc(knowledgeFacts.tema)),
  )
}

export function salvarFato(db: Db, claims: JwtClaims, restaurantId: string, id: string | null, fato: FatoInput): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (id === null) {
      const [f] = await tx.insert(knowledgeFacts).values({ restaurantId, ...fato }).returning({ id: knowledgeFacts.id })
      await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.criado', entidade: 'knowledge_fact', entidadeId: f!.id, diff: fato })
      return ok({ id: f!.id })
    }
    const [f] = await tx.update(knowledgeFacts).set(fato).where(eq(knowledgeFacts.id, id)).returning({ id: knowledgeFacts.id })
    if (!f) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.atualizado', entidade: 'knowledge_fact', entidadeId: f.id, diff: fato })
    return ok({ id: f.id })
  }))
}

export function removerFato(db: Db, claims: JwtClaims, restaurantId: string, id: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const r = await tx.delete(knowledgeFacts).where(eq(knowledgeFacts.id, id)).returning({ id: knowledgeFacts.id })
    if (r.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.removido', entidade: 'knowledge_fact', entidadeId: id })
    return ok(null)
  }))
}

export function listarModelos(db: Db, claims: JwtClaims): Promise<Partial<Record<ChaveModelo, string>>> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx.select({ chave: replyTemplates.chave, texto: replyTemplates.texto }).from(replyTemplates)
    const out: Partial<Record<ChaveModelo, string>> = {}
    for (const r of rows) if (ehChaveModelo(r.chave)) out[r.chave] = r.texto
    return out
  })
}

export function salvarModelo(db: Db, claims: JwtClaims, restaurantId: string, chave: ChaveModelo, texto: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    await tx
      .insert(replyTemplates)
      .values({ restaurantId, chave, texto })
      .onConflictDoUpdate({ target: [replyTemplates.restaurantId, replyTemplates.chave], set: { texto } })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'modelo.salvo', entidade: 'reply_template', entidadeId: chave, diff: { texto } })
    return ok(null)
  }))
}

export function restaurarModelo(db: Db, claims: JwtClaims, restaurantId: string, chave: ChaveModelo): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    await tx.delete(replyTemplates).where(eq(replyTemplates.chave, chave))
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'modelo.restaurado', entidade: 'reply_template', entidadeId: chave })
    return ok(null)
  }))
}

export async function resumoInicio(db: Db, claims: JwtClaims, agora: Date = new Date()) {
  // em sequência: o web usa uma conexão só (pooler em modo transaction)
  const taxa = await taxaRespostaIa(db, claims, agora)
  const lacunas = await listarLacunas(db, claims, 3)
  return { taxa, lacunas }
}
