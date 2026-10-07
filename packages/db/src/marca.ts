import { eq, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ErroPainel, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { REGRAS_RESERVA_MAX, restaurants } from './schema/restaurant.ts'

export { REGRAS_RESERVA_MAX, REGRAS_RESERVA_PADRAO } from './schema/restaurant.ts'

/** Marca do restaurante: regras da reserva e logo. Dono e gerente editam (gerente só estas colunas, por gatilho no banco). */
const GESTAO = ['dono', 'gerente'] as const
export type ResultadoMarca<T = null> = ResultadoPainel<T> | { ok: false; erro: ErroPainel | 'valor_invalido' }

/** Bucket público da logo e o formato do objeto: `<restaurant_id>/logo-<sha256>.<ext>` (sem SVG). */
export const BUCKET_MARCA = 'marca'
export const caminhoLogoValido = (restaurantId: string, path: string) =>
  new RegExp(`^${restaurantId}/logo-[0-9a-f]{64}\\.(png|jpg|webp)$`).test(path)

async function travarRestaurante(tx: Tx, restaurantId: string): Promise<{ logoPath: string | null } | null> {
  // RLS: só o restaurante do usuário; o update (dono_update / gerente_update_marca) também precisa passar para travar
  const [r] = await tx
    .select({ logoPath: restaurants.logoPath })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .for('update')
  return r ?? null
}

/** Salva as regras enviadas depois de confirmar a reserva (1 a 600 caracteres, sem espaços nas pontas). */
export function salvarRegrasReserva(db: Db, claims: JwtClaims, restaurantId: string, texto: string): Promise<ResultadoMarca> {
  const regras = texto.trim()
  if (regras.length < 1 || regras.length > REGRAS_RESERVA_MAX) return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoMarca> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (!(await travarRestaurante(tx, restaurantId))) return falha('nao_encontrada')
    await tx.update(restaurants).set({ regrasReserva: regras, updatedAt: sql`now()` }).where(eq(restaurants.id, restaurantId))
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'restaurante.regras_reserva', entidade: 'restaurant', entidadeId: restaurantId, diff: { caracteres: regras.length },
    })
    return ok(null)
  }), { restaurants_regras_reserva_ck: 'valor_invalido' as const })
}

/**
 * Grava o caminho da logo já enviada ao bucket `marca` e devolve o caminho anterior: quem chama apaga o objeto antigo
 * só depois deste commit.
 */
export function salvarLogo(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  logoPath: string,
): Promise<ResultadoMarca<{ anterior: string | null }>> {
  if (!caminhoLogoValido(restaurantId, logoPath)) return Promise.resolve({ ok: false, erro: 'valor_invalido' })
  return trocarLogo(db, claims, restaurantId, logoPath)
}

/** Remove a logo (o layout volta ao de antes) e devolve o caminho anterior para apagar o objeto depois do commit. */
export function removerLogo(db: Db, claims: JwtClaims, restaurantId: string): Promise<ResultadoMarca<{ anterior: string | null }>> {
  return trocarLogo(db, claims, restaurantId, null)
}

function trocarLogo(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  logoPath: string | null,
): Promise<ResultadoMarca<{ anterior: string | null }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx): Promise<ResultadoMarca<{ anterior: string | null }>> => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const atual = await travarRestaurante(tx, restaurantId)
    if (!atual) return falha('nao_encontrada')
    if (atual.logoPath === logoPath) return ok({ anterior: null })
    await tx.update(restaurants).set({ logoPath, updatedAt: sql`now()` }).where(eq(restaurants.id, restaurantId))
    await registrarAuditoria(tx, claims, {
      restaurantId, acao: 'restaurante.logo', entidade: 'restaurant', entidadeId: restaurantId,
      diff: { acao: logoPath === null ? 'removida' : atual.logoPath === null ? 'enviada' : 'trocada' },
    })
    return ok({ anterior: atual.logoPath })
  }), { restaurants_logo_path_ck: 'valor_invalido' as const })
}
