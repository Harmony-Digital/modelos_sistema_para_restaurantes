export type ReplyKey =
  | 'saudacao' | 'agradecimento' | 'foraEscopo' | 'midiaNaoSuportada' | 'handoff'
  | 'lgpdRecebido' | 'avisoPrivacidade' | 'emBreve' | 'modoEconomico' | 'erro'

const TEMPLATES: Record<ReplyKey, string> = {
  saudacao:
    'Olá! 👋 Sou o assistente virtual do {restaurante}. Posso ajudar com horários e endereços das unidades, aviso de presença, eventos e cardápio. Como posso ajudar?',
  agradecimento: 'Por nada! Se precisar de mais alguma coisa, é só chamar. 😊',
  foraEscopo:
    'Desculpe, só consigo ajudar com assuntos do {restaurante}: horários e unidades, aviso de presença, eventos e cardápio. Se preferir falar com uma pessoa, digite *atendente*.',
  midiaNaoSuportada: 'Por enquanto só consigo ler mensagens de texto. Pode escrever sua dúvida? ✍️',
  handoff: 'Certo! Vou chamar alguém da nossa equipe para continuar o atendimento. Aguarde um instante, por favor.',
  lgpdRecebido:
    'Recebemos seu pedido sobre seus dados pessoais. Nossa equipe vai tratar e responder em até 15 dias.',
  avisoPrivacidade:
    'Você está falando com o assistente virtual do {restaurante}. Seus dados são tratados conforme nossa política de privacidade{politica}. Para falar com uma pessoa, digite *atendente*.',
  emBreve:
    'Ainda estou aprendendo sobre isso e em breve vou conseguir responder por aqui. Se quiser, digite *atendente* para falar com uma pessoa.',
  modoEconomico: 'No momento não consigo responder automaticamente. Vou chamar alguém da equipe para te atender.',
  erro: 'Tive um problema para responder agora. Vou chamar alguém da equipe para te ajudar.',
}

export function renderReply(key: ReplyKey, vars: { restaurante: string; politicaUrl?: string | null }): string {
  return TEMPLATES[key]
    .replaceAll('{restaurante}', vars.restaurante)
    .replaceAll('{politica}', vars.politicaUrl ? `: ${vars.politicaUrl}` : '')
}
