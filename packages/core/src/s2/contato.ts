import { trechosDeTelefone } from '../redact.ts'

// DDDs em uso no Brasil (Anatel)
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
])

/** Dígitos de um trecho ⇒ `+55DDNNNNNNNNN` (celular com 9 na frente ou fixo de 2 a 5); sem DDD válido ⇒ null. */
function e164(trecho: string): string | null {
  let d = trecho.replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  if (!DDDS.has(Number(d.slice(0, 2)))) return null
  const numero = d.slice(2)
  const ok = numero.length === 9 ? numero.startsWith('9') : /^[2-5]/.test(numero)
  return ok ? `+55${d}` : null
}

/**
 * Telefone de contato da reserva no texto **bruto** do cliente (o worker chama antes da redação; o número nunca vai ao
 * LLM). Usa a mesma regra de telefone da redação de PII e normaliza para E.164 do Brasil. Nenhum número válido, ou
 * dois números diferentes ⇒ null (não escolhe).
 */
export function capturarTelefone(textoBruto: string): string | null {
  // "061 99999-8888", "(061) …": o 0 de longa distância antes do DDD sai antes da regra da redação
  const semZero = textoBruto.replace(/(?<![\d+])(\(?)0(?=\d{2}\)?[\s-]?\d{4,5})/g, '$1')
  const validos = new Set(trechosDeTelefone(semZero).map(e164).filter((n): n is string => n !== null))
  return validos.size === 1 ? [...validos][0]! : null
}
