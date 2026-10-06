import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { restaurants, staff, staffInvites, units } from './schema/restaurant.ts'
import type { StaffRole } from './staff.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAPEIS_CONVITE = ['gerente', 'atendente'] as const

export type PapelConvite = (typeof PAPEIS_CONVITE)[number]
export type StatusConvite = 'pendente' | 'enviado' | 'erro' | 'aceito'
/** Membro (staff) ou convite ainda não processado/com erro. `unidades` vazio = todas as unidades. */
export type IntegranteEquipe =
  | {
      tipo: 'membro'
      id: string
      nome: string
      email: string | null
      papel: StaffRole
      unidades: string[]
      ativo: boolean
      /** convidado que ainda não entrou (nunca fez login) */
      convitePendente: boolean
      /** convite `enviado` de quem nunca entrou (para "Reenviar"); null para os demais */
      conviteId: string | null
    }
  | {
      tipo: 'convite'
      id: string
      nome: string
      email: string
      papel: StaffRole
      unidades: string[]
      ativo: false
      status: StatusConvite
      erro: string | null
      criadoEm: Date
    }
export type ErroEquipe = ErroPainel | 'valor_invalido' | 'ja_existe' | 'a_si_mesmo'
export type ResultadoEquipe<T = null> = ResultadoPainel<T> | { ok: false; erro: ErroEquipe }

/** Equipe do restaurante para dono/gerente (com e-mail); atendente recebe lista vazia. */
export function listarEquipe(db: Db, claims: JwtClaims): Promise<IntegranteEquipe[]> {
  return withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono', 'gerente']))) return []
    const membros = await tx
      .select({ id: staff.userId, nome: staff.nome, papel: staff.papel, unidades: staff.unidadesPermitidas, ativo: staff.ativo })
      .from(staff)
      .where(sql`${staff.restaurantId} = (select app.my_restaurant_id())`)
      .orderBy(asc(staff.nome), asc(staff.userId))
    const emails = await tx.execute<{ user_id: string; email: string | null; entrou: boolean }>(
      sql`select user_id, email, entrou from app.emails_da_equipe()`)
    const porId = new Map(emails.map((e) => [e.user_id, e]))
    const convites = await tx
      .select({
        id: staffInvites.id, nome: staffInvites.nome, email: staffInvites.email, papel: staffInvites.papel, unidades: staffInvites.unidades,
        status: staffInvites.status, erro: staffInvites.erro, criadoEm: staffInvites.createdAt,
      })
      .from(staffInvites)
      .where(and(sql`${staffInvites.restaurantId} = (select app.my_restaurant_id())`, inArray(staffInvites.status, ['pendente', 'erro'])))
      .orderBy(desc(staffInvites.createdAt))
    const enviados = await tx
      .select({ id: staffInvites.id, userId: staffInvites.userId })
      .from(staffInvites)
      .where(and(sql`${staffInvites.restaurantId} = (select app.my_restaurant_id())`, eq(staffInvites.status, 'enviado')))
      .orderBy(desc(staffInvites.createdAt))
    const convitePorUsuario = new Map<string, string>()
    for (const e of enviados) if (e.userId && !convitePorUsuario.has(e.userId)) convitePorUsuario.set(e.userId, e.id)
    return [
      ...membros.map((m) => {
        const pendente = porId.get(m.id)?.entrou === false
        return {
          tipo: 'membro' as const, ...m, email: porId.get(m.id)?.email ?? null, convitePendente: pendente,
          conviteId: pendente ? convitePorUsuario.get(m.id) ?? null : null,
        }
      }),
      ...convites.map((c) => ({ tipo: 'convite' as const, ...c, ativo: false as const })),
    ]
  })
}

/**
 * Só o dono convida gerente ou atendente. E-mail normalizado (minúsculas); convite em aberto ou e-mail de quem já é da
 * equipe ⇒ `ja_existe`; unidade de outro restaurante ⇒ `nao_encontrada`. A Server Action enfileira `equipe.convite`
 * depois do commit. Auditoria sem e-mail nem nome.
 */
export function criarConvite(
  db: Db,
  claims: JwtClaims,
  v: { email: string; nome: string; papel: PapelConvite; unidades: string[] | 'todas' },
): Promise<ResultadoEquipe<{ conviteId: string }>> {
  const email = v.email.trim().toLowerCase()
  const nome = v.nome.trim()
  if (!EMAIL.test(email) || email.length > 254 || nome.length === 0 || [...nome].length > 80
    || !(PAPEIS_CONVITE as readonly string[]).includes(v.papel) || (v.unidades !== 'todas' && v.unidades.length === 0)) {
    return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  }
  const unidades = v.unidades === 'todas' ? [] : [...new Set(v.unidades)]
  if (unidades.some((u) => !UUID.test(u))) return Promise.resolve({ ok: false, erro: 'nao_encontrada' })
  return semPermissaoVira<ResultadoEquipe<{ conviteId: string }>, ErroEquipe>(() => withUserContext(db, claims, async (tx): Promise<ResultadoEquipe<{ conviteId: string }>> => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    if (unidades.length > 0) {
      const achadas = await tx.select({ id: units.id }).from(units).where(inArray(units.id, unidades)) // RLS: só do restaurante
      if (achadas.length !== unidades.length) return falha('nao_encontrada')
    }
    const [jaMembro] = await tx.execute(sql`select 1 from app.emails_da_equipe() where lower(email) = ${email}`)
    if (jaMembro) return { ok: false, erro: 'ja_existe' }
    // authenticated só tem INSERT nestas colunas (0035)
    const [c] = await tx.execute<{ id: string; restaurant_id: string }>(sql`
      insert into public.staff_invites (restaurant_id, email, nome, papel, unidades, created_by)
      values ((select app.my_restaurant_id()), ${email}, ${nome}, ${v.papel}::public.staff_role,
              ${`{${unidades.join(',')}}`}::uuid[], ${claims.sub}::uuid)
      returning id, restaurant_id`)
    await registrarAuditoria(tx, claims, {
      restaurantId: c!.restaurant_id, acao: 'equipe.convite_criado', entidade: 'staff_invite', entidadeId: c!.id,
      diff: { papel: v.papel, unidades },
    })
    return ok({ conviteId: c!.id })
  }), { staff_invites_email_uq: 'ja_existe' })
}

/** Só o dono: devolve a `pendente` um convite não aceito (de erro ou enviado). A Server Action enfileira de novo. */
export function reenviarConvite(db: Db, claims: JwtClaims, conviteId: string): Promise<ResultadoEquipe> {
  if (!UUID.test(conviteId)) return Promise.resolve(falha('nao_encontrada'))
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoEquipe> => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [c] = await tx
      .update(staffInvites)
      .set({ status: 'pendente', erro: null })
      .where(and(eq(staffInvites.id, conviteId), inArray(staffInvites.status, ['pendente', 'enviado', 'erro'])))
      .returning({ restaurantId: staffInvites.restaurantId })
    if (!c) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, {
      restaurantId: c.restaurantId, acao: 'equipe.convite_reenviado', entidade: 'staff_invite', entidadeId: conviteId,
    })
    return ok(null)
  }))
}

/** Só o dono desativa/reativa um membro (desativado não entra: `staff.ativo` nas funções da RLS). Nunca a si mesmo. */
export function definirAtivo(db: Db, claims: JwtClaims, staffId: string, ativo: boolean): Promise<ResultadoEquipe> {
  if (!UUID.test(staffId)) return Promise.resolve(falha('nao_encontrada'))
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoEquipe> => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    if (staffId === claims.sub) return { ok: false, erro: 'a_si_mesmo' }
    const [atual] = await tx
      .select({ restaurantId: staff.restaurantId, ativo: staff.ativo })
      .from(staff)
      .where(eq(staff.userId, staffId))
      .for('update')
    if (!atual) return falha('nao_encontrada')
    if (atual.ativo === ativo) return ok(null)
    await tx.update(staff).set({ ativo, updatedAt: sql`now()` }).where(eq(staff.userId, staffId))
    await registrarAuditoria(tx, claims, {
      restaurantId: atual.restaurantId, acao: 'equipe.ativo_alterado', entidade: 'staff', entidadeId: staffId,
      diff: { de: atual.ativo, para: ativo },
    })
    return ok(null)
  }))
}

// ============ Worker (worker_app) ============

/** Dados do convite `pendente` para o worker chamar o Supabase Auth; qualquer outro status ⇒ null. Nunca logar o e-mail. */
export async function conviteParaProcessar(
  db: Db | Tx,
  id: string,
): Promise<{ email: string; nome: string; papel: string; unidades: string[]; restaurantId: string } | null> {
  if (!UUID.test(id)) return null
  const [c] = await db
    .select({
      email: staffInvites.email, nome: staffInvites.nome, papel: staffInvites.papel, unidades: staffInvites.unidades,
      restaurantId: staffInvites.restaurantId,
    })
    .from(staffInvites)
    .where(and(eq(staffInvites.id, id), eq(staffInvites.status, 'pendente')))
  return c ?? null
}

/**
 * Resultado do convite no Supabase Auth. Sucesso: cria (ou atualiza, no mesmo restaurante) o `staff` com papel e unidades
 * do convite e marca `enviado`; usuário que já é de outro restaurante não é movido (`erro: outro_restaurante`) e o dono
 * nunca é rebaixado (`erro: ja_membro`). Falha: grava o código do erro — só `[a-z_]` (mensagem do Auth pode trazer o
 * e-mail); fora disso, `erro_desconhecido`. Só age sobre convite `pendente`.
 */
export async function concluirConvite(
  db: Db | Tx,
  id: string,
  r: { ok: true; userId: string } | { ok: false; erro: string },
): Promise<void> {
  if (!UUID.test(id)) return
  await (db as Db).transaction(async (tx) => {
    const [c] = await tx
      .select({ restaurantId: staffInvites.restaurantId, nome: staffInvites.nome, papel: staffInvites.papel, unidades: staffInvites.unidades })
      .from(staffInvites)
      .where(and(eq(staffInvites.id, id), eq(staffInvites.status, 'pendente')))
      .for('update')
    if (!c) return
    if (!r.ok) {
      const codigo = /^[a-z_]{1,60}$/.test(r.erro) ? r.erro : 'erro_desconhecido'
      await tx.update(staffInvites).set({ status: 'erro', erro: codigo }).where(eq(staffInvites.id, id))
      return
    }
    // SQL explícito: worker_app só tem INSERT/UPDATE nestas colunas (0035); o restaurante de quem já existe não muda
    const criado = await tx.execute<{ user_id: string }>(sql`
      insert into public.staff (user_id, restaurant_id, nome, papel, unidades_permitidas)
      values (${r.userId}::uuid, ${c.restaurantId}::uuid, ${c.nome}, ${c.papel}::public.staff_role, ${`{${c.unidades.join(',')}}`}::uuid[])
      on conflict (user_id) do update
        set nome = excluded.nome, papel = excluded.papel, unidades_permitidas = excluded.unidades_permitidas, updated_at = now()
        where public.staff.restaurant_id = excluded.restaurant_id and public.staff.papel <> 'dono'
      returning user_id`)
    if (criado.length === 0) {
      const [existente] = await tx.select({ restaurantId: staff.restaurantId }).from(staff).where(eq(staff.userId, r.userId))
      const erro = existente?.restaurantId === c.restaurantId ? 'ja_membro' : 'outro_restaurante'
      await tx.update(staffInvites).set({ status: 'erro', erro }).where(eq(staffInvites.id, id))
      return
    }
    await tx.update(staffInvites).set({ status: 'enviado', erro: null, userId: r.userId }).where(eq(staffInvites.id, id))
  })
}

/** Restaurantes para a retenção diária iterar. */
export async function restaurantesAtivos(db: Db | Tx): Promise<string[]> {
  const rows = await db.select({ id: restaurants.id }).from(restaurants).orderBy(asc(restaurants.id))
  return rows.map((r) => r.id)
}
