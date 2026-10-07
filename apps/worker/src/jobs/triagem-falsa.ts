/**
 * Saída de triagem escrita nos testes antes da triage-v7: completa os campos da reserva (`nome` e `contato_ok` nulos)
 * e a frustração (falsa), que a v7 exige. Só para os LLMs falsos dos testes.
 */
export function comoV7(raw: { itens: readonly object[]; fora_escopo: boolean; frustracao?: boolean }) {
  return { frustracao: false, ...raw, itens: raw.itens.map((i) => ({ nome: null, contato_ok: null, ...i })) }
}
