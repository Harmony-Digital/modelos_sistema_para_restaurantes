export type SimStatus = 'enviando' | 'enviada' | 'entregue' | 'lida'
export type SimMessage =
  | { id: string; de: 'cliente' | 'restaurante'; tipo: 'texto'; texto: string; hora: string; status?: SimStatus }
  | { id: string; de: 'restaurante'; tipo: 'lista'; texto: string; botao: string; secoes: { titulo: string; itens: { id: string; titulo: string; descricao?: string }[] }[]; hora: string }
  | { id: string; de: 'restaurante'; tipo: 'localizacao'; nome: string; endereco: string; lat: number; lng: number; hora: string }
  /** arquivo do cardápio; `url` assinada e curta (null: não foi possível gerar agora) */
  | { id: string; de: 'restaurante'; tipo: 'documento'; titulo: string; url: string | null; hora: string }
  | { id: string; de: 'restaurante'; tipo: 'imagem'; url: string | null; legenda: string; hora: string }
  | { id: string; de: 'sistema'; tipo: 'aviso'; texto: string; /** trecho do texto que vira link */ link?: { rotulo: string; href: string } }
