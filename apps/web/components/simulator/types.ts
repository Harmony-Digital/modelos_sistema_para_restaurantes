export type SimStatus = 'enviando' | 'enviada' | 'entregue' | 'lida'
export type SimMessage =
  | { id: string; de: 'cliente' | 'restaurante'; tipo: 'texto'; texto: string; hora: string; status?: SimStatus }
  | { id: string; de: 'restaurante'; tipo: 'lista'; texto: string; botao: string; secoes: { titulo: string; itens: { id: string; titulo: string; descricao?: string }[] }[]; hora: string }
  | { id: string; de: 'restaurante'; tipo: 'localizacao'; nome: string; endereco: string; lat: number; lng: number; hora: string }
  | { id: string; de: 'sistema'; tipo: 'aviso'; texto: string }
