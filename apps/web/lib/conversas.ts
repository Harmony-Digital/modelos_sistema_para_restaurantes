import type { AbaInbox, ErroInbox } from '@atd/db'

/** Texto do compositor fora da janela de 24 h (spec §2.2). */
export const TEXTO_FORA_DA_JANELA =
  'O cliente não escreve há mais de 24 h. O WhatsApp só permite responder quando ele mandar uma nova mensagem.'

export const MENSAGEM_ERRO_INBOX: Record<ErroInbox, string> = {
  nao_encontrada: 'Não encontramos essa conversa. Ela pode ter sido encerrada ou você não tem acesso a ela.',
  ja_atendida: 'Outra pessoa já está atendendo esta conversa.',
  transicao_invalida: 'Esta conversa mudou de situação. Confira a tela antes de continuar.',
  fora_da_janela: TEXTO_FORA_DA_JANELA,
  nao_e_seu: 'Só quem assumiu a conversa pode responder ou mudar o atendimento.',
  texto_invalido: 'A resposta precisa ter de 1 a 4096 caracteres.',
}

export const ABAS_INBOX: readonly { aba: AbaInbox; rotulo: string }[] = [
  { aba: 'aguardando', rotulo: 'Aguardando' },
  { aba: 'em_atendimento', rotulo: 'Em atendimento' },
  { aba: 'ia', rotulo: 'Com a IA' },
  { aba: 'encerradas', rotulo: 'Encerradas' },
]

export function abaDe(v: string | undefined): AbaInbox {
  return ABAS_INBOX.some((a) => a.aba === v) ? (v as AbaInbox) : 'aguardando'
}

export const VAZIO_INBOX: Record<AbaInbox, { titulo: string; descricao: string }> = {
  aguardando: {
    titulo: 'Nenhuma conversa aguardando',
    descricao: 'Nenhuma conversa aguardando. Quando a IA passar alguém para a equipe, aparece aqui.',
  },
  em_atendimento: {
    titulo: 'Ninguém em atendimento',
    descricao: 'Quando alguém da equipe assumir uma conversa, ela aparece aqui.',
  },
  ia: { titulo: 'Nenhuma conversa com a IA', descricao: 'As conversas que a IA está respondendo aparecem aqui.' },
  encerradas: { titulo: 'Nenhuma conversa encerrada', descricao: 'Conversas encerradas nos últimos 30 dias aparecem aqui.' },
}

export const ROTULO_ESTADO = {
  ia: 'Com a IA',
  aguardando_humano: 'Aguardando',
  humano: 'Em atendimento',
  encerrada: 'Encerrada',
} as const

export const ROTULO_MOTIVO = {
  pedido: 'Pediu atendente',
  frustracao: 'Cliente insatisfeito',
  falhas: 'IA não conseguiu responder',
  economico: 'Limite de gasto da IA',
  servico: 'Pedido para a equipe',
} as const

/**
 * Tópicos do Realtime privado: quem acessa todas as unidades escuta o do restaurante (inclui conversas sem unidade);
 * os demais, um por unidade permitida.
 */
export function topicosInbox(a: { restaurantId: string; todas: boolean; unidades: readonly { id: string }[] }): string[] {
  return a.todas ? [`inbox:r:${a.restaurantId}`] : a.unidades.map((u) => `inbox:u:${u.id}`)
}

export const topicoConversa = (id: string) => `conversa:${id}`

/** "(2) Atendimento IA" — tira um contador anterior antes de pôr o novo. */
export function tituloComContador(titulo: string, n: number): string {
  const base = titulo.replace(/^\(\d+\)\s*/, '')
  return n > 0 ? `(${n}) ${base}` : base
}

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
export function haQuanto(d: Date, agora: Date = new Date()): string {
  const min = Math.round((agora.getTime() - new Date(d).getTime()) / 60_000)
  if (min < 60) return rtf.format(-Math.max(min, 1), 'minute')
  const h = Math.round(min / 60)
  return h < 24 ? rtf.format(-h, 'hour') : rtf.format(-Math.round(h / 24), 'day')
}

/** Mediana do "tempo até assumir" (segundos) para o cartão do Início. */
export function formatarEspera(segundos: number | null): string {
  if (segundos === null) return '—'
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`
}
