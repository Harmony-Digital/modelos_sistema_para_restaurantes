// Lacunas aceitas (não mascaradas): CNPJ (empresa, não pessoa física) e números 0800.
const EMAIL = /[\p{L}\p{N}._+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
const CARD = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g
const CPF_FORMATTED = /(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g
const CPF_SPACED = /(?<!\d)\d{3} \d{3} \d{3} \d{2}(?!\d)/g
const ELEVEN_DIGITS = /(?<!\d)\d{11}(?!\d)/g
const RG = /(?<![\d.])\d{2}\.\d{3}\.\d{3}-[\dXx](?![\w])/g
// separadores: espaço, hífen ou ponto ("61.99999.8888"); não começa nem termina no meio de um número maior com pontos
const PHONE =
  /(?<!\d|\d\.)(?:(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}|9\d{4}[\s.-]?\d{4})(?!\d|\.\d)/g

function luhnOk(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10])
}

/** Trechos que a redação mascara como `[TELEFONE]` (mesma regra; a captura do contato da reserva valida em cima). */
export function trechosDeTelefone(text: string): string[] {
  return text.match(PHONE) ?? []
}

/** Mascara PII antes de qualquer envio ao LLM (invariante I8). */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL, '[EMAIL]')
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, '')
      return digits.length >= 13 && luhnOk(digits) ? '[CARTAO]' : m
    })
    .replace(CPF_FORMATTED, '[CPF]')
    .replace(CPF_SPACED, (m) => (isValidCpf(m.replace(/\D/g, '')) ? '[CPF]' : m))
    .replace(ELEVEN_DIGITS, (m) => (isValidCpf(m) ? '[CPF]' : m))
    .replace(RG, '[RG]')
    .replace(PHONE, '[TELEFONE]')
}
