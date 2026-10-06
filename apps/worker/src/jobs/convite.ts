import { concluirConvite, conviteParaProcessar, type Db } from '@atd/db'
import type { Logger } from '../logger.ts'
import { cabecalhosDeServico } from '../storage.ts'

const TIMEOUT_MS = 15_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Resultado de uma chamada ao Auth: o id do usuário ou um código de erro do Supabase (nunca a mensagem, que traz o e-mail). */
export type ResultadoAuth = { ok: true; userId: string } | { ok: false; status: number; codigo: string | null }

export type AuthAdmin = {
  /** `POST /auth/v1/invite` (= `auth.admin.inviteUserByEmail`): cria o usuário ou reenvia ao não confirmado. */
  convidar(email: string): Promise<ResultadoAuth>
  /**
   * Id de um usuário que já tem conta (`POST /auth/v1/admin/generate_link`, tipo `magiclink`). Só gera o link: nenhum
   * e-mail sai e o link não é usado (quem já tem conta entra com a própria senha).
   */
  usuarioExistente(email: string): Promise<ResultadoAuth>
}

/**
 * Admin do Supabase Auth por REST com a chave de serviço (só no worker; nunca em log), no mesmo molde do Storage — sem
 * dependência nova. Sem `redirect_to`: o template do convite monta o link com `{{ .SiteURL }}` (o mesmo do bootstrap
 * do dono; Site URL configurada no Auth, runbook da amostra passo 1).
 */
export function createAuthAdmin(cfg: { url: string; serviceRoleKey: string; fetch?: typeof fetch }): AuthAdmin {
  const doFetch = cfg.fetch ?? fetch
  const base = `${cfg.url.replace(/\/+$/, '')}/auth/v1`
  const headers = { ...cabecalhosDeServico(cfg.serviceRoleKey), 'content-type': 'application/json' }

  async function post(caminho: string, corpo: Record<string, unknown>): Promise<ResultadoAuth> {
    let res: Response
    try {
      res = await doFetch(`${base}${caminho}`, {
        method: 'POST', headers, body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return { ok: false, status: 0, codigo: null } // rede/prazo: sem detalhes (a URL é fixa, o corpo tem o e-mail)
    }
    const dados = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (res.ok && typeof dados?.id === 'string' && UUID.test(dados.id)) return { ok: true, userId: dados.id }
    // GoTrue: `error_code` (atual) ou `code` textual (antigo); `msg` nunca sai daqui (contém o e-mail)
    const codigo = typeof dados?.error_code === 'string' ? dados.error_code : typeof dados?.code === 'string' ? dados.code : null
    return { ok: false, status: res.ok ? 502 : res.status, codigo }
  }

  return {
    convidar: (email) => post('/invite', { email }),
    usuarioExistente: (email) => post('/admin/generate_link', { type: 'magiclink', email }),
  }
}

/** Código amigável gravado em `staff_invites.erro` (sem PII; o painel traduz). */
export function codigoDoErro(r: Extract<ResultadoAuth, { ok: false }>): string {
  if (r.codigo === 'over_email_send_rate_limit' || r.status === 429) return 'limite_envio'
  if (r.codigo === 'email_address_invalid' || r.codigo === 'validation_failed') return 'email_invalido'
  if (r.status === 0 || r.status >= 500) return 'indisponivel'
  return 'falha_convite'
}

export type ConviteDeps = { db: Db; auth: AuthAdmin; log: Logger }
export type ConviteOutcome = 'enviado' | 'erro' | 'nada'

/**
 * Processa um convite `pendente` (fila `equipe.convite`): convida pelo Auth e cria/atualiza o `staff` (papel e unidades
 * do convite) marcando `enviado`, ou grava o código do erro. Quem já tem conta (`email_exists`: o Auth recusa um novo
 * convite a usuário confirmado) é vinculado sem e-mail novo — entra com a senha que já tem. Reenvio a quem ainda não
 * entrou passa pelo mesmo `/invite`, que reenvia ao usuário não confirmado. O e-mail nunca vai para log.
 */
export async function processarConvite(deps: ConviteDeps, conviteId: string): Promise<ConviteOutcome> {
  const c = await conviteParaProcessar(deps.db, conviteId)
  if (!c) return 'nada'

  let r = await deps.auth.convidar(c.email)
  const contaExistente = !r.ok && r.codigo === 'email_exists'
  if (contaExistente) r = await deps.auth.usuarioExistente(c.email)
  if (!r.ok) {
    const erro = codigoDoErro(r)
    deps.log.warn({ conviteId, erro, status: r.status, codigoAuth: r.codigo }, 'convite de equipe não enviado')
    await concluirConvite(deps.db, conviteId, { ok: false, erro })
    return 'erro'
  }

  const desfecho = await concluirConvite(deps.db, conviteId, { ok: true, userId: r.userId, contaExistente })
  if (desfecho === 'enviado') {
    deps.log.info({ conviteId, contaExistente }, 'convite de equipe enviado')
    return 'enviado'
  }
  if (desfecho === 'nada') return 'nada' // outro processamento já concluiu
  deps.log.warn({ conviteId }, 'convite de equipe não concluído')
  return 'erro'
}
