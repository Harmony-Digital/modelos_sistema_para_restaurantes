import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import type { Tx } from './rls.ts'
import { menuFiles } from './schema/s4.ts'

/** Teto de candidatos devolvidos à composição da resposta (S4). */
export const LIMITE_BUSCA_CARDAPIO = 8
/**
 * Limiar de `word_similarity` (operador `<%`, usa o índice trigram). O padrão do pg_trgm (0,6) não pega
 * "pikanha" ⇒ "picanha" (0,45); 0,4 pega um erro de letra em palavras curtas sem trazer itens sem relação.
 */
export const LIMIAR_TRIGRAMA = '0.4'

export type PrecoNaUnidade = { unitId: string; disponivel: boolean; precoCentavos: number | null }
export type ItemEncontrado = {
  id: string
  nome: string
  descricao: string | null
  categoria: string
  tags: string[]
  precoBaseCentavos: number | null
  /** unidades ativas do restaurante, com disponibilidade e preço efetivos (exceção da unidade ou o do item) */
  porUnidade: PrecoNaUnidade[]
  rank: number
  /**
   * Só parece com a consulta (trigrama da frase inteira), sem corresponder: "carne de sol" × "Carne de porco".
   * O core oferece como sugestão ("Não encontrei… Temos parecido"), nunca como "Temos sim".
   */
  parecido: boolean
}

type LinhaBusca = {
  id: string
  nome: string
  descricao: string | null
  categoria: string
  tags: string[]
  preco_base_centavos: number | null
  por_unidade: PrecoNaUnidade[]
  rank: number
  parecido: boolean
}

/**
 * Busca no cardápio do restaurante (worker). Full-text em português sem acento (nome peso A; descrição, outros nomes e
 * tags peso B) **ou** semelhança de trigramas (erro de digitação) no nome e nos outros nomes. Só categorias ativas e
 * itens disponíveis no padrão ou em alguma unidade ativa. Sem consulta: lista na ordem do cardápio (útil com `tag`).
 * **Correspondência** (`parecido = false`): o full-text casa, ou toda palavra da consulta (3+ letras) casa por trigrama
 * com alguma palavra do nome/outros nomes (erro de digitação: "picanah"). O resto que só parece pela frase inteira vem
 * como `parecido` e depois das correspondências.
 * Tudo parametrizado; a consulta do cliente é só texto.
 */
export async function buscarCardapio(
  db: Db | Tx,
  p: { restaurantId: string; consulta: string | null; tag: string | null; limite?: number },
): Promise<ItemEncontrado[]> {
  const consulta = p.consulta?.trim() ? p.consulta.trim().slice(0, 200) : null
  const limite = Math.max(1, Math.min(p.limite ?? LIMITE_BUSCA_CARDAPIO, LIMITE_BUSCA_CARDAPIO))
  const rows = await db.transaction(async (tx) => {
    // local à transação (ou ao savepoint, se já houver transação): não vaza para outras consultas da conexão
    await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', ${LIMIAR_TRIGRAMA}, true)`)
    return tx.execute<LinhaBusca>(sql`
    with q as (
      select websearch_to_tsquery('portuguese'::regconfig, app.f_unaccent(${consulta}::text)) as tsq,
             app.f_unaccent(lower(${consulta}::text)) as termo,
             array(select w from regexp_split_to_table(app.f_unaccent(lower(${consulta}::text)), '[^[:alnum:]]+') w
                    where length(w) >= 3) as palavras
    ),
    achados as (
      select i.id, i.nome, i.descricao, c.nome as categoria, i.tags, i.preco_centavos, i.disponivel,
             c.ordem as ordem_categoria, i.ordem,
             case when q.termo is null then 0::float8 else (
               ts_rank(i.search, q.tsq)
               + greatest(extensions.word_similarity(q.termo, app.f_unaccent(lower(i.nome))),
                          extensions.word_similarity(q.termo, app.f_unaccent(lower(app.f_juntar(i.outros_nomes)))))
             )::float8 end as rank,
             not (q.termo is null
                  or i.search @@ q.tsq
                  or (cardinality(q.palavras) > 0 and not exists (
                        select 1 from unnest(q.palavras) w
                         where not (w operator(extensions.<%)
                                    app.f_unaccent(lower(i.nome || ' ' || app.f_juntar(i.outros_nomes))))))) as parecido
        from public.menu_items i
        join public.menu_categories c on c.id = i.category_id and c.ativo
        cross join q
       where i.restaurant_id = ${p.restaurantId}
         and (${p.tag}::text is null or ${p.tag}::text = any (i.tags))
         and (q.termo is null
              or i.search @@ q.tsq
              or q.termo operator(extensions.<%) app.f_unaccent(lower(i.nome))
              or q.termo operator(extensions.<%) app.f_unaccent(lower(app.f_juntar(i.outros_nomes))))
         and exists (
           select 1 from public.units u
             left join public.menu_item_units x on x.item_id = i.id and x.unit_id = u.id
            where u.restaurant_id = i.restaurant_id and u.ativo and coalesce(x.disponivel, i.disponivel))
       order by parecido, rank desc, c.ordem, i.ordem, i.nome, i.id
       limit ${limite}
    )
    select a.id, a.nome, a.descricao, a.categoria, a.tags, a.preco_centavos as preco_base_centavos, a.rank, a.parecido,
           coalesce((
             select json_agg(json_build_object(
                      'unitId', u.id,
                      'disponivel', coalesce(x.disponivel, a.disponivel),
                      'precoCentavos', coalesce(x.preco_override_centavos, a.preco_centavos))
                    order by u.ordem, u.nome, u.id)
               from public.units u
               left join public.menu_item_units x on x.item_id = a.id and x.unit_id = u.id
              where u.restaurant_id = ${p.restaurantId} and u.ativo
           ), '[]'::json) as por_unidade
      from achados a
     order by a.parecido, a.rank desc, a.ordem_categoria, a.ordem, a.nome, a.id`)
  })
  return rows.map((r) => ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao,
    categoria: r.categoria,
    tags: r.tags,
    precoBaseCentavos: r.preco_base_centavos,
    porUnidade: r.por_unidade,
    rank: Number(r.rank),
    parecido: r.parecido,
  }))
}

export type ArquivoCardapio = {
  id: string
  unitId: string | null
  titulo: string
  /** `<bucket>/<restaurant_id>/<arquivo>` */
  storagePath: string
  mime: string
  /** bytes */
  tamanho: number
  /** do conteúdo enviado pelo painel: o worker confere antes de subir para a Meta */
  sha256: string
  waMediaId: string | null
  waMediaExpiresAt: Date | null
}

const colunasArquivo = {
  id: menuFiles.id, unitId: menuFiles.unitId, titulo: menuFiles.titulo, storagePath: menuFiles.storagePath, mime: menuFiles.mime,
  tamanho: menuFiles.tamanho, sha256: menuFiles.sha256, waMediaId: menuFiles.waMediaId, waMediaExpiresAt: menuFiles.waMediaExpiresAt,
}

/** Arquivo ativo para enviar ao cliente: o da unidade, senão o geral; o mais recente de cada escopo. */
export async function arquivoParaEnvio(
  db: Db | Tx,
  p: { restaurantId: string; unitId: string | null },
): Promise<ArquivoCardapio | null> {
  const escopo = p.unitId === null ? isNull(menuFiles.unitId) : or(eq(menuFiles.unitId, p.unitId), isNull(menuFiles.unitId))
  const [r] = await db
    .select(colunasArquivo)
    .from(menuFiles)
    .where(and(eq(menuFiles.restaurantId, p.restaurantId), eq(menuFiles.ativo, true), escopo))
    // unidade antes do geral (nulls last), depois o mais recente
    .orderBy(sql`${menuFiles.unitId} nulls last`, desc(menuFiles.createdAt), desc(menuFiles.id))
    .limit(1)
  return r ?? null
}

/** Arquivo ainda ativo do restaurante, pelo id (entrega da mensagem de mídia gravada antes). */
export async function arquivoAtivoPorId(
  db: Db | Tx,
  p: { restaurantId: string; arquivoId: string },
): Promise<ArquivoCardapio | null> {
  const [r] = await db
    .select(colunasArquivo)
    .from(menuFiles)
    .where(and(eq(menuFiles.id, p.arquivoId), eq(menuFiles.restaurantId, p.restaurantId), eq(menuFiles.ativo, true)))
  return r ?? null
}

/** Esquece o media id da Meta (a Meta recusou o id guardado: o próximo envio sobe o arquivo de novo). */
export async function limparMidiaMeta(db: Db | Tx, arquivoId: string): Promise<void> {
  await db.update(menuFiles).set({ waMediaId: null, waMediaExpiresAt: null }).where(eq(menuFiles.id, arquivoId))
}

/** Guarda o media id da Meta (válido por 30 dias; quem chama passa a validade com folga). */
export async function guardarMidiaMeta(db: Db | Tx, p: { arquivoId: string; waMediaId: string; expiraEm: Date }): Promise<void> {
  await db
    .update(menuFiles)
    .set({ waMediaId: p.waMediaId, waMediaExpiresAt: p.expiraEm })
    .where(eq(menuFiles.id, p.arquivoId))
}

export type ResumoCardapioDb = { categoria: string; itens: { nome: string; precoCentavos: number | null; precoVaria?: boolean }[] }[]

type LinhaResumo = { categoria: string; nome: string; preco_centavos: number | null; preco_varia: boolean }

/**
 * Resumo para quando não há arquivo: categorias ativas em ordem, até 3 itens disponíveis cada.
 * - unidade: disponibilidade e preço efetivos dela (exceção sobre o padrão — entra item indisponível no padrão mas
 *   disponível ali);
 * - `'todas'` (várias unidades e nenhuma citada): só itens disponíveis em alguma unidade ativa; preço efetivo único
 *   entre elas, ou `precoVaria` (sem preço) quando difere; sem unidade ativa, cai no padrão;
 * - null: o padrão.
 */
export async function resumoCardapio(db: Db | Tx, restaurantId: string, unitId: string | null | 'todas'): Promise<ResumoCardapioDb> {
  const rows = unitId === 'todas'
    ? await db.execute<LinhaResumo>(sql`
    with ef as (
      select i.id as item_id,
             count(distinct coalesce(x.preco_override_centavos, i.preco_centavos)) as n_precos,
             bool_or(coalesce(x.preco_override_centavos, i.preco_centavos) is null) as tem_nulo,
             min(coalesce(x.preco_override_centavos, i.preco_centavos)) as preco
        from public.menu_items i
        join public.units u on u.restaurant_id = i.restaurant_id and u.ativo
        left join public.menu_item_units x on x.item_id = i.id and x.unit_id = u.id
       where i.restaurant_id = ${restaurantId} and coalesce(x.disponivel, i.disponivel)
       group by i.id
    )
    select categoria, nome, preco_centavos, preco_varia from (
      select c.nome as categoria, c.ordem as ordem_categoria, c.id as category_id, i.nome, i.ordem,
             (ef.n_precos + ef.tem_nulo::int) > 1 as preco_varia,
             case when (ef.n_precos + ef.tem_nulo::int) > 1 or ef.tem_nulo then null else ef.preco end as preco_centavos,
             row_number() over (partition by c.id order by i.ordem, i.nome, i.id) as n
        from public.menu_categories c
        join public.menu_items i on i.category_id = c.id
        join ef on ef.item_id = i.id
       where c.restaurant_id = ${restaurantId} and c.ativo
    ) t
     where n <= 3
     order by ordem_categoria, categoria, category_id, ordem, nome`)
    : await db.execute<LinhaResumo>(sql`
    select categoria, nome, preco_centavos, false as preco_varia from (
      select c.nome as categoria, c.ordem as ordem_categoria, c.id as category_id, i.nome, i.ordem,
             coalesce(x.preco_override_centavos, i.preco_centavos) as preco_centavos,
             row_number() over (partition by c.id order by i.ordem, i.nome, i.id) as n
        from public.menu_categories c
        join public.menu_items i on i.category_id = c.id
        left join public.menu_item_units x on x.item_id = i.id and x.unit_id = ${unitId}::uuid
       where c.restaurant_id = ${restaurantId} and c.ativo and coalesce(x.disponivel, i.disponivel)
    ) t
     where n <= 3
     order by ordem_categoria, categoria, category_id, ordem, nome`)
  if (unitId === 'todas' && rows.length === 0) {
    const [ativa] = await db.execute<{ id: string }>(sql`select id from public.units where restaurant_id = ${restaurantId} and ativo limit 1`)
    if (!ativa) return resumoCardapio(db, restaurantId, null)
  }
  const out: ResumoCardapioDb = []
  for (const r of rows) {
    let cat = out.at(-1)
    if (!cat || cat.categoria !== r.categoria) {
      cat = { categoria: r.categoria, itens: [] }
      out.push(cat)
    }
    cat.itens.push({ nome: r.nome, precoCentavos: r.preco_centavos, ...(r.preco_varia ? { precoVaria: true } : {}) })
  }
  return out
}
