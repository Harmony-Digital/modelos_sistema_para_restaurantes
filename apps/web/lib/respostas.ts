const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const TEMAS_COMUNS = [
  'Estacionamento', 'Wi-Fi', 'Pet friendly', 'Acessibilidade', 'Formas de pagamento', 'Música ao vivo', 'Área kids',
  'Taxa de rolha', 'Cadeira para bebê', 'Comemoração de aniversário',
] as const

export function temaDaChave(chave: string): string {
  const t = chave.startsWith('info:') ? chave.slice(5) : chave
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function acaoDaLacuna(chave: string): 'fato' | 'horarios' | 'endereco' | 'unidades' {
  if (chave === 'horario') return 'horarios'
  if (chave === 'endereco') return 'endereco'
  if (chave === 'unidades') return 'unidades'
  return 'fato'
}

const TITULO_ACAO = { horarios: 'Horário não cadastrado', endereco: 'Endereço não cadastrado', unidades: 'Nenhuma unidade cadastrada' } as const

export function tituloDaLacuna(chave: string): string {
  const acao = acaoDaLacuna(chave)
  return acao === 'fato' ? temaDaChave(chave) : TITULO_ACAO[acao]
}

export function sugestoesDeTemas(fatos: readonly { tema: string }[]): string[] {
  const existentes = new Set(fatos.map((f) => normalizar(f.tema)))
  return TEMAS_COMUNS.filter((t) => !existentes.has(normalizar(t)))
}
