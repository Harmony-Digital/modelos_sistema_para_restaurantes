export function percentual(respondidos: number, validos: number): string {
  if (validos <= 0) return '—'
  return `${Math.round((100 * respondidos) / validos)}%`
}
