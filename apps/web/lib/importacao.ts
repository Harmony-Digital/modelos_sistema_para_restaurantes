/** Endereços da aba Importar (módulo comum: usado por Server Components e por componentes de cliente). */
export type AlvoImportacaoTela = 'cardapio' | 'informacoes' | 'horarios' | 'espacos'
export type ModoImportacaoTela = 'completo' | 'so_precos'

export const ALVOS_IMPORTACAO_TELA: readonly { chave: AlvoImportacaoTela; rotulo: string; descricao: string }[] = [
  { chave: 'cardapio', rotulo: 'Cardápio', descricao: 'Itens, categorias e preços do cardápio.' },
  { chave: 'informacoes', rotulo: 'Informações', descricao: 'Respostas sobre o restaurante: estacionamento, pets, formas de pagamento…' },
  { chave: 'horarios', rotulo: 'Horários', descricao: 'Horário de funcionamento de cada unidade e datas especiais.' },
  { chave: 'espacos', rotulo: 'Espaços', descricao: 'Espaços para eventos de cada unidade, com capacidade.' },
]

export const URL_IMPORTAR = '/conteudo?aba=importar'
export const urlImportarAlvo = (alvo: AlvoImportacaoTela) => `${URL_IMPORTAR}&alvo=${alvo}`
export const urlImportacao = (id: string) => `${URL_IMPORTAR}&imp=${id}`

/** Confirmar uma importação que não está em `rascunho` (ainda lendo, com erro ou descartada). */
export const MENSAGEM_NAO_PRONTA =
  'Esta importação não está pronta para confirmar: a leitura ainda não terminou, deu erro ou ela foi descartada. Atualize a página.'
