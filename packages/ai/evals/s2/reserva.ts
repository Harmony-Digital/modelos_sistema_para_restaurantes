import type { ItemTriagemV7, PendenteTriagem } from '../../src/triage.ts'

/**
 * Gabarito da reserva na triage-v7: o que a IA deve EXTRAIR de cada mensagem (a decisão — cabe, lotado, horário
 * válido, mais de 60 vai para evento — é do código). "cabe" e "lotado" têm a mesma forma de extração: a camada 2
 * de `resolverAtendimento` com lotação fica com o resolvedor da T2 e o worker da T4. `pendente` é a pergunta que fizemos antes, quando houver.
 */
export type ItemV7 = ItemTriagemV7
export type RotuloReserva =
  | 'cabe' | 'lotado' | 'mesa' | 'contato_sem_pergunta' | 'intencao' | 'mudar' | 'nome' | 'contato_sim' | 'contato_nao' | 'numero_novo' | 'cancelar' | 'mais_de_60' | 'nao_e_reserva'
export type CasoReserva = { id: string; rotulo: RotuloReserva; mensagem: string; agora: string; pendente?: PendenteTriagem; itens: ItemV7[] }

const nulos = {
  unidade: null, data: null, tema: null, pessoas: null, horario: null, nome: null, contato_ok: null,
  convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null,
}
type Extra = Partial<Pick<ItemV7, 'unidade' | 'data' | 'pessoas' | 'horario' | 'nome' | 'contato_ok'>>
const reg = (extra: Extra = {}): ItemV7 => ({ servico: 'aviso_presenca', tipo: 'registrar', ...nulos, ...extra })
const can = (extra: Pick<Extra, 'unidade' | 'data'> = {}): ItemV7 => ({ servico: 'aviso_presenca', tipo: 'cancelar', ...nulos, ...extra })
const info = (tema: string, data: string | null = null): ItemV7 => ({ servico: 'horario_unidades', tipo: 'info', ...nulos, data, tema })
const evento = (extra: Partial<Pick<ItemV7, 'convidados' | 'tipoEvento'>> = {}): ItemV7 => ({ servico: 'evento', tipo: 'pedido', ...nulos, ...extra })

const SEG_14H = '2026-10-05T14:00:00-03:00'
const PERGUNTA_CONTATO = 'Posso usar este número do WhatsApp para falar com você sobre a reserva?'
/** O que já sabemos do pedido (vai no <pedido_em_andamento>) e volta repetido no item. */
const andamento = { unidade: 'Asa Sul', data: '2026-10-10', pessoas: 4, horario: '20:00' }
const conhecido = (extra: Record<string, string | number> = {}) => ({ ...andamento, ...extra })

const c = (id: string, rotulo: RotuloReserva, mensagem: string, itens: ItemV7[], pendente?: PendenteTriagem): CasoReserva =>
  ({ id, rotulo, mensagem, agora: SEG_14H, itens, ...(pendente ? { pendente } : {}) })

export const CASOS_RESERVA: CasoReserva[] = [
  // ---- a unidade tem vaga (o código confirma) e a unidade está cheia (o código oferece alternativas): a extração é a mesma
  c('rv01', 'cabe', 'quero reservar para sábado na asa sul, 4 pessoas às 20h, em nome de Ana',
    [reg({ unidade: 'asa sul', data: 'sábado', pessoas: 4, horario: '20h', nome: 'Ana' })]),
  c('rv02', 'cabe', 'Boa tarde! Queria fazer uma reserva pra amanhã na asa norte, somos 2, umas 19:30',
    [reg({ unidade: 'asa norte', data: 'amanhã', pessoas: 2, horario: '19:30' })]),
  c('rv03', 'lotado', 'reserva para sábado na asa sul, 10 pessoas às 21h',
    [reg({ unidade: 'asa sul', data: 'sábado', pessoas: 10, horario: '21h' })]),
  c('rv04', 'lotado', 'tem como reservar hoje na asa norte pra 6? chegamos 20h',
    [reg({ unidade: 'asa norte', data: 'hoje', pessoas: 6, horario: '20h' })]),
  // ---- "tem mesa/lugar para N?" é reserva na v7 (o fluxo responde se cabe)
  c('rv27', 'mesa', 'tem mesa pra 4 hoje?', [reg({ data: 'hoje', pessoas: 4 })]),
  c('rv28', 'mesa', 'tem lugar para 6 sábado na asa sul?', [reg({ unidade: 'asa sul', data: 'sábado', pessoas: 6 })]),
  // ---- sem a pergunta do contato pendente, contato_ok é null mesmo que o cliente fale do número
  c('rv29', 'contato_sem_pergunta', 'quero reservar pra 2 hoje, pode usar esse número', [reg({ data: 'hoje', pessoas: 2 })]),
  // ---- intenção sem todos os dados (o código pergunta um de cada vez)
  c('rv05', 'intencao', 'quero reservar', [reg()]),
  c('rv06', 'intencao', 'reserva para sábado', [reg({ data: 'sábado' })]),
  c('rv07', 'intencao', 'vou hoje com 4', [reg({ data: 'hoje', pessoas: 4 })]),
  c('rv08', 'intencao', 'vou passar aí sábado à noite com minha esposa', [reg({ data: 'sábado', pessoas: 2, horario: 'à noite' })]),
  // ---- respostas curtas a uma pergunta pendente
  c('rv09', 'intencao', 'umas 20h', [reg({ ...andamento, horario: 'umas 20h' })],
    { pergunta: 'Para que horas?', conhecido: { unidade: 'Asa Sul', data: '2026-10-10', pessoas: 4 } }),
  c('rv10', 'nome', 'Carlos', [reg({ ...andamento, nome: 'Carlos' })], { pergunta: 'Em nome de quem fica a reserva?', conhecido: conhecido() }),
  c('rv11', 'nome', 'pode colocar no nome da Maria Souza', [reg({ ...andamento, nome: 'Maria Souza' })],
    { pergunta: 'Em nome de quem fica a reserva?', conhecido: conhecido() }),
  c('rv12', 'nome', 'meu nome é João, quero reservar pra 3 amanhã na asa norte',
    [reg({ unidade: 'asa norte', data: 'amanhã', pessoas: 3, nome: 'João' })]),
  c('rv13', 'contato_sim', 'pode sim', [reg({ ...andamento, nome: 'Ana', contato_ok: true })],
    { pergunta: PERGUNTA_CONTATO, conhecido: conhecido({ nome: 'Ana' }) }),
  c('rv14', 'contato_sim', 'sim, esse mesmo', [reg({ ...andamento, nome: 'Ana', contato_ok: true })],
    { pergunta: PERGUNTA_CONTATO, conhecido: conhecido({ nome: 'Ana' }) }),
  c('rv15', 'contato_nao', 'não, prefiro outro número', [reg({ ...andamento, nome: 'Ana', contato_ok: false })],
    { pergunta: PERGUNTA_CONTATO, conhecido: conhecido({ nome: 'Ana' }) }),
  // o worker captura o número do texto bruto; o LLM só vê [TELEFONE] e responde "não" à pergunta
  c('rv16', 'numero_novo', 'não, liga no (61) 98888-7777', [reg({ ...andamento, nome: 'Ana', contato_ok: false })],
    { pergunta: PERGUNTA_CONTATO, conhecido: conhecido({ nome: 'Ana' }) }),
  c('rv17', 'numero_novo', 'melhor no +55 61 99999-8888 que é do meu marido', [reg({ ...andamento, nome: 'Ana', contato_ok: false })],
    { pergunta: PERGUNTA_CONTATO, conhecido: conhecido({ nome: 'Ana' }) }),
  // ---- mudar uma reserva que já existe (o código atualiza)
  c('rv18', 'mudar', 'na verdade vamos ser 6 no sábado', [reg({ data: 'sábado', pessoas: 6 })]),
  c('rv19', 'mudar', 'muda minha reserva de sábado para as 21h', [reg({ data: 'sábado', horario: '21h' })]),
  // ---- cancelar
  c('rv20', 'cancelar', 'cancela minha reserva de sábado', [can({ data: 'sábado' })]),
  c('rv21', 'cancelar', 'não vou mais, pode cancelar', [can()]),
  // ---- mais de 60: a IA extrai o número; o código manda para evento
  c('rv22', 'mais_de_60', 'quero reservar para 80 pessoas sábado na asa sul', [reg({ unidade: 'asa sul', data: 'sábado', pessoas: 80 })]),
  c('rv23', 'mais_de_60', 'vamos em 70 na asa norte amanhã às 20h', [reg({ unidade: 'asa norte', data: 'amanhã', pessoas: 70, horario: '20h' })]),
  // ---- não é reserva
  c('rv24', 'nao_e_reserva', 'precisa reservar?', [info('reserva')]),
  c('rv25', 'nao_e_reserva', 'costuma lotar no sábado?', [info('lotacao', 'sábado')]),
  c('rv26', 'nao_e_reserva', 'quero reservar o espaço para a festa de aniversário da minha filha', [evento({ tipoEvento: 'aniversário' })]),
]
