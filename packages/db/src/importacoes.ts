import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { normalizeText } from '@atd/core'
import { rascunhoSchema, type RascunhoCardapio } from '@atd/core/s4'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { gravarArquivo, podeEditarCardapioGeral } from './painel-cardapio.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { units } from './schema/restaurant.ts'
import { knowledgeDocuments, menuCategories, menuItems, type STATUS_IMPORTACAO } from './schema/s4.ts'
import { mensagemVazio, rascunhoVazio, validarRascunho, type AlvoImportacao, type ModoImportacao } from './importacoes-rascunho.ts'

const GESTAO = ['dono', 'gerente'] as const

export type StatusImportacao = (typeof STATUS_IMPORTACAO)[number]
export type OrigemImportacao = 'csv' | 'arquivo'
export type ImportacaoPainel = {
  id: string
  alvo: AlvoImportacao
  modo: ModoImportacao
  origem: OrigemImportacao
  status: StatusImportacao
  /** `importacoes/<restaurant_id>/<arquivo>`; null no CSV */
  storagePath: string | null
  /** vários arquivos: o tipo do primeiro ('' antes do primeiro arquivo) */
  mime: string
  /** vários arquivos: a soma dos tamanhos */
  tamanho: number
  /** quantos arquivos (CSV = 0) */
  arquivos: number
  /** próximo lote a ler (0 = nenhum) e total de lotes (null até o worker planejar): "Lendo n de m" */
  loteAtual: number
  lotesTotal: number | null
  /** só o rascunho do cardápio completo; os demais alvos vêm por `revisaoImportacao` */
  draft: RascunhoCardapio | null
  /** mensagem amigável (status `erro`) */
  erro: string | null
  criadoEm: Date
  revisadoEm: Date | null
}

/** Mensagem do painel quando a leitura devolve algo fora do formato do rascunho. */
export const ERRO_RASCUNHO_INVALIDO = 'Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV.'
/** Leitura válida, mas sem nenhum item (documento que não é cardápio): nunca vira rascunho vazio. */
export const ERRO_SEM_ITENS = 'Não encontrei itens de cardápio nesse arquivo.'

const colunas = {
  id: knowledgeDocuments.id, alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo, origem: knowledgeDocuments.origem,
  status: knowledgeDocuments.status, storagePath: knowledgeDocuments.storagePath,
  mime: sql<string>`coalesce(${knowledgeDocuments.mime}, (select f.mime from public.knowledge_document_files f where f.importacao_id = "knowledge_documents"."id" order by f.ordem limit 1), '')`,
  tamanho: sql<number>`coalesce(${knowledgeDocuments.tamanho}, (select sum(f.tamanho) from public.knowledge_document_files f where f.importacao_id = "knowledge_documents"."id")::int, 0)`,
  arquivos: sql<number>`(case when ${knowledgeDocuments.storagePath} is not null then 1 else (select count(*) from public.knowledge_document_files f where f.importacao_id = "knowledge_documents"."id") end)::int`,
  loteAtual: knowledgeDocuments.loteAtual, lotesTotal: knowledgeDocuments.lotesTotal,
  draft: knowledgeDocuments.draft, erro: knowledgeDocuments.erro, criadoEm: knowledgeDocuments.createdAt,
  revisadoEm: knowledgeDocuments.revisadoAt,
}
type Linha = Omit<ImportacaoPainel, 'draft'> & { draft: unknown }
const paraPainel = (r: Linha): ImportacaoPainel => {
  const d = r.draft == null || r.alvo !== 'cardapio' || r.modo !== 'completo' ? null : rascunhoSchema.safeParse(r.draft)
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
    // SQL explícito: authenticated só tem INSERT nas colunas permitidas (0027); a policy confere status e autor.
    // Arquivo já enviado e não rejeitado/com erro (índice parcial da 0028) ⇒ devolve a importação existente,
    // também no envio simultâneo (on conflict do nothing + releitura).
    const [d] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
      insert into public.knowledge_documents (restaurant_id, origem, status, storage_path, mime, tamanho, sha256, draft, enviado_por)
      values ((select app.my_restaurant_id()), ${v.origem}, ${status}, ${v.storagePath}, ${v.mime}, ${v.tamanho}, ${v.sha256},
              ${draft === null ? null : JSON.stringify(draft)}::jsonb, ${claims.sub})
      on conflict (restaurant_id, alvo, modo, sha256) where origem = 'arquivo' and status not in ('rejeitado', 'erro') do nothing
      returning id, restaurant_id`)
    if (!d) {
      const [existente] = await tx
        .select({ id: knowledgeDocuments.id })
        .from(knowledgeDocuments)
        .where(and(
          eq(knowledgeDocuments.sha256, v.sha256),
          eq(knowledgeDocuments.origem, 'arquivo'),
          eq(knowledgeDocuments.alvo, 'cardapio'),
          eq(knowledgeDocuments.modo, 'completo'),
          notInArray(knowledgeDocuments.status, ['rejeitado', 'erro']),
        ))
      // conflito com importação que este usuário não enxerga não acontece (mesmo restaurante, dono/gerente)
      if (!existente) throw new Error('importação duplicada não encontrada')
      return ok({ id: existente.id })
    }
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

/** As 20 importações mais recentes (opcionalmente só de um alvo). */
export function listarImportacoes(db: Db, claims: JwtClaims, filtro: { alvo?: AlvoImportacao } = {}): Promise<ImportacaoPainel[]> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select(colunas)
      .from(knowledgeDocuments)
      .where(filtro.alvo === undefined ? undefined : eq(knowledgeDocuments.alvo, filtro.alvo))
      .orderBy(desc(knowledgeDocuments.createdAt), desc(knowledgeDocuments.id))
      .limit(20)
    return rows.map(paraPainel)
  })
}

export type OpcoesAplicar = { usarComoArquivoDeEnvio: boolean; unitIdArquivo: string | null }
/** Item do rascunho que não foi aplicado (ex.: unidade que não existe — nunca vira preço padrão). */
export type ItemIgnorado = { categoria: string; nome: string; motivo: 'unidade_desconhecida' }
export type ResultadoAplicar =
  | ResultadoPainel<{ criados: number; atualizados: number; ignorados: ItemIgnorado[] }>
  | { ok: false; erro: 'ja_aplicado' | 'arquivo_invalido' }

/** Tipos aceitos como arquivo de cardápio para envio (iguais ao check de menu_files). */
export const MIMES_ARQUIVO_CARDAPIO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
/**
 * Onde o arquivo importado fica quando vira arquivo de envio: copiado do bucket `importacoes` (só dono/gerente leem)
 * para `cardapio` (a equipe toda vê a prévia). A Server Action copia o objeto antes de aplicar.
 */
export const caminhoArquivoDeEnvio = (storagePath: string) => storagePath.replace(/^importacoes\//, 'cardapio/')
const dataBr = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)

/**
 * Confirmação humana do rascunho (PRD I10), numa transação: trava a importação, exige `rascunho`, cria categorias e
 * itens novos e atualiza os existentes (mesmo nome normalizado na mesma categoria). No existente, só sobrescreve o
 * que o rascunho traz: descrição vazia, tags e outros nomes vazios e preço null mantêm o valor atual (limpar um campo
 * é pela edição do item). Itens novos entram depois do último item da categoria. Item com `unidade` reconhecida ⇒
 * preço próprio naquela unidade (o preço padrão só nasce com o item; preço null não mexe na exceção).
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
        alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for('update')
    if (!doc) return (await existe(tx, id)) ? { ok: false, erro: 'ja_aplicado' } : falha('nao_encontrada')
    // outros alvos/modos (Etapa 07) se aplicam por `aplicarImportacao`
    if (doc.alvo !== 'cardapio' || doc.modo !== 'completo') return falha('nao_encontrada')
    if (doc.status !== 'rascunho') return { ok: false, erro: 'ja_aplicado' }
    // arquivo de envio só de PDF/imagem enviado (CSV e vários arquivos não têm um): recusa antes de mexer no cardápio
    const arquivo = doc.storagePath !== null && doc.mime !== null && doc.tamanho !== null && doc.sha256 !== null
      && (MIMES_ARQUIVO_CARDAPIO as readonly string[]).includes(doc.mime)
      ? { storagePath: doc.storagePath, mime: doc.mime, tamanho: doc.tamanho, sha256: doc.sha256 }
      : null
    if (opcoes.usarComoArquivoDeEnvio && arquivo === null) return { ok: false, erro: 'arquivo_invalido' }

    const contagem = await aplicarNoCardapio(tx, doc.restaurantId, r)

    if (opcoes.usarComoArquivoDeEnvio && arquivo !== null) {
      // o nome original não é guardado (o caminho no Storage é gerado): título com a data da importação
      await gravarArquivo(tx, {
        unitId: opcoes.unitIdArquivo, titulo: `Cardápio importado em ${dataBr(new Date())}`, storagePath: caminhoArquivoDeEnvio(arquivo.storagePath),
        mime: arquivo.mime, tamanho: arquivo.tamanho, sha256: arquivo.sha256,
      })
    }

    await tx
      .update(knowledgeDocuments)
      .set({ status: 'aprovado', draft: r, revisadoPor: claims.sub, revisadoAt: sql`now()` })
      .where(eq(knowledgeDocuments.id, id))
    await registrarAuditoria(tx, claims, {
      restaurantId: doc.restaurantId, acao: 'cardapio.importacao_aplicada', entidade: 'knowledge_document', entidadeId: id,
      diff: {
        criados: contagem.criados, atualizados: contagem.atualizados, ignorados: contagem.ignorados.length,
        categoriasCriadas: contagem.categoriasCriadas, precosPorUnidade: contagem.precosPorUnidade,
        arquivoDeEnvio: opcoes.usarComoArquivoDeEnvio,
      },
    })
    return ok({ criados: contagem.criados, atualizados: contagem.atualizados, ignorados: contagem.ignorados })
  }), { menu_files_storage_path_ck: 'sem_permissao' })
}

async function existe(tx: Tx, id: string): Promise<boolean> {
  const [r] = await tx.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  return r !== undefined
}

/** Aplica o rascunho do cardápio completo (também usado por `aplicarImportacao`). Só dentro da transação travada. */
export async function aplicarNoCardapio(
  tx: Tx,
  restaurantId: string,
  r: RascunhoCardapio,
): Promise<{ criados: number; atualizados: number; ignorados: ItemIgnorado[]; categoriasCriadas: number; precosPorUnidade: number }> {
  const cats = await tx
    .select({ id: menuCategories.id, nome: menuCategories.nome, ordem: menuCategories.ordem })
    .from(menuCategories)
  const categoriaPorNome = new Map(cats.map((c) => [normalizeText(c.nome), c.id]))
  let proximaOrdem = cats.reduce((m, c) => Math.max(m, c.ordem), 0) + 1
  const its = await tx.select({ id: menuItems.id, categoryId: menuItems.categoryId, nome: menuItems.nome, ordem: menuItems.ordem }).from(menuItems)
  const itemPorChave = new Map(its.map((i) => [`${i.categoryId}|${normalizeText(i.nome)}`, i.id]))
  // próxima ordem por categoria: itens novos vão para o fim (não se intercalam com os já cadastrados)
  const ordemPorCategoria = new Map<string, number>()
  for (const i of its) ordemPorCategoria.set(i.categoryId, Math.max(ordemPorCategoria.get(i.categoryId) ?? 0, i.ordem))
  const us = await tx.select({ id: units.id, nome: units.nome, slug: units.slug, apelidos: units.apelidos }).from(units)
  const unidadePorNome = new Map<string, string>()
  for (const u of us) for (const n of [u.nome, u.slug, ...u.apelidos]) unidadePorNome.set(normalizeText(n), u.id)

  const criados = new Set<string>()
  const atualizados = new Set<string>()
  const ignorados: ItemIgnorado[] = []
  let categoriasCriadas = 0
  let precosPorUnidade = 0

  for (const c of r.categorias) {
    // unidade informada e não reconhecida: o item fica de fora (nunca vira preço padrão de todas as unidades)
    const itens: { i: (typeof c.itens)[number]; unitId: string | null }[] = []
    for (const i of c.itens) {
      if (!i.incluir) continue
      const unitId = i.unidade === null ? null : (unidadePorNome.get(normalizeText(i.unidade)) ?? null)
      if (i.unidade !== null && unitId === null) ignorados.push({ categoria: c.nome, nome: i.nome, motivo: 'unidade_desconhecida' })
      else itens.push({ i, unitId })
    }
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
    for (const { i, unitId } of itens) {
      const chave = `${categoryId}|${normalizeText(i.nome)}`
      let itemId = itemPorChave.get(chave)
      if (!itemId) {
        const ordem = (ordemPorCategoria.get(categoryId) ?? 0) + 1
        ordemPorCategoria.set(categoryId, ordem)
        const [novo] = await tx.execute<{ id: string }>(sql`
          insert into public.menu_items (restaurant_id, category_id, nome, descricao, preco_centavos, tags, outros_nomes, disponivel, ordem)
          values (${restaurantId}, ${categoryId}, ${i.nome}, ${i.descricao}, ${unitId === null ? i.precoCentavos : null},
                  ${sql.param(i.tags)}::text[], ${sql.param(i.outrosNomes)}::text[], true, ${ordem})
          returning id`)
        // item novo só com preço de unidade: padrão "sob consulta"; o preço fica na exceção da unidade
        itemId = novo!.id
        itemPorChave.set(chave, itemId)
        criados.add(itemId)
      } else {
        // só o que o rascunho traz (CSV sem a coluna, IA que não leu): vazio mantém o valor atual
        const set = {
          ...(i.descricao ? { descricao: i.descricao } : {}),
          ...(i.tags.length ? { tags: i.tags } : {}),
          ...(i.outrosNomes.length ? { outrosNomes: i.outrosNomes } : {}),
          // preço de uma unidade não mexe no preço padrão; preço ilegível/ausente não vira "sob consulta"
          ...(unitId === null && i.precoCentavos !== null ? { precoCentavos: i.precoCentavos } : {}),
        }
        if (Object.keys(set).length > 0) await tx.update(menuItems).set(set).where(eq(menuItems.id, itemId))
        if (!criados.has(itemId)) atualizados.add(itemId)
      }
      if (unitId !== null && i.precoCentavos !== null) {
        await tx.execute(sql`
          insert into public.menu_item_units (item_id, unit_id, restaurant_id, preco_override_centavos)
          values (${itemId}, ${unitId}, ${restaurantId}, ${i.precoCentavos})
          on conflict (item_id, unit_id) do update set preco_override_centavos = excluded.preco_override_centavos`)
        precosPorUnidade++
      }
    }
  }
  return { criados: criados.size, atualizados: atualizados.size, ignorados, categoriasCriadas, precosPorUnidade }
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

/** Leitura parada há mais que isso (o job expira em 300 s) é de um worker que morreu: pode ser retomada. */
export const PRAZO_PROCESSANDO = '5 minutes'

/**
 * Passa de `enviado` a `processando` (uma vez só) — ou retoma um `processando` parado há mais de
 * `PRAZO_PROCESSANDO` (`retomada: true`: quem chama libera a reserva do processo morto e encerra). Devolve onde está
 * o arquivo, ou null se não há o que fazer.
 */
export async function marcarProcessando(
  db: Db | Tx,
  id: string,
): Promise<{ storagePath: string; mime: string; sha256: string; restaurantId: string; retomada: boolean } | null> {
  return (db as Db).transaction(async (tx) => {
    const [atual] = await tx
      .select({ status: knowledgeDocuments.status, storagePath: knowledgeDocuments.storagePath, parado: sql<boolean>`${knowledgeDocuments.updatedAt} < now() - ${PRAZO_PROCESSANDO}::interval` })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id))
      .for('update')
    const retomada = atual?.status === 'processando' && atual.parado
    // importação de vários arquivos (Etapa 07) é do `proximoLote`
    if (!atual || atual.storagePath === null || (atual.status !== 'enviado' && !retomada)) return null
    // o gatilho touch_updated_at renova updated_at (o prazo recomeça)
    const [r] = await tx
      .update(knowledgeDocuments)
      .set({ status: 'processando' })
      .where(eq(knowledgeDocuments.id, id))
      .returning({
        storagePath: knowledgeDocuments.storagePath, mime: knowledgeDocuments.mime, sha256: knowledgeDocuments.sha256,
        restaurantId: knowledgeDocuments.restaurantId,
      })
    // com caminho, mime e sha256 existem (check knowledge_documents_storage_ck)
    return r && r.storagePath !== null && r.mime !== null && r.sha256 !== null
      ? { storagePath: r.storagePath, mime: r.mime, sha256: r.sha256, restaurantId: r.restaurantId, retomada }
      : null
  })
}

/**
 * Resultado da leitura (só de `processando`), validado pelo schema do alvo/modo da importação: rascunho válido e não
 * vazio ⇒ `rascunho`; falha, rascunho fora do schema ou vazio ⇒ `erro` com mensagem amigável (até 300 caracteres;
 * nunca detalhe técnico nem conteúdo do documento). O parcial dos lotes some. Devolve o status gravado.
 */
export async function concluirIngestao(
  db: Db | Tx,
  id: string,
  r: { ok: true; draft: unknown } | { ok: false; erro: string },
): Promise<'rascunho' | 'erro'> {
  const [doc] = await db
    .select({ alvo: knowledgeDocuments.alvo, modo: knowledgeDocuments.modo })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, id))
  const alvo = doc?.alvo ?? 'cardapio'
  const modo = doc?.modo ?? 'completo'
  const d = r.ok ? validarRascunho(alvo, modo, r.draft) : null
  const vazio = d !== null && rascunhoVazio(d)
  const set = d !== null && !vazio
    ? { status: 'rascunho' as const, draft: d.draft, erro: null, draftParcial: null }
    : {
        status: 'erro' as const, draft: null, draftParcial: null,
        erro: (vazio ? mensagemVazio(alvo, modo) : r.ok ? ERRO_RASCUNHO_INVALIDO : r.erro).slice(0, 300),
      }
  await db
    .update(knowledgeDocuments)
    .set(set)
    .where(and(eq(knowledgeDocuments.id, id), eq(knowledgeDocuments.status, 'processando')))
  return set.status
}
