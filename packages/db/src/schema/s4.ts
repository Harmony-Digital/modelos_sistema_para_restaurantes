import { sql, type SQL } from 'drizzle-orm'
import {
  boolean, check, customType, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { restaurants, timestamps, units } from './restaurant.ts'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const restaurantFk = () =>
  uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' })

/**
 * Caminho no Storage: `<bucket>/<restaurant_id>/<arquivo>`. O primeiro segmento diz o bucket (o worker baixa de lá);
 * o segundo é o restaurante (as policies de Storage e de `menu_files`/`knowledge_documents` conferem).
 */
// Caminho no Storage: `<bucket>/<restaurant_id>/<arquivo>`. O primeiro segmento diz o bucket (o worker baixa de lá);
// o segundo é o restaurante (as policies de Storage e de menu_files/knowledge_documents conferem).
// Índices de expressão (nome normalizado único, trigram em nome/outros nomes) vivem na migration custom 0027.
export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    nome: text('nome').notNull(),
    ordem: integer('ordem').notNull().default(0),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check('menu_categories_nome_ck', sql`char_length(${t.nome}) between 1 and 80`),
    // alvo da FK composta (category_id, restaurant_id) de menu_items
    uniqueIndex('menu_categories_id_restaurant_uq').on(t.id, t.restaurantId),
    index('menu_categories_restaurant_idx').on(t.restaurantId, t.ordem),
  ],
)

export const menuItems = pgTable(
  'menu_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    categoryId: uuid('category_id').notNull(),
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    /** centavos; null = "preço sob consulta" */
    precoCentavos: integer('preco_centavos'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    outrosNomes: text('outros_nomes').array().notNull().default(sql`'{}'::text[]`),
    disponivel: boolean('disponivel').notNull().default(true),
    ordem: integer('ordem').notNull().default(0),
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('portuguese'::regconfig, app.f_unaccent(${menuItems.nome})), 'A') || setweight(to_tsvector('portuguese'::regconfig, app.f_unaccent(coalesce(${menuItems.descricao}, '') || ' ' || app.f_juntar(${menuItems.outrosNomes}) || ' ' || app.f_juntar(${menuItems.tags}))), 'B')`,
      ),
    ...timestamps,
  },
  (t) => [
    // FK composta (category_id, restaurant_id) → menu_categories (id, restaurant_id) vive na 0027: o drizzle-kit cria
    // as FKs antes dos índices únicos que elas referenciam (mesmo motivo da 0025)
    check('menu_items_nome_ck', sql`char_length(${t.nome}) between 1 and 80`),
    check('menu_items_descricao_ck', sql`${t.descricao} is null or char_length(${t.descricao}) <= 300`),
    check('menu_items_preco_ck', sql`${t.precoCentavos} is null or ${t.precoCentavos} between 0 and 10000000`),
    check('menu_items_listas_ck', sql`cardinality(${t.tags}) <= 10 and cardinality(${t.outrosNomes}) <= 10`),
    // alvo da FK composta (item_id, restaurant_id) de menu_item_units
    uniqueIndex('menu_items_id_restaurant_uq').on(t.id, t.restaurantId),
    index('menu_items_search_idx').using('gin', t.search),
    index('menu_items_category_idx').on(t.categoryId, t.ordem),
    index('menu_items_restaurant_idx').on(t.restaurantId),
  ],
)

/**
 * Só exceções por unidade. `disponivel` nulo = segue o item; `preco_override_centavos` nulo = preço do item.
 * Linha com os dois nulos equivale a não ter exceção ("voltar ao padrão" sem DELETE).
 */
export const menuItemUnits = pgTable(
  'menu_item_units',
  {
    itemId: uuid('item_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    restaurantId: restaurantFk(),
    disponivel: boolean('disponivel'),
    precoOverrideCentavos: integer('preco_override_centavos'),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.unitId], name: 'menu_item_units_pk' }),
    // FK composta (item_id, restaurant_id) → menu_items (id, restaurant_id) vive na 0027 (ver menu_items)
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'menu_item_units_unit_fk' })
      .onDelete('cascade'),
    check('menu_item_units_preco_ck', sql`${t.precoOverrideCentavos} is null or ${t.precoOverrideCentavos} between 0 and 10000000`),
    index('menu_item_units_unit_idx').on(t.unitId),
    index('menu_item_units_restaurant_idx').on(t.restaurantId),
  ],
)

export const menuFiles = pgTable(
  'menu_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    /** null = cardápio geral (todas as unidades) */
    unitId: uuid('unit_id'),
    titulo: text('titulo').notNull(),
    storagePath: text('storage_path').notNull(),
    mime: text('mime').notNull(),
    tamanho: integer('tamanho').notNull(),
    sha256: text('sha256').notNull(),
    waMediaId: text('wa_media_id'),
    waMediaExpiresAt: timestamp('wa_media_expires_at', { withTimezone: true }),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'menu_files_unit_fk' })
      .onDelete('cascade'),
    check('menu_files_titulo_ck', sql`char_length(${t.titulo}) between 1 and 120`),
    check('menu_files_storage_path_ck', sql`${t.storagePath} ~ '^(cardapio|importacoes)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'`),
    check('menu_files_mime_ck', sql`${t.mime} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')`),
    check('menu_files_tamanho_ck', sql`${t.tamanho} between 1 and 20971520`),
    check('menu_files_sha256_ck', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    // dedup (mesmo arquivo no mesmo escopo, geral ou unidade): índice único `nulls not distinct` na 0027
    index('menu_files_envio_idx').on(t.restaurantId, t.unitId).where(sql`${t.ativo}`),
  ],
)

export const STATUS_IMPORTACAO = ['enviado', 'processando', 'rascunho', 'aprovado', 'rejeitado', 'erro'] as const
export const knowledgeDocumentStatus = pgEnum('knowledge_document_status', STATUS_IMPORTACAO)
export const knowledgeDocumentOrigin = pgEnum('knowledge_document_origin', ['csv', 'arquivo'])
export const ALVOS_IMPORTACAO = ['cardapio', 'informacoes', 'horarios', 'espacos'] as const
export const MODOS_IMPORTACAO = ['completo', 'so_precos'] as const
export const knowledgeDocumentTarget = pgEnum('knowledge_document_target', ALVOS_IMPORTACAO)
export const knowledgeDocumentMode = pgEnum('knowledge_document_mode', MODOS_IMPORTACAO)
/** Arquivos por importação (Etapa 07): até 10, cada um até 20 MB. */
export const MAX_ARQUIVOS_IMPORTACAO = 10

/**
 * Documentos importados (PRD §3.6). Nunca viram dado oficial sem aprovação humana (I10).
 * Duas formas de `origem = 'arquivo'`: a da Etapa 05 (um arquivo: `storage_path`, `mime`, `tamanho` e `sha256` dele) e a
 * da Etapa 07 (vários arquivos em `knowledge_document_files`: `storage_path`/`mime`/`tamanho` nulos e `sha256` = hash do
 * conjunto, gravado só quando a leitura começa — nulo = ainda recebendo arquivos).
 */
export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    alvo: knowledgeDocumentTarget('alvo').notNull().default('cardapio'),
    /** `so_precos` só no cardápio */
    modo: knowledgeDocumentMode('modo').notNull().default('completo'),
    origem: knowledgeDocumentOrigin('origem').notNull(),
    status: knowledgeDocumentStatus('status').notNull(),
    /** null no CSV (lido no servidor, só o rascunho fica) e na importação com vários arquivos */
    storagePath: text('storage_path'),
    mime: text('mime'),
    tamanho: integer('tamanho'),
    sha256: text('sha256'),
    /** rascunho do alvo validado por Zod */
    draft: jsonb('draft'),
    /** próximo lote a ler (0 = nenhum lido); lotes_total calculado no primeiro passo do worker */
    loteAtual: integer('lote_atual').notNull().default(0),
    lotesTotal: integer('lotes_total'),
    /** junção dos lotes já lidos (some ao concluir) */
    draftParcial: jsonb('draft_parcial'),
    /** mensagem amigável para o painel (nunca detalhe técnico nem conteúdo do documento) */
    erro: text('erro'),
    enviadoPor: uuid('enviado_por').references(() => authUsers.id, { onDelete: 'set null' }),
    revisadoPor: uuid('revisado_por').references(() => authUsers.id, { onDelete: 'set null' }),
    revisadoAt: timestamp('revisado_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('knowledge_documents_storage_ck', sql`(${t.origem} = 'csv' and ${t.storagePath} is null and ${t.mime} is not null and ${t.tamanho} is not null and ${t.sha256} is not null) or (${t.origem} = 'arquivo' and ${t.storagePath} ~ '^importacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' and ${t.mime} is not null and ${t.tamanho} is not null and ${t.sha256} is not null) or (${t.origem} = 'arquivo' and ${t.storagePath} is null and ${t.mime} is null and ${t.tamanho} is null)`),
    check('knowledge_documents_mime_ck', sql`${t.mime} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv')`),
    check('knowledge_documents_tamanho_ck', sql`${t.tamanho} between 1 and 20971520`),
    check('knowledge_documents_sha256_ck', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('knowledge_documents_erro_ck', sql`${t.erro} is null or char_length(${t.erro}) <= 300`),
    // só preços é do cardápio; CSV só existe para o cardápio
    check('knowledge_documents_modo_ck', sql`${t.modo} = 'completo' or ${t.alvo} = 'cardapio'`),
    check('knowledge_documents_csv_alvo_ck', sql`${t.origem} = 'arquivo' or ${t.alvo} = 'cardapio'`),
    check('knowledge_documents_lotes_ck', sql`${t.loteAtual} >= 0 and (${t.lotesTotal} is null or (${t.lotesTotal} between 1 and 1000 and ${t.loteAtual} <= ${t.lotesTotal}))`),
    index('knowledge_documents_restaurant_idx').on(t.restaurantId, t.createdAt),
    // alvo da FK composta (importacao_id, restaurant_id) de knowledge_document_files
    uniqueIndex('knowledge_documents_id_restaurant_uq').on(t.id, t.restaurantId),
    // dedup: o mesmo arquivo (ou conjunto) do mesmo alvo e modo em andamento ou aprovado é uma importação só
    // (rejeitada/erro liberam; sha256 nulo — ainda recebendo arquivos — não conflita)
    uniqueIndex('knowledge_documents_arquivo_sha256_uq')
      .on(t.restaurantId, t.alvo, t.modo, t.sha256)
      .where(sql`${t.origem} = 'arquivo' and ${t.status} not in ('rejeitado', 'erro')`),
  ],
)

/** Arquivos de uma importação (Etapa 07), lidos na ordem. Só mudam enquanto a importação recebe arquivos. */
export const knowledgeDocumentFiles = pgTable(
  'knowledge_document_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    // FK composta (importacao_id, restaurant_id) → knowledge_documents (id, restaurant_id) vive na migration custom
    importacaoId: uuid('importacao_id').notNull(),
    ordem: smallint('ordem').notNull(),
    storagePath: text('storage_path').notNull(),
    mime: text('mime').notNull(),
    tamanho: integer('tamanho').notNull(),
    sha256: text('sha256').notNull(),
    /** páginas do PDF (o worker preenche); null em imagem */
    paginas: integer('paginas'),
    ...timestamps,
  },
  (t) => [
    check('knowledge_document_files_ordem_ck', sql`${t.ordem} between 1 and 10`),
    check('knowledge_document_files_storage_ck', sql`${t.storagePath} ~ '^importacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'`),
    check('knowledge_document_files_mime_ck', sql`${t.mime} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')`),
    check('knowledge_document_files_tamanho_ck', sql`${t.tamanho} between 1 and 20971520`),
    check('knowledge_document_files_sha256_ck', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('knowledge_document_files_paginas_ck', sql`${t.paginas} is null or ${t.paginas} between 1 and 5000`),
    uniqueIndex('knowledge_document_files_ordem_uq').on(t.importacaoId, t.ordem),
    // o mesmo arquivo duas vezes na mesma importação é um só
    uniqueIndex('knowledge_document_files_sha256_uq').on(t.importacaoId, t.sha256),
    index('knowledge_document_files_restaurant_idx').on(t.restaurantId),
  ],
)
