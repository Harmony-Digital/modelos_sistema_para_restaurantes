import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { units } from './schema/restaurant.ts'
import { menuCategories, menuFiles, menuItems, menuItemUnits } from './schema/s4.ts'

const GESTAO = ['dono', 'gerente'] as const

export type CategoriaPainel = { id: string; nome: string; ordem: number; ativo: boolean }
export type ItemPainel = {
  id: string
  categoryId: string
  nome: string
  descricao: string | null
  precoCentavos: number | null
  tags: string[]
  outrosNomes: string[]
  disponivel: boolean
  ordem: number
}
/** `disponivel` nulo = segue o item; `precoOverrideCentavos` nulo = preço do item. */
export type ExcecaoPainel = { itemId: string; unitId: string; disponivel: boolean | null; precoOverrideCentavos: number | null }
export type ArquivoPainel = {
  id: string
  unitId: string | null
  titulo: string
  storagePath: string
  mime: string
  tamanho: number
  ativo: boolean
  criadoEm: Date
}

/** Dono, ou gerente que acessa todas as unidades: só eles mexem no cardápio geral (categorias e itens). */
export async function podeEditarCardapioGeral(tx: Tx): Promise<boolean> {
  if (!(await exigirPapel(tx, GESTAO))) return false
  const [r] = await tx.execute<{ todas: boolean }>(sql`select app.acesso_todas_unidades() as todas`)
  return r?.todas === true
}

/** Cardápio para o painel (RLS): exceções e arquivos só das unidades visíveis; exceções "no padrão" ficam de fora. */
export function listarCardapio(
  db: Db,
  claims: JwtClaims,
): Promise<{ categorias: CategoriaPainel[]; itens: ItemPainel[]; excecoes: ExcecaoPainel[]; arquivos: ArquivoPainel[] }> {
  return withUserContext(db, claims, async (tx) => {
    const categorias = await tx
      .select({ id: menuCategories.id, nome: menuCategories.nome, ordem: menuCategories.ordem, ativo: menuCategories.ativo })
      .from(menuCategories)
      .orderBy(asc(menuCategories.ordem), asc(menuCategories.nome), asc(menuCategories.id))
    const itens = await tx
      .select({
        id: menuItems.id, categoryId: menuItems.categoryId, nome: menuItems.nome, descricao: menuItems.descricao,
        precoCentavos: menuItems.precoCentavos, tags: menuItems.tags, outrosNomes: menuItems.outrosNomes,
        disponivel: menuItems.disponivel, ordem: menuItems.ordem,
      })
      .from(menuItems)
      .orderBy(asc(menuItems.ordem), asc(menuItems.nome), asc(menuItems.id))
    const excecoes = await tx
      .select({
        itemId: menuItemUnits.itemId, unitId: menuItemUnits.unitId, disponivel: menuItemUnits.disponivel,
        precoOverrideCentavos: menuItemUnits.precoOverrideCentavos,
      })
      .from(menuItemUnits)
      .where(sql`(${menuItemUnits.disponivel} is not null or ${menuItemUnits.precoOverrideCentavos} is not null)`)
      .orderBy(asc(menuItemUnits.itemId), asc(menuItemUnits.unitId))
    const arquivos = await tx
      .select({
        id: menuFiles.id, unitId: menuFiles.unitId, titulo: menuFiles.titulo, storagePath: menuFiles.storagePath,
        mime: menuFiles.mime, tamanho: menuFiles.tamanho, ativo: menuFiles.ativo, criadoEm: menuFiles.createdAt,
      })
      .from(menuFiles)
      .orderBy(desc(menuFiles.createdAt), desc(menuFiles.id))
    return { categorias, itens, excecoes, arquivos }
  })
}

const RESTRICOES_CATEGORIA = { menu_categories_restaurant_nome_uq: 'nome_duplicado' } as const
const RESTRICOES_ITEM = { menu_items_category_nome_uq: 'nome_duplicado' } as const

/** Nome repetido (sem diferenciar caixa/acento) ⇒ `nome_duplicado`. */
export function salvarCategoria(
  db: Db,
  claims: JwtClaims,
  id: string | null,
  v: { nome: string; ordem: number; ativo: boolean },
): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await podeEditarCardapioGeral(tx))) return falha('sem_permissao')
    const diff = { nome: v.nome, ordem: v.ordem, ativo: v.ativo }
    if (id === null) {
      // SQL explícito: authenticated só tem INSERT nas colunas do formulário (0027)
      const [c] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
        insert into public.menu_categories (restaurant_id, nome, ordem, ativo)
        values ((select app.my_restaurant_id()), ${v.nome}, ${v.ordem}, ${v.ativo})
        returning id, restaurant_id`)
      await registrarAuditoria(tx, claims, { restaurantId: c!.restaurant_id, acao: 'cardapio.categoria_criada', entidade: 'menu_category', entidadeId: c!.id, diff })
      return ok({ id: c!.id })
    }
    const [c] = await tx
      .update(menuCategories)
      .set({ nome: v.nome, ordem: v.ordem, ativo: v.ativo })
      .where(eq(menuCategories.id, id))
      .returning({ id: menuCategories.id, restaurantId: menuCategories.restaurantId })
    if (!c) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId: c.restaurantId, acao: 'cardapio.categoria_atualizada', entidade: 'menu_category', entidadeId: id, diff })
    return ok({ id })
  }), RESTRICOES_CATEGORIA)
}

export type DadosItem = {
  categoryId: string
  nome: string
  descricao: string | null
  precoCentavos: number | null
  tags: string[]
  outrosNomes: string[]
  disponivel: boolean
  ordem: number
}

/** Categoria invisível (outro restaurante/inexistente) ⇒ `nao_encontrada`; nome repetido na categoria ⇒ `nome_duplicado`. */
export function salvarItem(db: Db, claims: JwtClaims, id: string | null, v: DadosItem): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await podeEditarCardapioGeral(tx))) return falha('sem_permissao')
    const [cat] = await tx
      .select({ restaurantId: menuCategories.restaurantId })
      .from(menuCategories)
      .where(eq(menuCategories.id, v.categoryId))
    if (!cat) return falha('nao_encontrada')
    const diff = { ...v }
    if (id === null) {
      const [i] = await tx.execute<{ id: string }>(sql`
        insert into public.menu_items (restaurant_id, category_id, nome, descricao, preco_centavos, tags, outros_nomes, disponivel, ordem)
        values (${cat.restaurantId}, ${v.categoryId}, ${v.nome}, ${v.descricao}, ${v.precoCentavos},
                ${sql.param(v.tags)}::text[], ${sql.param(v.outrosNomes)}::text[], ${v.disponivel}, ${v.ordem})
        returning id`)
      await registrarAuditoria(tx, claims, { restaurantId: cat.restaurantId, acao: 'cardapio.item_criado', entidade: 'menu_item', entidadeId: i!.id, diff })
      return ok({ id: i!.id })
    }
    const [i] = await tx
      .update(menuItems)
      .set({
        categoryId: v.categoryId, nome: v.nome, descricao: v.descricao, precoCentavos: v.precoCentavos, tags: v.tags,
        outrosNomes: v.outrosNomes, disponivel: v.disponivel, ordem: v.ordem,
      })
      .where(eq(menuItems.id, id))
      .returning({ id: menuItems.id })
    if (!i) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId: cat.restaurantId, acao: 'cardapio.item_atualizado', entidade: 'menu_item', entidadeId: id, diff })
    return ok({ id })
  }), RESTRICOES_ITEM)
}

export type DadosExcecao =
  | { itemId: string; unitId: string; disponivel: boolean; precoOverrideCentavos: number | null }
  | { itemId: string; unitId: string; remover: true }

/**
 * Exceção do item numa unidade (gerente restrito: só nas suas). `remover` volta ao padrão sem DELETE
 * (disponível e preço nulos = segue o item). Item ou unidade invisível ⇒ `nao_encontrada`.
 */
export function salvarExcecaoItem(db: Db, claims: JwtClaims, v: DadosExcecao): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [item] = await tx.select({ restaurantId: menuItems.restaurantId }).from(menuItems).where(eq(menuItems.id, v.itemId))
    const [unidade] = await tx.select({ id: units.id }).from(units).where(eq(units.id, v.unitId))
    if (!item || !unidade) return falha('nao_encontrada')
    const base = { restaurantId: item.restaurantId, entidade: 'menu_item', entidadeId: v.itemId }
    if ('remover' in v) {
      const r = await tx
        .update(menuItemUnits)
        .set({ disponivel: null, precoOverrideCentavos: null })
        .where(and(eq(menuItemUnits.itemId, v.itemId), eq(menuItemUnits.unitId, v.unitId)))
        .returning({ itemId: menuItemUnits.itemId })
      // sem exceção gravada: já está no padrão
      if (r.length > 0) await registrarAuditoria(tx, claims, { ...base, acao: 'cardapio.excecao_removida', diff: { unitId: v.unitId } })
      return ok(null)
    }
    await tx.execute(sql`
      insert into public.menu_item_units (item_id, unit_id, restaurant_id, disponivel, preco_override_centavos)
      values (${v.itemId}, ${v.unitId}, ${item.restaurantId}, ${v.disponivel}, ${v.precoOverrideCentavos})
      on conflict (item_id, unit_id) do update
        set disponivel = excluded.disponivel, preco_override_centavos = excluded.preco_override_centavos`)
    await registrarAuditoria(tx, claims, {
      ...base, acao: 'cardapio.excecao_salva',
      diff: { unitId: v.unitId, disponivel: v.disponivel, precoOverrideCentavos: v.precoOverrideCentavos },
    })
    return ok(null)
  }))
}

export type DadosArquivo = { unitId: string | null; titulo: string; storagePath: string; mime: string; tamanho: number; sha256: string }

/** Arquivo já enviado ao Storage (`cardapio/<restaurant_id>/…`). Mesmo sha256 no mesmo escopo ⇒ devolve o existente. */
export function registrarArquivoCardapio(db: Db, claims: JwtClaims, v: DadosArquivo): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const r = await gravarArquivo(tx, v)
    if (r.novo) {
      await registrarAuditoria(tx, claims, {
        restaurantId: r.restaurantId, acao: 'cardapio.arquivo_registrado', entidade: 'menu_file', entidadeId: r.id,
        diff: { unitId: v.unitId, titulo: v.titulo, mime: v.mime, tamanho: v.tamanho },
      })
    }
    return ok({ id: r.id })
  }), { menu_files_storage_path_ck: 'sem_permissao' })
}

/** Dedup + insert sob RLS (a policy confere papel, unidade e a pasta do restaurante no caminho). */
export async function gravarArquivo(tx: Tx, v: DadosArquivo): Promise<{ id: string; restaurantId: string; novo: boolean }> {
  const [existente] = await tx
    .select({ id: menuFiles.id, restaurantId: menuFiles.restaurantId })
    .from(menuFiles)
    .where(and(
      eq(menuFiles.sha256, v.sha256),
      v.unitId === null ? isNull(menuFiles.unitId) : eq(menuFiles.unitId, v.unitId),
    ))
  if (existente) return { ...existente, novo: false }
  const [f] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
    insert into public.menu_files (restaurant_id, unit_id, titulo, storage_path, mime, tamanho, sha256, ativo)
    values ((select app.my_restaurant_id()), ${v.unitId}, ${v.titulo}, ${v.storagePath}, ${v.mime}, ${v.tamanho}, ${v.sha256}, true)
    returning id, restaurant_id`)
  return { id: f!.id, restaurantId: f!.restaurant_id, novo: true }
}

/** Remover um arquivo de cardápio = desativar (sem DELETE). */
export function ativarArquivo(db: Db, claims: JwtClaims, id: string, ativo: boolean): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [f] = await tx
      .update(menuFiles)
      .set({ ativo })
      .where(eq(menuFiles.id, id))
      .returning({ restaurantId: menuFiles.restaurantId })
    if (!f) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId: f.restaurantId, acao: 'cardapio.arquivo_ativo', entidade: 'menu_file', entidadeId: id, diff: { ativo } })
    return ok(null)
  }))
}

