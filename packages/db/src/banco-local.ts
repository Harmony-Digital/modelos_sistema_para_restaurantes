/** Só o host decide: nunca confiar em texto solto da URL (senha, query). */
export function ehBancoLocal(url: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  try {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
