import { createHash } from 'node:crypto'
import { and, asc, eq, gt, ne, notInArray, sql } from 'drizzle-orm'
import { normalizeText } from '@atd/core'
import type {
  RascunhoCardapioImportacao, RascunhoEspacos, RascunhoHorarios, RascunhoInformacoes, RascunhoSoPrecos,
} from '@atd/core/importacao'
import type { Db } from './client.ts'
import {
  aplicarNoCardapio, caminhoArquivoDeEnvio, MIMES_ARQUIVO_CARDAPIO, PRAZO_PROCESSANDO, tituloArquivoImportado, type StatusImportacao,
} from './importacoes.ts'
import { PRAZO_CONCESSAO_LOTE } from './queue.ts'
import { validarRascunho, type AlvoImportacao, type ModoImportacao, type RascunhoDoAlvo } from './importacoes-rascunho.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { gravarArquivo, podeEditarCardapioGeral } from './painel-cardapio.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { knowledgeFacts, unitHourExceptions, unitHours } from './schema/s1.ts'
import { eventSpaces } from './schema/s3.ts'
import { knowledgeDocumentFiles, knowledgeDocuments, MAX_ARQUIVOS_IMPORTACAO, menuCategories, menuItems } from './schema/s4.ts'

export type { AlvoImportacao, ModoImportacao } from './importacoes-rascunho.ts'
export { ERRO_VAZIO_POR_ALVO, validarRascunho } from './importacoes-rascunho.ts'

export type ArquivoImportacao = { ordem: number; storagePath: string; mime: string; tamanho: number; sha256: string; paginas: number | null }

/**
 * Importação por alvo com vários arquivos (Etapa 07). Ciclo: `criarImportacaoArquivos` (enviado, sem arquivos) →
 * `anexarArquivo`/`removerArquivo` (até 10) → `iniciarLeitura` (grava o hash do conjunto; dedup) → worker
 * (`proximoLote`/`salvarLote`/`concluirIngestao`) → `revisaoImportacao` → `aplicarImportacao` (I10).
 * Permissão: dono, ou gerente que acessa todas as unidades (igual ao cardápio geral). O cardápio (completo ou só
 * preços) também pelo gerente restrito a unidades, que envia, lê e revisa como na Etapa 05, mas não confirma.
 */

const GESTAO = ['dono', 'gerente'] as const

/** Quem envia, lê e revisa importações do alvo (confirmar exige sempre `podeEditarCardapioGeral`). */
async function podeImportarAlvo(tx: Tx, alvo: AlvoImportacao): Promise<boolean> {
  return alvo === 'cardapio' ? exigirPapel(tx, GESTAO) : podeEditarCardapioGeral(tx)
}

export type ErroArquivos = 'limite_arquivos' | 'ja_iniciada'

/** Nova importação de vários arquivos. `so_precos` só no cardápio (check do banco: outro alvo lança). */
export function criarImportacaoArquivos(
  db: Db,
  claims: JwtClaims,
  v: { alvo: AlvoImportacao; modo: ModoImportacao },
): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await podeImportarAlvo(tx, v.alvo))) return falha('sem_permissao')
    // SQL explícito: authenticated só tem INSERT nas colunas permitidas (0027/0041)
    const [d] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
      insert into public.knowledge_documents (restaurant_id, alvo, modo, origem, status, enviado_por)
      values ((select app.my_restaurant_id()), ${v.alvo}, ${v.modo}, 'arquivo', 'enviado', ${claims.sub})
      returning id, restaurant_id`)
    await registrarAuditoria(tx, claims, {
      restaurantId: d!.restaurant_id, acao: 'importacao.criada', entidade: 'knowledge_document', entidadeId: d!.id,
      diff: { alvo: v.alvo, modo: v.modo },
    })
    return ok({ id: d!.id })
  }))
}

type DocRecebendo = { id: string; restaurantId: string; alvo: AlvoImportacao; modo: ModoImportacao }

/**
 * Importação visível, travada e ainda recebendo arquivos (enviado, vários arquivos, sem hash). A trava passa pela
 * policy `gestao_iniciar`: quem chega depois do início não trava nada.
 */
async function travarRecebendo(tx: Tx, id: string): Promise<DocRecebendo | 'nao_encontrada' | 'ja_iniciada' | 'sem_permissao'> {
  const [d] = await tx
    .select({
      status: knowledgeDocuments.status, sha256: knowledgeDocuments.sha256, storagePath: knowledgeDocuments.storagePath, origem: knowledgeDocuments.origem,
      alvo: knowledgeDocuments.alvo,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
  if (!d) return 'nao_encontrada'
  if (!(await podeImportarAlvo(tx, d.alvo))) return 'sem_permissao'
  if (d.origem !== 'arquivo' || d.storagePath !== null || d.status !== 'enviado' || d.sha256 !== null) return 'ja_iniciada'
  const [t] = await tx
    .select({ id: knowledgeDocuments.id, restaurantId: knowledgeDocuments.restaurantId, alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
    .for('update')
  return t ?? 'ja_iniciada'
}

/**
 * `descartarCaminho`: o conteúdo já estava na importação (mesmo sha256) com outro caminho — o objeto recém-enviado
 * ficou sem uso e quem chamou deve apagá-lo do Storage. Null quando o arquivo entrou ou é o mesmo objeto (reenvio).
 */
export type ResultadoAnexar = ResultadoPainel<{ ordem: number; descartarCaminho: string | null }> | { ok: false; erro: ErroArquivos }

/**
 * Anexa um arquivo já enviado ao Storage (`importacoes/<restaurant_id>/…`) no fim da lista. O mesmo arquivo (sha256)
 * na mesma importação devolve a posição que já tem. Mais de 10 ⇒ `limite_arquivos`; depois de "Ler arquivos" ⇒
 * `ja_iniciada`. Caminho de outro restaurante ⇒ `sem_permissao` (RLS); tipo fora de PDF/imagem lança (check).
 */
export function anexarArquivo(
  db: Db,
  claims: JwtClaims,
  importacaoId: string,
  a: { storagePath: string; mime: string; tamanho: number; sha256: string },
): Promise<ResultadoAnexar> {
  return semPermissaoVira<ResultadoAnexar>(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const doc = await travarRecebendo(tx, importacaoId)
    if (doc === 'nao_encontrada' || doc === 'sem_permissao') return falha(doc)
    if (doc === 'ja_iniciada') return { ok: false, erro: 'ja_iniciada' }
    const atuais = await tx
      .select({ ordem: knowledgeDocumentFiles.ordem, sha256: knowledgeDocumentFiles.sha256, storagePath: knowledgeDocumentFiles.storagePath })
      .from(knowledgeDocumentFiles)
      .where(eq(knowledgeDocumentFiles.importacaoId, importacaoId))
    const repetido = atuais.find((f) => f.sha256 === a.sha256)
    if (repetido) return ok({ ordem: repetido.ordem, descartarCaminho: repetido.storagePath === a.storagePath ? null : a.storagePath })
    if (atuais.length >= MAX_ARQUIVOS_IMPORTACAO) return { ok: false, erro: 'limite_arquivos' }
    // a lista é sempre 1..n (remover renumera)
    const ordem = atuais.length + 1
    await tx.execute(sql`
      insert into public.knowledge_document_files (restaurant_id, importacao_id, ordem, storage_path, mime, tamanho, sha256)
      values (${doc.restaurantId}, ${importacaoId}, ${ordem}, ${a.storagePath}, ${a.mime}, ${a.tamanho}, ${a.sha256})`)
    return ok({ ordem, descartarCaminho: null })
  }))
}

/**
 * Conferência barata antes de subir o arquivo ao Storage (sem trava): permissão no alvo, importação ainda recebendo
 * arquivos e com menos de 10. `anexarArquivo` confere de novo com a trava (corrida entre abas).
 */
export function podeAnexar(db: Db, claims: JwtClaims, importacaoId: string): Promise<ResultadoPainel | { ok: false; erro: ErroArquivos }> {
  return withUserContext(db, claims, async (tx): Promise<ResultadoPainel | { ok: false; erro: ErroArquivos }> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [d] = await tx
      .select({
        status: knowledgeDocuments.status, sha256: knowledgeDocuments.sha256, storagePath: knowledgeDocuments.storagePath, origem: knowledgeDocuments.origem,
        alvo: knowledgeDocuments.alvo,
        arquivos: sql<number>`(select count(*) from public.knowledge_document_files f where f.importacao_id = "knowledge_documents"."id")::int`,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, importacaoId))
    if (!d) return falha('nao_encontrada')
    if (!(await podeImportarAlvo(tx, d.alvo))) return falha('sem_permissao')
    if (d.origem !== 'arquivo' || d.storagePath !== null || d.status !== 'enviado' || d.sha256 !== null) return { ok: false, erro: 'ja_iniciada' }
    if (d.arquivos >= MAX_ARQUIVOS_IMPORTACAO) return { ok: false, erro: 'limite_arquivos' }
    return ok(null)
  })
}

/** Tira o arquivo da posição `ordem` (antes de ler); os seguintes sobem uma posição. */
export function removerArquivo(
  db: Db,
  claims: JwtClaims,
  importacaoId: string,
  ordem: number,
): Promise<ResultadoPainel | { ok: false; erro: 'ja_iniciada' }> {
  return semPermissaoVira<ResultadoPainel | { ok: false; erro: 'ja_iniciada' }>(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const doc = await travarRecebendo(tx, importacaoId)
    if (doc === 'nao_encontrada' || doc === 'sem_permissao') return falha(doc)
    if (doc === 'ja_iniciada') return { ok: false, erro: 'ja_iniciada' }
    const apagados = await tx
      .delete(knowledgeDocumentFiles)
      .where(and(eq(knowledgeDocumentFiles.importacaoId, importacaoId), eq(knowledgeDocumentFiles.ordem, ordem)))
      .returning({ id: knowledgeDocumentFiles.id })
    if (apagados.length === 0) return falha('nao_encontrada')
    // um por vez, em ordem crescente: a posição de destino já está livre (índice único sem conflito transitório)
    const seguintes = await tx
      .select({ id: knowledgeDocumentFiles.id, ordem: knowledgeDocumentFiles.ordem })
      .from(knowledgeDocumentFiles)
      .where(and(eq(knowledgeDocumentFiles.importacaoId, importacaoId), gt(knowledgeDocumentFiles.ordem, ordem)))
      .orderBy(asc(knowledgeDocumentFiles.ordem))
    for (const f of seguintes) {
      await tx.update(knowledgeDocumentFiles).set({ ordem: f.ordem - 1 }).where(eq(knowledgeDocumentFiles.id, f.id))
    }
    return ok(null)
  }))
}

/** Arquivos da importação, em ordem (para a lista antes de "Ler arquivos"). Sem acesso ⇒ lista vazia (RLS). */
export function arquivosImportacao(
  db: Db,
  claims: JwtClaims,
  importacaoId: string,
): Promise<{ ordem: number; mime: string; tamanho: number }[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({ ordem: knowledgeDocumentFiles.ordem, mime: knowledgeDocumentFiles.mime, tamanho: knowledgeDocumentFiles.tamanho })
      .from(knowledgeDocumentFiles)
      .where(eq(knowledgeDocumentFiles.importacaoId, importacaoId))
      .orderBy(asc(knowledgeDocumentFiles.ordem)),
  )
}

/** Caminho no Storage do arquivo `ordem` da importação (para copiar o arquivo de envio); sem acesso ⇒ null. */
export function caminhoArquivoImportacao(db: Db, claims: JwtClaims, importacaoId: string, ordem: number): Promise<string | null> {
  return withUserContext(db, claims, async (tx) => {
    const [f] = await tx
      .select({ storagePath: knowledgeDocumentFiles.storagePath })
      .from(knowledgeDocumentFiles)
      .where(and(eq(knowledgeDocumentFiles.importacaoId, importacaoId), eq(knowledgeDocumentFiles.ordem, ordem)))
    return f?.storagePath ?? null
  })
}

/** Hash do conjunto: sha256 dos sha256 dos arquivos, ordenados e unidos por vírgula (a ordem de envio não importa). */
export const hashDoConjunto = (shas: readonly string[]) => createHash('sha256').update([...shas].sort().join(',')).digest('hex')

export type ResultadoIniciar =
  | ResultadoPainel
  | { ok: false; erro: 'sem_arquivos' | 'ja_iniciada' }
  /** o mesmo conjunto (alvo e modo) já está em leitura, rascunho ou aplicado: o painel abre a existente */
  | { ok: false; erro: 'ja_importado'; id: string }

/**
 * "Ler arquivos": grava o hash do conjunto (fecha a lista). Quem enfileira a leitura é a Server Action (status segue
 * `enviado` até o worker pegar). Sem arquivo ⇒ `sem_arquivos`; mesmo conjunto ativo ⇒ `ja_importado` (também na
 * corrida: o índice único decide).
 */
export function iniciarLeitura(db: Db, claims: JwtClaims, importacaoId: string): Promise<ResultadoIniciar> {
  return semPermissaoVira<ResultadoIniciar>(() => withUserContext(db, claims, async (tx): Promise<ResultadoIniciar> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const doc = await travarRecebendo(tx, importacaoId)
    if (doc === 'nao_encontrada' || doc === 'sem_permissao') return falha(doc)
    if (doc === 'ja_iniciada') return { ok: false, erro: 'ja_iniciada' }
    const arquivos = await tx
      .select({ sha256: knowledgeDocumentFiles.sha256 })
      .from(knowledgeDocumentFiles)
      .where(eq(knowledgeDocumentFiles.importacaoId, importacaoId))
    if (arquivos.length === 0) return { ok: false, erro: 'sem_arquivos' }
    const hash = hashDoConjunto(arquivos.map((a) => a.sha256))
    const existente = async () => {
      const [e] = await tx
        .select({ id: knowledgeDocuments.id })
        .from(knowledgeDocuments)
        .where(and(
          ne(knowledgeDocuments.id, importacaoId),
          eq(knowledgeDocuments.sha256, hash),
          eq(knowledgeDocuments.origem, 'arquivo'),
          eq(knowledgeDocuments.alvo, doc.alvo),
          eq(knowledgeDocuments.modo, doc.modo),
          notInArray(knowledgeDocuments.status, ['rejeitado', 'erro']),
        ))
      return e?.id
    }
    const antes = await existente()
    if (antes) return { ok: false, erro: 'ja_importado', id: antes }
    try {
      // savepoint: a violação do índice único (corrida) não derruba a transação
      await tx.transaction(async (sp) => {
        await sp.update(knowledgeDocuments).set({ sha256: hash }).where(eq(knowledgeDocuments.id, importacaoId))
      })
    } catch (err) {
      const c = (err as { cause?: { code?: string; constraint_name?: string } }).cause
      if (c?.code !== '23505' || c.constraint_name !== 'knowledge_documents_arquivo_sha256_uq') throw err
      const depois = await existente()
      if (!depois) throw err
      return { ok: false, erro: 'ja_importado', id: depois }
    }
    await registrarAuditoria(tx, claims, {
      restaurantId: doc.restaurantId, acao: 'importacao.leitura_iniciada', entidade: 'knowledge_document', entidadeId: importacaoId,
      diff: { arquivos: arquivos.length },
    })
    return ok(null)
  }))
}

/** Passo seguinte que não andou depois de um lote salvo (fila perdida): mais que isso sem mudança ⇒ parada. */
export const PRAZO_PASSO_PARADO = '2 minutes'

/**
 * Leitura de vários arquivos já iniciada sem ninguém lendo: `enviado` com o hash (o enfileiramento falhou) ou
 * `processando` com a concessão do lote vencida (o leitor morreu e a fila desistiu) ou livre há mais de
 * `PRAZO_PASSO_PARADO` (o passo seguinte se perdeu). Reenfileirar é seguro: a chave do job deduplica e
 * `proximoLote` só entrega o lote com a concessão livre ou vencida.
 */
const parada = sql<boolean>`coalesce(${knowledgeDocuments.origem} = 'arquivo' and ${knowledgeDocuments.storagePath} is null
  and ${knowledgeDocuments.sha256} is not null and (${knowledgeDocuments.status} = 'enviado'
  or (${knowledgeDocuments.status} = 'processando' and (${knowledgeDocuments.loteLendoDesde} < now() - ${PRAZO_CONCESSAO_LOTE}::interval
    or (${knowledgeDocuments.loteLendoDesde} is null and ${knowledgeDocuments.updatedAt} < now() - ${PRAZO_PASSO_PARADO}::interval)))), false)`

/** O painel pode reenfileirar a leitura desta importação ("Tentar de novo", reenvio dos mesmos arquivos)? */
export function leituraParada(db: Db, claims: JwtClaims, importacaoId: string): Promise<boolean> {
  return withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return false
    const [d] = await tx.select({ alvo: knowledgeDocuments.alvo, parada }).from(knowledgeDocuments).where(eq(knowledgeDocuments.id, importacaoId))
    return d !== undefined && d.parada && (await podeImportarAlvo(tx, d.alvo))
  })
}

/** Importações paradas (worker, no boot): reenfileiradas para seguir de onde pararam. */
export async function importacoesParadas(db: Db | Tx, limite = 100): Promise<string[]> {
  const rs = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(parada)
    .orderBy(asc(knowledgeDocuments.createdAt)).limit(limite)
  return rs.map((r) => r.id)
}

// ============ worker (job document.ingest, um lote por execução) ============

export type EstadoLote = {
  alvo: AlvoImportacao
  modo: ModoImportacao
  restaurantId: string
  /** índice do lote a ler (0 = primeiro) */
  loteAtual: number
  lotesTotal: number | null
  arquivos: ArquivoImportacao[]
  draftParcial: unknown
  /** o leitor anterior morreu no meio do lote (concessão vencida, ou `processando` parado há mais que o prazo) */
  retomada: boolean
}

/**
 * Próximo passo da leitura de uma importação de vários arquivos já iniciada, com **concessão do lote**: `enviado` ⇒
 * `processando`; `processando` continua de `lote_atual`. Quem recebe o estado fica com o lote (`lote_lendo_desde`)
 * até `salvarLote`/`concluirIngestao` ou o reenfileiramento liberarem; enquanto a concessão estiver viva
 * (< PRAZO_CONCESSAO_LOTE = prazo do job, acima do pior caso de um lote) qualquer outra chamada recebe null — duas
 * execuções nunca pagam o mesmo lote, e a repetição de um job expirado não libera a reserva de um leitor vivo.
 * Concessão vencida (leitor morreu) ⇒ retoma com `retomada: true`. Qualquer outro caso ⇒ null.
 */
export function proximoLote(db: Db | Tx, id: string): Promise<EstadoLote | null> {
  return (db as Db).transaction(async (tx) => {
    const [d] = await tx
      .select({
        status: knowledgeDocuments.status, origem: knowledgeDocuments.origem, storagePath: knowledgeDocuments.storagePath,
        sha256: knowledgeDocuments.sha256, alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo,
        restaurantId: knowledgeDocuments.restaurantId, loteAtual: knowledgeDocuments.loteAtual, lotesTotal: knowledgeDocuments.lotesTotal,
        draftParcial: knowledgeDocuments.draftParcial,
        parado: sql<boolean>`${knowledgeDocuments.updatedAt} < now() - ${PRAZO_PROCESSANDO}::interval`,
        concessao: sql<'livre' | 'viva' | 'vencida'>`case when ${knowledgeDocuments.loteLendoDesde} is null then 'livre'
          when ${knowledgeDocuments.loteLendoDesde} >= now() - ${PRAZO_CONCESSAO_LOTE}::interval then 'viva' else 'vencida' end`,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for('update')
    if (!d || d.origem !== 'arquivo' || d.storagePath !== null || d.sha256 === null) return null
    let retomada = false
    if (d.status === 'enviado') {
      await tx.update(knowledgeDocuments).set({ status: 'processando', loteLendoDesde: sql`now()` }).where(eq(knowledgeDocuments.id, id))
    } else if (d.status === 'processando') {
      if (d.concessao === 'viva') return null
      retomada = d.concessao === 'vencida' || d.parado
      await tx.update(knowledgeDocuments).set({ loteLendoDesde: sql`now()` }).where(eq(knowledgeDocuments.id, id))
    } else {
      return null
    }
    const arquivos = await tx
      .select({
        ordem: knowledgeDocumentFiles.ordem, storagePath: knowledgeDocumentFiles.storagePath, mime: knowledgeDocumentFiles.mime,
        tamanho: knowledgeDocumentFiles.tamanho, sha256: knowledgeDocumentFiles.sha256, paginas: knowledgeDocumentFiles.paginas,
      })
      .from(knowledgeDocumentFiles)
      .where(eq(knowledgeDocumentFiles.importacaoId, id))
      .orderBy(asc(knowledgeDocumentFiles.ordem))
    return {
      alvo: d.alvo, modo: d.modo, restaurantId: d.restaurantId, loteAtual: d.loteAtual, lotesTotal: d.lotesTotal,
      arquivos, draftParcial: d.draftParcial, retomada,
    }
  })
}

/**
 * Grava o lote `lote` lido (parcial já juntado), avança para `lote + 1` e libera a concessão — só se `lote` é o lote
 * corrente e a importação está `processando`. Devolve true só para quem salvou (reentrega do mesmo lote ⇒ false, e
 * quem recebe false não reenfileira).
 */
export async function salvarLote(db: Db | Tx, id: string, p: { lote: number; lotesTotal: number; draftParcial: unknown }): Promise<boolean> {
  const r = await db
    .update(knowledgeDocuments)
    .set({ loteAtual: p.lote + 1, lotesTotal: p.lotesTotal, draftParcial: p.draftParcial, loteLendoDesde: null })
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.status, 'processando'), eq(knowledgeDocuments.loteAtual, p.lote)))
    .returning({ id: knowledgeDocuments.id })
  return r.length > 0
}

/**
 * Libera a concessão do lote sem avançar (passo que só planeja ou lê meia parte e se reenfileira). Só no lote
 * esperado: devolve true se liberou.
 */
export async function liberarLote(db: Db | Tx, id: string, lote: number): Promise<boolean> {
  const r = await db
    .update(knowledgeDocuments)
    .set({ loteLendoDesde: null })
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.status, 'processando'), eq(knowledgeDocuments.loteAtual, lote)))
    .returning({ id: knowledgeDocuments.id })
  return r.length > 0
}

// ============ revisão e aplicação por alvo ============

type MapaUnidades = { resolver: (nome: string | null) => string | null }
/**
 * Resolve a unidade lida/escolhida, por ordem de precedência: id da unidade → slug (único) → nome → apelido, sempre
 * sem diferenciar caixa/acento. Ambiguidade só dentro do mesmo nível (dois nomes iguais, ou o mesmo apelido em duas
 * unidades) ⇒ não resolve. A revisão (Task 5) grava em `unidade` o slug da unidade escolhida (ou o id/nome exato).
 */
async function mapaUnidades(tx: Tx): Promise<MapaUnidades> {
  const us = await tx.select({ id: units.id, nome: units.nome, slug: units.slug, apelidos: units.apelidos }).from(units)
  const nivel = (chaves: (u: (typeof us)[number]) => string[]) => {
    const m = new Map<string, string | null>()
    for (const u of us) {
      for (const n of new Set(chaves(u).map(normalizeText))) m.set(n, m.has(n) && m.get(n) !== u.id ? null : u.id)
    }
    return m
  }
  const niveis = [nivel((u) => [u.id]), nivel((u) => [u.slug]), nivel((u) => [u.nome]), nivel((u) => u.apelidos)]
  return {
    resolver: (nome) => {
      if (nome === null) return null
      const k = normalizeText(nome)
      for (const m of niveis) if (m.has(k)) return m.get(k) ?? null
      return null
    },
  }
}

// ---- cardápio completo ----
export type RotuloItemCardapio = { categoria: number; item: number; acao: 'novo' | 'atualizar' | 'ignorar' | 'unidade_desconhecida' }
async function planoCardapio(tx: Tx, r: RascunhoCardapioImportacao): Promise<RotuloItemCardapio[]> {
  const cats = await tx.select({ id: menuCategories.id, nome: menuCategories.nome }).from(menuCategories)
  const categoriaPorNome = new Map(cats.map((c) => [normalizeText(c.nome), c.id]))
  const its = await tx.select({ categoryId: menuItems.categoryId, nome: menuItems.nome }).from(menuItems)
  const existentes = new Set(its.map((i) => `${i.categoryId}|${normalizeText(i.nome)}`))
  const un = await mapaUnidades(tx)
  return r.categorias.flatMap((c, ci) => c.itens.map((i, ii): RotuloItemCardapio => {
    if (!i.incluir) return { categoria: ci, item: ii, acao: 'ignorar' }
    if (i.unidade !== null && un.resolver(i.unidade) === null) return { categoria: ci, item: ii, acao: 'unidade_desconhecida' }
    const cat = categoriaPorNome.get(normalizeText(c.nome))
    const existe = cat !== undefined && existentes.has(`${cat}|${normalizeText(i.nome)}`)
    return { categoria: ci, item: ii, acao: existe ? 'atualizar' : 'novo' }
  }))
}

// ---- só preços ----
export type MudancaPreco = { indice: number; itemId: string; nome: string; categoria: string; antes: number | null; depois: number }
export type PrecoIgnorado = { indice: number; nome: string; motivo: 'desmarcado' | 'sem_preco' | 'nao_encontrado' | 'ambiguo' | 'sem_mudanca' }
async function planoSoPrecos(tx: Tx, r: RascunhoSoPrecos): Promise<{ mudancas: MudancaPreco[]; ignorados: PrecoIgnorado[] }> {
  const its = await tx
    .select({ id: menuItems.id, nome: menuItems.nome, preco: menuItems.precoCentavos, categoria: menuCategories.nome })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
  const porNome = new Map<string, typeof its>()
  for (const i of its) {
    const k = normalizeText(i.nome)
    porNome.set(k, [...(porNome.get(k) ?? []), i])
  }
  const mudancas: MudancaPreco[] = []
  const ignorados: PrecoIgnorado[] = []
  r.itens.forEach((l, indice) => {
    const ignora = (motivo: PrecoIgnorado['motivo']) => ignorados.push({ indice, nome: l.nome, motivo })
    if (!l.incluir) return ignora('desmarcado')
    // preço não lido nunca zera nem vira "sob consulta"
    if (l.precoCentavos === null) return ignora('sem_preco')
    const candidatos = (porNome.get(normalizeText(l.nome)) ?? [])
      .filter((i) => l.categoria === null || normalizeText(i.categoria) === normalizeText(l.categoria))
    if (candidatos.length === 0) return ignora('nao_encontrado')
    if (candidatos.length > 1) return ignora('ambiguo')
    const i = candidatos[0]!
    if (i.preco === l.precoCentavos) return ignora('sem_mudanca')
    mudancas.push({ indice, itemId: i.id, nome: i.nome, categoria: i.categoria, antes: i.preco, depois: l.precoCentavos })
  })
  return { mudancas, ignorados }
}

// ---- informações ----
export type RotuloFato = { acao: 'novo' | 'atualizar' | 'ignorar' | 'unidade_desconhecida'; factId: string | null; unitId: string | null }
const chaveFato = (unitId: string | null, tema: string) => `${unitId ?? ''}|${normalizeText(tema)}`
async function planoInformacoes(tx: Tx, r: RascunhoInformacoes): Promise<RotuloFato[]> {
  const fs = await tx.select({ id: knowledgeFacts.id, unitId: knowledgeFacts.unitId, tema: knowledgeFacts.tema }).from(knowledgeFacts)
  const porChave = new Map(fs.map((f) => [chaveFato(f.unitId, f.tema), f.id]))
  const un = await mapaUnidades(tx)
  return r.fatos.map((f): RotuloFato => {
    if (!f.incluir) return { acao: 'ignorar', factId: null, unitId: null }
    const unitId = un.resolver(f.unidade)
    // unidade lida e não reconhecida: nunca vira fato de todas as unidades
    if (f.unidade !== null && unitId === null) return { acao: 'unidade_desconhecida', factId: null, unitId: null }
    const factId = porChave.get(chaveFato(unitId, f.tema)) ?? null
    return { acao: factId === null ? 'novo' : 'atualizar', factId, unitId }
  })
}

// ---- horários ----
export type RotuloHorario = { unitId: string | null; reconhecida: boolean; acao: 'novo' | 'atualizar' | 'ignorar' | 'escolher_unidade' }
async function planoHorarios(tx: Tx, r: RascunhoHorarios): Promise<RotuloHorario[]> {
  const un = await mapaUnidades(tx)
  const comHorario = new Set((await tx.selectDistinct({ unitId: unitHours.unitId }).from(unitHours)).map((h) => h.unitId))
  return r.unidades.map((u): RotuloHorario => {
    const unitId = un.resolver(u.unidade)
    const reconhecida = unitId !== null
    if (!u.incluir) return { unitId, reconhecida, acao: 'ignorar' }
    if (!reconhecida) return { unitId: null, reconhecida, acao: 'escolher_unidade' }
    return { unitId, reconhecida, acao: comHorario.has(unitId) ? 'atualizar' : 'novo' }
  })
}

// ---- espaços ----
export type RotuloEspaco = { acao: 'novo' | 'atualizar' | 'ignorar' | 'escolher_unidade'; unitId: string | null; spaceId: string | null }
const chaveEspaco = (unitId: string, nome: string) => `${unitId}|${normalizeText(nome)}`
async function planoEspacos(tx: Tx, r: RascunhoEspacos): Promise<RotuloEspaco[]> {
  const es = await tx.select({ id: eventSpaces.id, unitId: eventSpaces.unitId, nome: eventSpaces.nome }).from(eventSpaces)
  const porChave = new Map(es.map((e) => [chaveEspaco(e.unitId, e.nome), e.id]))
  const un = await mapaUnidades(tx)
  return r.espacos.map((e): RotuloEspaco => {
    const unitId = un.resolver(e.unidade)
    if (!e.incluir) return { acao: 'ignorar', unitId, spaceId: null }
    if (unitId === null) return { acao: 'escolher_unidade', unitId: null, spaceId: null }
    const spaceId = porChave.get(chaveEspaco(unitId, e.nome)) ?? null
    return { acao: spaceId === null ? 'novo' : 'atualizar', unitId, spaceId }
  })
}

// ---- revisão ----
type BaseRevisao = {
  id: string
  status: StatusImportacao
  erro: string | null
  loteAtual: number
  lotesTotal: number | null
  criadoEm: Date
}
export type RevisaoImportacao = BaseRevisao & (
  | { alvo: 'cardapio'; modo: 'completo'; draft: RascunhoCardapioImportacao | null; itens: RotuloItemCardapio[] }
  | { alvo: 'cardapio'; modo: 'so_precos'; draft: RascunhoSoPrecos | null; mudancas: MudancaPreco[]; ignorados: PrecoIgnorado[] }
  | { alvo: 'informacoes'; modo: 'completo'; draft: RascunhoInformacoes | null; fatos: RotuloFato[] }
  /** `unidadesComHorario`: unidades que já têm grade (Novo/Atualiza quando a unidade é escolhida na revisão) */
  | { alvo: 'horarios'; modo: 'completo'; draft: RascunhoHorarios | null; unidades: RotuloHorario[]; unidadesComHorario: string[] }
  /** `espacosExistentes`: espaços cadastrados (Novo/Atualiza com unidade escolhida ou nome editado na revisão) */
  | { alvo: 'espacos'; modo: 'completo'; draft: RascunhoEspacos | null; espacos: RotuloEspaco[]; espacosExistentes: { unitId: string; nome: string }[] }
)

/**
 * Rascunho para a tela de revisão, com os rótulos calculados contra o cadastro atual: cardápio (novo/atualizar por
 * categoria+nome), só preços (antes → depois de itens existentes; o resto à parte com o motivo), informações (tema
 * normalizado + unidade), horários (unidade reconhecida ou a escolher), espaços (nome normalizado na unidade).
 * Sem rascunho (ainda lendo, erro) ⇒ `draft: null` e listas vazias. Atendente, gerente restrito ou outro
 * restaurante ⇒ null.
 */
export function revisaoImportacao(db: Db, claims: JwtClaims, id: string): Promise<RevisaoImportacao | null> {
  return withUserContext(db, claims, async (tx) => {
    const [d] = await tx
      .select({
        id: knowledgeDocuments.id, alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo, status: knowledgeDocuments.status,
        erro: knowledgeDocuments.erro, loteAtual: knowledgeDocuments.loteAtual, lotesTotal: knowledgeDocuments.lotesTotal,
        criadoEm: knowledgeDocuments.createdAt, draft: knowledgeDocuments.draft,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
    // gerente restrito a unidades revisa só o cardápio (sem confirmar); atendente não vê (RLS)
    if (!d || !(await podeImportarAlvo(tx, d.alvo))) return null
    const base: BaseRevisao = { id: d.id, status: d.status, erro: d.erro, loteAtual: d.loteAtual, lotesTotal: d.lotesTotal, criadoEm: d.criadoEm }
    const r = d.draft == null ? null : validarRascunho(d.alvo, d.modo, d.draft)
    switch (d.alvo) {
      case 'cardapio':
        if (d.modo === 'so_precos') {
          const sp = r?.alvo === 'cardapio' && r.modo === 'so_precos' ? r.draft : null
          const p = sp ? await planoSoPrecos(tx, sp) : { mudancas: [], ignorados: [] }
          return { ...base, alvo: 'cardapio', modo: 'so_precos', draft: sp, ...p }
        } else {
          const c = r?.alvo === 'cardapio' && r.modo === 'completo' ? r.draft : null
          return { ...base, alvo: 'cardapio', modo: 'completo', draft: c, itens: c ? await planoCardapio(tx, c) : [] }
        }
      case 'informacoes': {
        const f = r?.alvo === 'informacoes' ? r.draft : null
        return { ...base, alvo: 'informacoes', modo: 'completo', draft: f, fatos: f ? await planoInformacoes(tx, f) : [] }
      }
      case 'horarios': {
        const h = r?.alvo === 'horarios' ? r.draft : null
        const comHorario = (await tx.selectDistinct({ unitId: unitHours.unitId }).from(unitHours)).map((x) => x.unitId).sort()
        return { ...base, alvo: 'horarios', modo: 'completo', draft: h, unidades: h ? await planoHorarios(tx, h) : [], unidadesComHorario: comHorario }
      }
      case 'espacos': {
        const e = r?.alvo === 'espacos' ? r.draft : null
        const existentes = await tx.select({ unitId: eventSpaces.unitId, nome: eventSpaces.nome }).from(eventSpaces).orderBy(asc(eventSpaces.nome))
        return { ...base, alvo: 'espacos', modo: 'completo', draft: e, espacos: e ? await planoEspacos(tx, e) : [], espacosExistentes: existentes }
      }
    }
  })
}

// ---- aplicação ----
type Contagem = { criados: number; atualizados: number; ignorados: number }
/**
 * `ja_aplicado`: já aprovada; `nao_pronta`: ainda sem rascunho (recebendo arquivos, lendo), com erro ou descartada;
 * `arquivo_invalido`: arquivo de envio fora do cardápio completo ou que não está na importação.
 */
export type ErroAplicarImportacao = 'ja_aplicado' | 'nao_pronta' | 'rascunho_invalido' | 'unidade_nao_escolhida' | 'arquivo_invalido'
/**
 * Cardápio completo: um dos arquivos da importação (`ordem`) vira o cardápio para enviar aos clientes (como na Etapa
 * 05), em `unitId` ou em todas (null). Quem chama já copiou o objeto para o bucket `cardapio`.
 */
export type OpcoesAplicarImportacao = { arquivoDeEnvio?: { ordem: number; unitId: string | null } | null }
export type ResultadoAplicarImportacao = ResultadoPainel<Contagem> | { ok: false; erro: ErroAplicarImportacao }

/**
 * Confirmação humana (PRD I10) do rascunho revisado, numa transação: trava a importação, exige `rascunho`, valida o
 * rascunho enviado pelo schema do alvo (`rascunho_invalido`), aplica no cadastro do alvo, grava `aprovado` e audita
 * só alvo e contagens. Clique duplo/dois gerentes ⇒ a segunda vê `ja_aplicado`. Horário ou espaço marcado sem
 * unidade reconhecida ⇒ `unidade_nao_escolhida` e nada muda.
 */
export function aplicarImportacao(
  db: Db,
  claims: JwtClaims,
  id: string,
  rascunho: unknown,
  opcoes: OpcoesAplicarImportacao = {},
): Promise<ResultadoAplicarImportacao> {
  return semPermissaoVira<ResultadoAplicarImportacao, ErroPainel>(() => withUserContext(db, claims, async (tx): Promise<ResultadoAplicarImportacao> => {
    if (!(await podeEditarCardapioGeral(tx))) return falha('sem_permissao')
    // a policy de UPDATE só enxerga rascunho/erro: quem chega depois de outra aplicação não trava nada
    const [doc] = await tx
      .select({ restaurantId: knowledgeDocuments.restaurantId, status: knowledgeDocuments.status, alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for('update')
    const naoRascunho = (status: StatusImportacao): ResultadoAplicarImportacao =>
      ({ ok: false, erro: status === 'aprovado' ? 'ja_aplicado' : 'nao_pronta' })
    if (!doc) {
      // a trava passa pelas policies de UPDATE (rascunho/erro, ou recebendo arquivos): fora delas, o status diz o motivo
      const [atual] = await tx.select({ status: knowledgeDocuments.status }).from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
      return atual ? naoRascunho(atual.status) : falha('nao_encontrada')
    }
    if (doc.status !== 'rascunho') return naoRascunho(doc.status)
    const r = validarRascunho(doc.alvo, doc.modo, rascunho)
    if (r === null) return { ok: false, erro: 'rascunho_invalido' }
    // arquivo de envio: só no cardápio completo e de um arquivo desta importação; recusa antes de mexer no cadastro
    const envio = opcoes.arquivoDeEnvio ?? null
    let arquivo: { storagePath: string; mime: string; tamanho: number; sha256: string } | null = null
    if (envio !== null) {
      if (r.alvo !== 'cardapio' || r.modo !== 'completo') return { ok: false, erro: 'arquivo_invalido' }
      const [f] = await tx
        .select({ storagePath: knowledgeDocumentFiles.storagePath, mime: knowledgeDocumentFiles.mime, tamanho: knowledgeDocumentFiles.tamanho, sha256: knowledgeDocumentFiles.sha256 })
        .from(knowledgeDocumentFiles)
        .where(and(eq(knowledgeDocumentFiles.importacaoId, id), eq(knowledgeDocumentFiles.ordem, envio.ordem)))
      if (!f || !(MIMES_ARQUIVO_CARDAPIO as readonly string[]).includes(f.mime)) return { ok: false, erro: 'arquivo_invalido' }
      arquivo = f
    }

    const contagem = await aplicarNoAlvo(tx, doc.restaurantId, r)
    if (contagem === 'unidade_nao_escolhida') return { ok: false, erro: 'unidade_nao_escolhida' }
    if (arquivo !== null) {
      await gravarArquivo(tx, {
        unitId: envio!.unitId, titulo: tituloArquivoImportado(), storagePath: caminhoArquivoDeEnvio(arquivo.storagePath),
        mime: arquivo.mime, tamanho: arquivo.tamanho, sha256: arquivo.sha256,
      })
    }

    await tx
      .update(knowledgeDocuments)
      .set({ status: 'aprovado', draft: r.draft, revisadoPor: claims.sub, revisadoAt: sql`now()` })
      .where(eq(knowledgeDocuments.id, id))
    await registrarAuditoria(tx, claims, {
      restaurantId: doc.restaurantId, acao: 'importacao.aplicada', entidade: 'knowledge_document', entidadeId: id,
      diff: { alvo: doc.alvo, modo: doc.modo, ...contagem, ...(arquivo !== null ? { arquivoDeEnvio: true } : {}) },
    })
    return ok(contagem)
  }), { menu_files_storage_path_ck: 'sem_permissao' })
}

async function aplicarNoAlvo(tx: Tx, restaurantId: string, r: RascunhoDoAlvo): Promise<Contagem | 'unidade_nao_escolhida'> {
  switch (r.alvo) {
    case 'cardapio': {
      if (r.modo === 'so_precos') {
        const { mudancas, ignorados } = await planoSoPrecos(tx, r.draft)
        for (const m of mudancas) await tx.update(menuItems).set({ precoCentavos: m.depois }).where(eq(menuItems.id, m.itemId))
        return { criados: 0, atualizados: new Set(mudancas.map((m) => m.itemId)).size, ignorados: ignorados.length }
      }
      // o conflito de preço entre fotos é só para a revisão: vale o `precoCentavos` confirmado
      const c = await aplicarNoCardapio(tx, restaurantId, r.draft)
      const desmarcados = r.draft.categorias.reduce((n, cat) => n + cat.itens.filter((i) => !i.incluir).length, 0)
      return { criados: c.criados, atualizados: c.atualizados, ignorados: c.ignorados.length + desmarcados }
    }
    case 'informacoes':
      return aplicarInformacoes(tx, restaurantId, r.draft)
    case 'horarios':
      return aplicarHorarios(tx, restaurantId, r.draft)
    case 'espacos':
      return aplicarEspacos(tx, restaurantId, r.draft)
  }
}

async function aplicarInformacoes(tx: Tx, restaurantId: string, r: RascunhoInformacoes): Promise<Contagem> {
  const plano = await planoInformacoes(tx, r)
  const n: Contagem = { criados: 0, atualizados: 0, ignorados: 0 }
  // tema repetido no próprio rascunho: o segundo atualiza o que o primeiro criou
  const criadosAgora = new Map<string, string>()
  for (const [i, f] of r.fatos.entries()) {
    const p = plano[i]!
    if (p.acao === 'ignorar' || p.acao === 'unidade_desconhecida') { n.ignorados++; continue }
    const factId = p.factId ?? criadosAgora.get(chaveFato(p.unitId, f.tema)) ?? null
    if (factId === null) {
      const [novo] = await tx
        .insert(knowledgeFacts)
        .values({ restaurantId, unitId: p.unitId, tema: f.tema, texto: f.texto, exemplos: f.exemplos })
        .returning({ id: knowledgeFacts.id })
      criadosAgora.set(chaveFato(p.unitId, f.tema), novo!.id)
      n.criados++
    } else {
      // exemplos vazios mantêm os atuais; o tema cadastrado fica
      await tx.update(knowledgeFacts).set({ texto: f.texto, ...(f.exemplos.length ? { exemplos: f.exemplos } : {}) }).where(eq(knowledgeFacts.id, factId))
      // tema repetido no rascunho também conta como atualização (a soma fecha com as linhas)
      n.atualizados++
    }
  }
  return n
}

async function aplicarHorarios(tx: Tx, restaurantId: string, r: RascunhoHorarios): Promise<Contagem | 'unidade_nao_escolhida'> {
  const plano = await planoHorarios(tx, r)
  if (plano.some((p) => p.acao === 'escolher_unidade')) return 'unidade_nao_escolhida'
  const [{ hoje } = { hoje: '' }] = await tx
    .select({ hoje: sql<string>`(now() at time zone ${restaurants.timezone})::date::text` })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
  if (!hoje) throw new Error('restaurante não encontrado')
  const n: Contagem = { criados: 0, atualizados: 0, ignorados: 0 }
  for (const [i, u] of r.unidades.entries()) {
    const p = plano[i]!
    if (p.acao === 'ignorar' || p.unitId === null) { n.ignorados++; continue }
    const unitId = p.unitId
    // semana vazia = o documento só traz exceções: a grade fica como está; senão a semana inteira é substituída
    if (u.semana.length > 0) {
      const apagados = await tx.delete(unitHours).where(eq(unitHours.unitId, unitId)).returning({ id: unitHours.id })
      const linhas = u.semana.flatMap((d) => d.turnos.map((t, k) => ({ restaurantId, unitId, weekday: d.dia, turno: k + 1, abre: t.abre, fecha: t.fecha })))
      if (linhas.length > 0) await tx.insert(unitHours).values(linhas)
      if (apagados.length > 0) n.atualizados++
      else n.criados++
    }
    const datas = new Set((await tx.select({ data: unitHourExceptions.data }).from(unitHourExceptions).where(eq(unitHourExceptions.unitId, unitId))).map((e) => e.data))
    for (const e of u.excecoes) {
      if (e.data < hoje) { n.ignorados++; continue }
      const valores = { fechado: e.fechado, turnos: e.fechado ? [] : e.turnos.map((t) => ({ abre: t.abre, fecha: t.fecha })), motivo: e.motivo }
      await tx
        .insert(unitHourExceptions)
        .values({ restaurantId, unitId, data: e.data, ...valores })
        .onConflictDoUpdate({ target: [unitHourExceptions.unitId, unitHourExceptions.data], set: valores })
      if (datas.has(e.data)) n.atualizados++
      else n.criados++
      datas.add(e.data)
    }
  }
  return n
}

async function aplicarEspacos(tx: Tx, restaurantId: string, r: RascunhoEspacos): Promise<Contagem | 'unidade_nao_escolhida'> {
  const plano = await planoEspacos(tx, r)
  if (plano.some((p) => p.acao === 'escolher_unidade')) return 'unidade_nao_escolhida'
  const n: Contagem = { criados: 0, atualizados: 0, ignorados: 0 }
  const criadosAgora = new Map<string, string>()
  for (const [i, e] of r.espacos.entries()) {
    const p = plano[i]!
    if (p.acao === 'ignorar' || p.unitId === null) { n.ignorados++; continue }
    const spaceId = p.spaceId ?? criadosAgora.get(chaveEspaco(p.unitId, e.nome)) ?? null
    if (spaceId === null) {
      // SQL explícito: authenticated só tem INSERT nestas colunas (0024)
      const [novo] = await tx.execute<{ id: string }>(sql`
        insert into public.event_spaces (restaurant_id, unit_id, nome, capacidade_min, capacidade_max, descricao, condicoes, ativo)
        values (${restaurantId}, ${p.unitId}, ${e.nome}, ${e.capacidadeMin}, ${e.capacidadeMax}, ${e.descricao || null}, ${e.condicoes || null}, true)
        returning id`)
      criadosAgora.set(chaveEspaco(p.unitId, e.nome), novo!.id)
      n.criados++
    } else {
      // descrição/condições vazias mantêm as atuais; o nome cadastrado fica
      await tx
        .update(eventSpaces)
        .set({
          capacidadeMin: e.capacidadeMin, capacidadeMax: e.capacidadeMax,
          ...(e.descricao ? { descricao: e.descricao } : {}), ...(e.condicoes ? { condicoes: e.condicoes } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(eventSpaces.id, spaceId))
      n.atualizados++
    }
  }
  return n
}
