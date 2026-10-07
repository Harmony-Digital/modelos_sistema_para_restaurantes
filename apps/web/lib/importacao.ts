/** Endereços da aba Importar (módulo comum: usado por Server Components e por componentes de cliente). */
export type AlvoImportacaoTela = 'cardapio' | 'informacoes' | 'horarios' | 'espacos'
export type ModoImportacaoTela = 'completo' | 'so_precos'

export const ALVOS_IMPORTACAO_TELA: readonly { chave: AlvoImportacaoTela; rotulo: string; descricao: string }[] = [
  { chave: 'cardapio', rotulo: 'Cardápio', descricao: 'Itens, categorias e preços do cardápio.' },
  { chave: 'informacoes', rotulo: 'Informações', descricao: 'Respostas sobre o restaurante: estacionamento, pets, formas de pagamento…' },
  { chave: 'horarios', rotulo: 'Horários', descricao: 'Horário de funcionamento de cada unidade e datas especiais.' },
  { chave: 'espacos', rotulo: 'Espaços', descricao: 'Espaços para eventos de cada unidade, com capacidade.' },
]

/**
 * Cada tela importa o que é dela: Cardápio e Informações abrem o importador na própria aba de Conteúdo; horários e
 * espaços abrem ao lado da lista de Unidades.
 */
const ENTRADA: Record<AlvoImportacaoTela, string> = {
  cardapio: '/conteudo?aba=cardapio&importar=1',
  informacoes: '/conteudo?aba=informacoes&importar=1',
  horarios: '/unidades/importar?alvo=horarios',
  espacos: '/unidades/importar?alvo=espacos',
}
export const urlImportarAlvo = (alvo: AlvoImportacaoTela) => ENTRADA[alvo]
export const urlImportacao = (id: string, alvo: AlvoImportacaoTela) => `${ENTRADA[alvo]}&imp=${id}`

/** Alvos importados pela mesma tela que o `alvo` (Unidades importa horários e espaços). */
export function alvosDaTela(alvo: AlvoImportacaoTela): readonly AlvoImportacaoTela[] {
  return alvo === 'horarios' || alvo === 'espacos' ? ['horarios', 'espacos'] : [alvo]
}

/** Confirmar uma importação que não está em `rascunho` (ainda lendo, com erro ou descartada). */
export const MENSAGEM_NAO_PRONTA =
  'Esta importação não está pronta para confirmar: a leitura ainda não terminou, deu erro ou ela foi descartada. Atualize a página.'
