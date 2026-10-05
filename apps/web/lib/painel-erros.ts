import type { ErroPainel, ResultadoPainel } from '@atd/db'
import type { ActionResult } from '@/lib/action-result'

export const MENSAGEM_ERRO_PAINEL: Record<ErroPainel, string> = {
  sem_permissao: 'Você não tem permissão para fazer essa alteração.',
  nao_encontrada: 'Não encontramos esse item. Ele pode ter sido removido ou você não tem acesso a ele.',
  nome_duplicado: 'Já existe uma unidade com esse nome.',
}

/** Converte o resultado do banco em ActionResult; `campos` envia um erro para um campo do formulário. */
export function resultadoDoPainel<T>(r: ResultadoPainel<T>, campos: Partial<Record<ErroPainel, string>> = {}): ActionResult<T> {
  if (r.ok) return { ok: true, data: r.valor }
  const campo = campos[r.erro]
  return campo
    ? { ok: false, fieldErrors: { [campo]: MENSAGEM_ERRO_PAINEL[r.erro] } }
    : { ok: false, formError: MENSAGEM_ERRO_PAINEL[r.erro] }
}
