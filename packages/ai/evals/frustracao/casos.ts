/**
 * Gabarito da frustração (triage-v6, camada 1): `frustracao = true` só com irritação COM O ATENDIMENTO.
 * As não-frustrações são parecidas de propósito (reclamação de coisa externa, caixa alta sem raiva, "já perguntei"
 * para outra pessoa) — cada uma que virar true é um handoff desnecessário.
 */
export type Pendente = { pergunta: string; conhecido: Record<string, string | number> }
export type CasoFrustracao = { id: string; mensagem: string; frustracao: boolean; pendente?: Pendente }

const CONVIDADOS: Pendente = { pergunta: 'Para quantos convidados?', conhecido: { unidade: 'Asa Sul', data: '2026-10-17' } }

export const CASOS_FRUSTRACAO: CasoFrustracao[] = [
  // frustração com o atendimento
  { id: 'f01', mensagem: 'JÁ PERGUNTEI ISSO TRÊS VEZES!!! QUE HORAS ABRE?', frustracao: true },
  { id: 'f02', mensagem: 'ninguém responde nesse whatsapp?', frustracao: true },
  { id: 'f03', mensagem: 'que atendimento péssimo, ninguém me ajuda', frustracao: true },
  { id: 'f04', mensagem: 'esse robô não entende nada, aff', frustracao: true },
  { id: 'f05', mensagem: 'já falei que são 40 pessoas, presta atenção', frustracao: true },
  { id: 'f06', mensagem: 'vocês são uma piada, faz uma hora que espero resposta', frustracao: true },
  { id: 'f07', mensagem: 'porra, responde logo', frustracao: true },
  { id: 'f08', mensagem: 'cansei de falar com máquina, que saco', frustracao: true },
  { id: 'f09', mensagem: 'VOCÊS NÃO LEEM O QUE EU ESCREVO???', frustracao: true },
  { id: 'f10', mensagem: 'pela terceira vez: quanto custa a picanha?', frustracao: true },
  { id: 'f11', mensagem: 'demoraram demais pra responder, ridículo', frustracao: true },
  { id: 'f12', mensagem: 'eu já disse!!! 40, não lê não?', frustracao: true, pendente: CONVIDADOS },
  // parecidas, mas sem irritação com o atendimento
  { id: 'n01', mensagem: 'que demora pra abrir, hein? abre que horas hoje?', frustracao: false },
  { id: 'n02', mensagem: 'o trânsito tá horrível, vou chegar atrasado, somos 4 às 20h na asa sul', frustracao: false },
  { id: 'n03', mensagem: 'a fila na porta ontem tava enorme, precisa reservar?', frustracao: false },
  { id: 'n04', mensagem: 'tá um calor insuportável hoje, tem cerveja gelada?', frustracao: false },
  { id: 'n05', mensagem: 'alguém aí?', frustracao: false },
  { id: 'n06', mensagem: 'oi, boa noite! vocês abrem domingo?', frustracao: false },
  { id: 'n07', mensagem: 'nossa, que fome! me manda o cardápio', frustracao: false },
  { id: 'n08', mensagem: 'odeio segunda-feira kkk, vocês abrem hoje?', frustracao: false },
  { id: 'n09', mensagem: 'o outro restaurante demorou demais pra me atender, vocês têm espaço para 30 pessoas?', frustracao: false },
  { id: 'n10', mensagem: 'já perguntei pro meu marido e ele quer a feijoada, tem no sábado?', frustracao: false },
  { id: 'n11', mensagem: 'já falei com minha esposa, somos 3 amanhã à noite', frustracao: false },
  { id: 'n12', mensagem: 'uns 40, desculpa a demora pra responder', frustracao: false, pendente: CONVIDADOS },
  { id: 'n13', mensagem: 'obrigado! vocês foram ótimos no aniversário da minha filha', frustracao: false },
]
