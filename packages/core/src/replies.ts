export type ReplyKey =
  | 'saudacao' | 'agradecimento' | 'foraEscopo' | 'midiaNaoSuportada' | 'handoff'
  | 'lgpdRecebido' | 'avisoPrivacidade' | 'modoEconomico' | 'erro'

const TEMPLATES: Record<ReplyKey, string> = {
  saudacao:
    'Olá! 👋 Sou o assistente virtual do {restaurante}. Posso ajudar com horários e endereços das unidades, reservas, eventos e cardápio. Como posso ajudar?',
  agradecimento: 'Por nada! Se precisar de mais alguma coisa, é só chamar. 😊',
  foraEscopo:
    'Desculpe, só consigo ajudar com assuntos do {restaurante}: horários e unidades, reservas, eventos e cardápio. Se preferir falar com uma pessoa, digite *atendente*.',
  midiaNaoSuportada: 'Por enquanto só consigo ler mensagens de texto. Pode escrever sua dúvida? ✍️',
  handoff: 'Certo! Vou chamar alguém da nossa equipe para continuar o atendimento. Aguarde um instante, por favor.',
  lgpdRecebido:
    'Recebemos seu pedido sobre seus dados pessoais. Nossa equipe vai tratar e responder em até 15 dias.',
  avisoPrivacidade:
    'Você está falando com o assistente virtual do {restaurante}. Seus dados são tratados conforme nossa política de privacidade{politica}. Para falar com uma pessoa, digite *atendente*.',
  modoEconomico: 'No momento não consigo responder automaticamente. Vou chamar alguém da equipe para te atender.',
  erro: 'Tive um problema para responder agora. Vou chamar alguém da equipe para te ajudar.',
}

export function renderReply(key: ReplyKey, vars: { restaurante: string; politicaUrl?: string | null }): string {
  return TEMPLATES[key]
    .replaceAll('{restaurante}', vars.restaurante)
    .replaceAll('{politica}', vars.politicaUrl ? `: ${vars.politicaUrl}` : '')
}
