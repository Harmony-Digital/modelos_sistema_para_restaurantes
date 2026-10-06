/** Dinheiro do painel: sempre centavos inteiros; exibição "R$ 1.234,56". */
const MAX_DIGITOS = 9

export function formatarCentavos(centavos: number): string {
  const reais = Math.floor(centavos / 100)
  const cents = String(centavos % 100).padStart(2, '0')
  return `R$ ${String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`
}

/** Máscara de digitação: os dígitos são os centavos ("123456" vira "R$ 1.234,56"). Vazio continua vazio. */
export function maskReais(v: string): string {
  const d = v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITOS)
  return d === '' ? '' : formatarCentavos(Number(d))
}

/** "R$ 12,50" para 1250; vazio = null (sem preço). */
export function reaisParaCentavos(v: string): number | null {
  const d = v.replace(/\D/g, '')
  return d === '' ? null : Number(d)
}
