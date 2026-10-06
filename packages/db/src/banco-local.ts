/** Só o host decide: nunca confiar em texto solto da URL (senha, query). */
export function ehBancoLocal(url: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * Dados de demonstração: no banco local sempre; em banco remoto só com `--producao`
 * (o `demo:s1:prod`, que lê `.env.production-bootstrap`). Pedido explícito, nunca por acaso.
 */
export function podeRodarDemo(url: string, argv: readonly string[]): boolean {
  if (ehBancoLocal(url)) return true
  if (!argv.includes('--producao')) return false
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}
