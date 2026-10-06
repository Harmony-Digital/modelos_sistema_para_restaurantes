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
}

/**
 * Busca no cardápio do restaurante (worker). Full-text em português sem acento (nome peso A; descrição, outros nomes e
 * tags peso B) **ou** semelhança de trigramas (erro de digitação) no nome e nos outros nomes. Só categorias ativas e
 * itens disponíveis no padrão ou em alguma unidade ativa. Sem consulta: lista na ordem do cardápio (útil com `tag`).
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
             app.f_unaccent(lower(${consulta}::text)) as termo
    ),
    achados as (
      select i.id, i.nome, i.descricao, c.nome as categoria, i.tags, i.preco_centavos, i.disponivel,
             c.ordem as ordem_categoria, i.ordem,
             case when q.termo is null then 0::float8 else (
               ts_rank(i.search, q.tsq)
               + greatest(extensions.word_similarity(q.termo, app.f_unaccent(lower(i.nome))),
                          extensions.word_similarity(q.termo, app.f_unaccent(lower(app.f_juntar(i.outros_nomes)))))
             )::float8 end as rank
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
       order by rank desc, c.ordem, i.ordem, i.nome, i.id
       limit ${limite}
    )
    select a.id, a.nome, a.descricao, a.categoria, a.tags, a.preco_centavos as preco_base_centavos, a.rank,
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
     order by a.rank desc, a.ordem_categoria, a.ordem, a.nome, a.id`)
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
  }))
}

export type ArquivoCardapio = {
  id: string
  unitId: string | null
  titulo: string
  /** `<bucket>/<restaurant_id>/<arquivo>` */
  storagePath: string
  mime: string
  waMediaId: string | null
  waMediaExpiresAt: Date | null
}

/** Arquivo ativo para enviar ao cliente: o da unidade, senão o geral; o mais recente de cada escopo. */
export async function arquivoParaEnvio(
  db: Db | Tx,
  p: { restaurantId: string; unitId: string | null },
): Promise<ArquivoCardapio | null> {
  const escopo = p.unitId === null ? isNull(menuFiles.unitId) : or(eq(menuFiles.unitId, p.unitId), isNull(menuFiles.unitId))
  const [r] = await db
    .select({
      id: menuFiles.id, unitId: menuFiles.unitId, titulo: menuFiles.titulo, storagePath: menuFiles.storagePath, mime: menuFiles.mime,
      waMediaId: menuFiles.waMediaId, waMediaExpiresAt: menuFiles.waMediaExpiresAt,
    })
    .from(menuFiles)
    .where(and(eq(menuFiles.restaurantId, p.restaurantId), eq(menuFiles.ativo, true), escopo))
    // unidade antes do geral (nulls last), depois o mais recente
    .orderBy(sql`${menuFiles.unitId} nulls last`, desc(menuFiles.createdAt), desc(menuFiles.id))
    .limit(1)
  return r ?? null
}

/** Guarda o media id da Meta (válido por 30 dias; quem chama passa a validade com folga). */
export async function guardarMidiaMeta(db: Db | Tx, p: { arquivoId: string; waMediaId: string; expiraEm: Date }): Promise<void> {
  await db
    .update(menuFiles)
    .set({ waMediaId: p.waMediaId, waMediaExpiresAt: p.expiraEm })
    .where(eq(menuFiles.id, p.arquivoId))
}

export type ResumoCardapioDb = { categoria: string; itens: { nome: string; precoCentavos: number | null }[] }[]

/**
 * Resumo para quando não há arquivo: categorias ativas em ordem, até 3 itens disponíveis cada. Com unidade, usa
 * disponibilidade e preço efetivos dela (exceção sobre o padrão — entra item indisponível no padrão mas disponível
 * ali); sem unidade, o padrão.
 */
export async function resumoCardapio(db: Db | Tx, restaurantId: string, unitId: string | null): Promise<ResumoCardapioDb> {
  const rows = await db.execute<{ categoria: string; nome: string; preco_centavos: number | null }>(sql`
    select categoria, nome, preco_centavos from (
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
  const out: ResumoCardapioDb = []
  for (const r of rows) {
    let cat = out.at(-1)
    if (!cat || cat.categoria !== r.categoria) {
      cat = { categoria: r.categoria, itens: [] }
      out.push(cat)
    }
    cat.itens.push({ nome: r.nome, precoCentavos: r.preco_centavos })
  }
  return out
}
