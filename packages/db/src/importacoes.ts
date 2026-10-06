import { and, desc, eq, sql } from 'drizzle-orm'
import { normalizeText } from '@atd/core'
import { rascunhoSchema, type RascunhoCardapio } from '@atd/core/s4'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { gravarArquivo, podeEditarCardapioGeral } from './painel-cardapio.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { units } from './schema/restaurant.ts'
import { knowledgeDocuments, menuCategories, menuFiles, menuItems, type STATUS_IMPORTACAO } from './schema/s4.ts'

const GESTAO = ['dono', 'gerente'] as const

export type StatusImportacao = (typeof STATUS_IMPORTACAO)[number]
export type OrigemImportacao = 'csv' | 'arquivo'
export type ImportacaoPainel = {
  id: string
  origem: OrigemImportacao
  status: StatusImportacao
  /** `importacoes/<restaurant_id>/<arquivo>`; null no CSV */
  storagePath: string | null
  mime: string
  tamanho: number
  draft: RascunhoCardapio | null
  /** mensagem amigável (status `erro`) */
  erro: string | null
  criadoEm: Date
  revisadoEm: Date | null
}

/** Mensagem do painel quando a leitura devolve algo fora do formato do rascunho. */
export const ERRO_RASCUNHO_INVALIDO = 'Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV.'

const colunas = {
  id: knowledgeDocuments.id, origem: knowledgeDocuments.origem, status: knowledgeDocuments.status,
  storagePath: knowledgeDocuments.storagePath, mime: knowledgeDocuments.mime, tamanho: knowledgeDocuments.tamanho,
  draft: knowledgeDocuments.draft, erro: knowledgeDocuments.erro, criadoEm: knowledgeDocuments.createdAt,
  revisadoEm: knowledgeDocuments.revisadoAt,
}
type Linha = Omit<ImportacaoPainel, 'draft'> & { draft: unknown }
const paraPainel = (r: Linha): ImportacaoPainel => {
  const d = r.draft == null ? null : rascunhoSchema.safeParse(r.draft)
  return { ...r, draft: d?.success ? d.data : null }
}

export type NovaImportacao = {
  storagePath: string | null
  mime: string
  tamanho: number
  sha256: string
  origem: OrigemImportacao
  /** obrigatório no CSV (lido no servidor); ignorado no arquivo (quem lê é o worker) */
  draft?: unknown
}

/**
 * Registra a importação (dono/gerente). CSV nasce `rascunho` com o draft (validado por Zod — inválido lança);
 * arquivo nasce `enviado`. Só grava: quem enfileira a leitura é a Server Action.
 */
export async function criarImportacao(db: Db, claims: JwtClaims, v: NovaImportacao): Promise<ResultadoPainel<{ id: string }>> {
  const draft = v.origem === 'csv' ? rascunhoSchema.parse(v.draft) : null
  const status: StatusImportacao = v.origem === 'csv' ? 'rascunho' : 'enviado'
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    // SQL explícito: authenticated só tem INSERT nas colunas permitidas (0027); a policy confere status e autor
    const [d] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
      insert into public.knowledge_documents (restaurant_id, origem, status, storage_path, mime, tamanho, sha256, draft, enviado_por)
      values ((select app.my_restaurant_id()), ${v.origem}, ${status}, ${v.storagePath}, ${v.mime}, ${v.tamanho}, ${v.sha256},
              ${draft === null ? null : JSON.stringify(draft)}::jsonb, ${claims.sub})
      returning id, restaurant_id`)
    await registrarAuditoria(tx, claims, {
      restaurantId: d!.restaurant_id, acao: 'cardapio.importacao_criada', entidade: 'knowledge_document', entidadeId: d!.id,
      diff: { origem: v.origem, mime: v.mime, tamanho: v.tamanho },
    })
    return ok({ id: d!.id })
  }), { knowledge_documents_storage_ck: 'sem_permissao' })
}

/** Dono/gerente do restaurante (RLS); outro restaurante ou atendente ⇒ null. */
export function lerImportacao(db: Db, claims: JwtClaims, id: string): Promise<ImportacaoPainel | null> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select(colunas).from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
    return r ? paraPainel(r) : null
  })
}

/** As 20 importações mais recentes. */
export function listarImportacoes(db: Db, claims: JwtClaims): Promise<ImportacaoPainel[]> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select(colunas)
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt), desc(knowledgeDocuments.id))
      .limit(20)
    return rows.map(paraPainel)
  })
}

export type OpcoesAplicar = { usarComoArquivoDeEnvio: boolean; unitIdArquivo: string | null }
export type ResultadoAplicar = ResultadoPainel<{ criados: number; atualizados: number }> | { ok: false; erro: 'ja_aplicado' }

/**
 * Confirmação humana do rascunho (PRD I10), numa transação: trava a importação, exige `rascunho`, cria categorias e
 * itens novos e atualiza os existentes (mesmo nome normalizado na mesma categoria: preço, descrição, tags, outros
 * nomes). Item com `unidade` reconhecida ⇒ preço próprio naquela unidade (o preço padrão só nasce com o item).
 * `incluir: false` é ignorado. Auditoria só com contagens.
 */
export async function aplicarRascunho(
  db: Db,
  claims: JwtClaims,
  id: string,
  rascunho: RascunhoCardapio,
  opcoes: OpcoesAplicar,
): Promise<ResultadoAplicar> {
  const r = rascunhoSchema.parse(rascunho)
  return semPermissaoVira<ResultadoAplicar>(() => withUserContext(db, claims, async (tx): Promise<ResultadoAplicar> => {
    if (!(await podeEditarCardapioGeral(tx))) return falha('sem_permissao')
    // a policy de UPDATE só enxerga rascunho/erro: quem chega depois de outra aplicação não trava nada
    const [doc] = await tx
      .select({
        restaurantId: knowledgeDocuments.restaurantId, status: knowledgeDocuments.status, storagePath: knowledgeDocuments.storagePath,
        mime: knowledgeDocuments.mime, tamanho: knowledgeDocuments.tamanho, sha256: knowledgeDocuments.sha256,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for('update')
    if (!doc) return (await existe(tx, id)) ? { ok: false, erro: 'ja_aplicado' } : falha('nao_encontrada')
    if (doc.status !== 'rascunho') return { ok: false, erro: 'ja_aplicado' }

    const contagem = await aplicarNoCardapio(tx, doc.restaurantId, r)

    if (opcoes.usarComoArquivoDeEnvio && doc.storagePath !== null) {
      const f = await gravarArquivo(tx, {
        unitId: opcoes.unitIdArquivo, titulo: 'Cardápio', storagePath: doc.storagePath, mime: doc.mime, tamanho: doc.tamanho, sha256: doc.sha256,
      })
      if (!f.novo) await tx.update(menuFiles).set({ ativo: true }).where(eq(menuFiles.id, f.id))
    }

    await tx
      .update(knowledgeDocuments)
      .set({ status: 'aprovado', draft: r, revisadoPor: claims.sub, revisadoAt: sql`now()` })
      .where(eq(knowledgeDocuments.id, id))
    await registrarAuditoria(tx, claims, {
      restaurantId: doc.restaurantId, acao: 'cardapio.importacao_aplicada', entidade: 'knowledge_document', entidadeId: id,
      diff: { ...contagem, arquivoDeEnvio: opcoes.usarComoArquivoDeEnvio && doc.storagePath !== null },
    })
    return ok({ criados: contagem.criados, atualizados: contagem.atualizados })
  }), { menu_files_storage_path_ck: 'sem_permissao' })
}

async function existe(tx: Tx, id: string): Promise<boolean> {
  const [r] = await tx.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  return r !== undefined
}

async function aplicarNoCardapio(
  tx: Tx,
  restaurantId: string,
  r: RascunhoCardapio,
): Promise<{ criados: number; atualizados: number; categoriasCriadas: number; precosPorUnidade: number }> {
  const cats = await tx
    .select({ id: menuCategories.id, nome: menuCategories.nome, ordem: menuCategories.ordem })
    .from(menuCategories)
  const categoriaPorNome = new Map(cats.map((c) => [normalizeText(c.nome), c.id]))
  let proximaOrdem = cats.reduce((m, c) => Math.max(m, c.ordem), 0) + 1
  const its = await tx.select({ id: menuItems.id, categoryId: menuItems.categoryId, nome: menuItems.nome }).from(menuItems)
  const itemPorChave = new Map(its.map((i) => [`${i.categoryId}|${normalizeText(i.nome)}`, i.id]))
  const us = await tx.select({ id: units.id, nome: units.nome, slug: units.slug, apelidos: units.apelidos }).from(units)
  const unidadePorNome = new Map<string, string>()
  for (const u of us) for (const n of [u.nome, u.slug, ...u.apelidos]) unidadePorNome.set(normalizeText(n), u.id)

  const criados = new Set<string>()
  const atualizados = new Set<string>()
  let categoriasCriadas = 0
  let precosPorUnidade = 0

  for (const c of r.categorias) {
    const itens = c.itens.filter((i) => i.incluir)
    if (itens.length === 0) continue
    let categoryId = categoriaPorNome.get(normalizeText(c.nome))
    if (!categoryId) {
      const [nova] = await tx.execute<{ id: string }>(sql`
        insert into public.menu_categories (restaurant_id, nome, ordem, ativo)
        values (${restaurantId}, ${c.nome}, ${proximaOrdem++}, true) returning id`)
      categoryId = nova!.id
      categoriaPorNome.set(normalizeText(c.nome), categoryId)
      categoriasCriadas++
    }
    for (const [ordem, i] of itens.entries()) {
      const unitId = i.unidade === null ? null : (unidadePorNome.get(normalizeText(i.unidade)) ?? null)
      const chave = `${categoryId}|${normalizeText(i.nome)}`
      let itemId = itemPorChave.get(chave)
      if (!itemId) {
        const [novo] = await tx.execute<{ id: string }>(sql`
          insert into public.menu_items (restaurant_id, category_id, nome, descricao, preco_centavos, tags, outros_nomes, disponivel, ordem)
          values (${restaurantId}, ${categoryId}, ${i.nome}, ${i.descricao}, ${i.precoCentavos},
                  ${sql.param(i.tags)}::text[], ${sql.param(i.outrosNomes)}::text[], true, ${ordem + 1})
          returning id`)
        itemId = novo!.id
        itemPorChave.set(chave, itemId)
        criados.add(itemId)
      } else {
        await tx
          .update(menuItems)
          .set({
            descricao: i.descricao, tags: i.tags, outrosNomes: i.outrosNomes,
            // preço de uma unidade não mexe no preço padrão
            ...(unitId === null ? { precoCentavos: i.precoCentavos } : {}),
          })
          .where(eq(menuItems.id, itemId))
        if (!criados.has(itemId)) atualizados.add(itemId)
      }
      if (unitId !== null) {
        await tx.execute(sql`
          insert into public.menu_item_units (item_id, unit_id, restaurant_id, preco_override_centavos)
          values (${itemId}, ${unitId}, ${restaurantId}, ${i.precoCentavos})
          on conflict (item_id, unit_id) do update set preco_override_centavos = excluded.preco_override_centavos`)
        precosPorUnidade++
      }
    }
  }
  return { criados: criados.size, atualizados: atualizados.size, categoriasCriadas, precosPorUnidade }
}

/** Descarta o rascunho (ou a importação com erro). Já aprovada/rejeitada ⇒ `nao_encontrada`. */
export function rejeitarImportacao(db: Db, claims: JwtClaims, id: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [d] = await tx
      .update(knowledgeDocuments)
      .set({ status: 'rejeitado', revisadoPor: claims.sub, revisadoAt: sql`now()` })
      .where(and(eq(knowledgeDocuments.id, id), sql`${knowledgeDocuments.status} in ('rascunho', 'erro')`))
      .returning({ restaurantId: knowledgeDocuments.restaurantId })
    if (!d) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId: d.restaurantId, acao: 'cardapio.importacao_rejeitada', entidade: 'knowledge_document', entidadeId: id })
    return ok(null)
  }))
}

// ============ worker (job document.ingest) ============

/** Passa de `enviado` a `processando` (uma vez só). Devolve onde está o arquivo, ou null se não estava `enviado`. */
export async function marcarProcessando(
  db: Db | Tx,
  id: string,
): Promise<{ storagePath: string; mime: string; restaurantId: string } | null> {
  const [r] = await db
    .update(knowledgeDocuments)
    .set({ status: 'processando' })
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.status, 'enviado')))
    .returning({ storagePath: knowledgeDocuments.storagePath, mime: knowledgeDocuments.mime, restaurantId: knowledgeDocuments.restaurantId })
  // origem 'arquivo' sempre tem caminho (check knowledge_documents_storage_ck)
  return r && r.storagePath !== null ? { storagePath: r.storagePath, mime: r.mime, restaurantId: r.restaurantId } : null
}

/**
 * Resultado da leitura (só de `processando`): rascunho válido ⇒ `rascunho`; falha ou rascunho fora do schema ⇒
 * `erro` com mensagem amigável (até 300 caracteres; nunca detalhe técnico nem conteúdo do documento).
 */
export async function concluirIngestao(
  db: Db | Tx,
  id: string,
  r: { ok: true; draft: unknown } | { ok: false; erro: string },
): Promise<void> {
  const d = r.ok ? rascunhoSchema.safeParse(r.draft) : null
  const set = d?.success
    ? { status: 'rascunho' as const, draft: d.data, erro: null }
    : { status: 'erro' as const, draft: null, erro: (r.ok ? ERRO_RASCUNHO_INVALIDO : r.erro).slice(0, 300) }
  await db
    .update(knowledgeDocuments)
    .set(set)
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.status, 'processando')))
}
