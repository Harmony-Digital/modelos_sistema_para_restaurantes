const digits = (v: string) => v.replace(/\D/g, '')

export function maskHora(v: string): string {
  const d = digits(v).slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

export function maskData(v: string): string {
  const d = digits(v).slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

export function maskTelefone(v: string): string {
  const d = digits(v).slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  const corte = d.length === 11 ? 5 : 4
  return `(${ddd}) ${resto.slice(0, corte)}${resto.length > corte ? '-' + resto.slice(corte) : ''}`
}
