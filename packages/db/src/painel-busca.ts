import { and, asc, desc, eq, gte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from './client.ts'
import { filtroSimulacao, lerModoDemonstracao } from './modo-demonstracao.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { conversations, customers } from './schema/conversation.ts'
import { units } from './schema/restaurant.ts'
import { knowledgeFacts } from './schema/s1.ts'
import { menuCategories, menuItems } from './schema/s4.ts'

export type TipoResultadoBusca = 'unidade' | 'item' | 'informacao' | 'conversa'
/** Um resultado da busca rápida: só nomes/títulos (nada de telefone; da pessoa, só o nome de perfil). */
export type ResultadoBusca = { tipo: TipoResultadoBusca; id: string; titulo: string; detalhe: string | null; simulada: boolean }

export const MAX_RESULTADOS_BUSCA = 20
const POR_TIPO = MAX_RESULTADOS_BUSCA / 4
const MIN_TERMO = 2
const MAX_TERMO = 60
const MAX_PALAVRAS = 5
/** Mesma janela da aba Encerradas da inbox: o que a busca devolve é o que a tela de Conversas mostra. */
const DIAS_ENCERRADAS = 30

/** `%`, `_` e `\` do termo valem como texto no ILIKE. */
const literalLike = (t: string) => `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Palavras (letras e números) do termo, cada uma como prefixo no tsquery: acha enquanto a pessoa digita. */
function consultaTexto(termo: string): SQL | null {
  const palavras = termo.match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_PALAVRAS) ?? []
  if (palavras.length === 0) return null
  // cada palavra vai parametrizada; o `:*` é concatenado no banco depois do unaccent
  const partes = palavras.map((p) => sql`to_tsquery('portuguese'::regconfig, app.f_unaccent(${p.toLowerCase()}) || ':*')`)
  return sql.join(partes, sql` && `)
}

/**
 * Busca rápida (Ctrl+K) com a RLS do usuário: unidades, itens do cardápio, informações e conversas pelo nome de perfil,
 * no máximo 5 de cada (20 no total). Gerente restrito só acha o que é das unidades dele; conversa simulada só com o modo
 * demonstração ligado. Itens e informações pelo índice GIN de `search`; conversas pelos índices da inbox.
 */
export function buscarNoPainel(db: Db, claims: JwtClaims, termoBruto: string): Promise<ResultadoBusca[]> {
  const termo = termoBruto.trim().replace(/\s+/g, ' ').slice(0, MAX_TERMO)
  if (termo.length < MIN_TERMO) return Promise.resolve([])
  const padrao = literalLike(termo)
  const tsq = consultaTexto(termo)
  return withUserContext(db, claims, async (tx) => {
    // palavra que é só stopword ("de", "com") vira tsquery vazio e o Postgres manda um NOTICE a cada tecla;
    // só nesta transação, o cliente recebe de WARNING para cima (constante, sem dado do usuário)
    await tx.execute(sql`select set_config('client_min_messages', 'warning', true)`)
    const contem = (coluna: SQL | typeof units.nome) => sql`app.f_unaccent(${coluna}) ilike app.f_unaccent(${padrao})`
    const unidades = await tx
      .select({ id: units.id, titulo: units.nome, ativo: units.ativo })
      .from(units)
      .where(contem(units.nome))
      .orderBy(asc(units.ordem), asc(units.nome))
      .limit(POR_TIPO)
    const itens = !tsq ? [] : await tx
      .select({ id: menuItems.id, titulo: menuItems.nome, detalhe: menuCategories.nome })
      .from(menuItems)
      .innerJoin(menuCategories, eq(menuCategories.id, menuItems.categoryId))
      .where(sql`${menuItems.search} @@ (${tsq})`)
      .orderBy(desc(sql`ts_rank(${menuItems.search}, ${tsq})`), asc(menuItems.nome), asc(menuItems.id))
      .limit(POR_TIPO)
    const informacoes = !tsq ? [] : await tx
      .select({ id: knowledgeFacts.id, titulo: knowledgeFacts.tema, unidade: units.nome })
      .from(knowledgeFacts)
      .leftJoin(units, eq(units.id, knowledgeFacts.unitId))
      .where(sql`${knowledgeFacts.search} @@ (${tsq})`)
      .orderBy(desc(sql`ts_rank(${knowledgeFacts.search}, ${tsq})`), asc(knowledgeFacts.tema), asc(knowledgeFacts.id))
      .limit(POR_TIPO)
    const conversas = await tx
      .select({ id: conversations.id, titulo: customers.nomePerfil, unidade: units.nome, simulada: conversations.simulada })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .leftJoin(units, eq(units.id, conversations.unidadeContextoId))
      .where(and(
        or(ne(conversations.estado, 'encerrada'), gte(conversations.lastMessageAt, sql`now() - make_interval(days => ${DIAS_ENCERRADAS})`)),
        filtroSimulacao(conversations.simulada, await lerModoDemonstracao(tx)),
        contem(sql`${customers.nomePerfil}`),
      ))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(POR_TIPO)
    return [
      ...unidades.map((u) => ({ tipo: 'unidade' as const, id: u.id, titulo: u.titulo, detalhe: u.ativo ? null : 'Inativa', simulada: false })),
      ...itens.map((i) => ({ tipo: 'item' as const, id: i.id, titulo: i.titulo, detalhe: i.detalhe, simulada: false })),
      ...informacoes.map((f) => ({ tipo: 'informacao' as const, id: f.id, titulo: f.titulo, detalhe: f.unidade ?? 'Todas as unidades', simulada: false })),
      ...conversas.map((c) => ({ tipo: 'conversa' as const, id: c.id, titulo: c.titulo ?? 'Cliente', detalhe: c.unidade, simulada: c.simulada })),
    ]
  })
}
