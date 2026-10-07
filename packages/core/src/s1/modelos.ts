import { minutosDe, type Turno } from './horarios.ts'
import { diaDaSemana, diasEntre, partesDaData, type DataIso } from './tempo.ts'

/** Textos padrão (o painel do 02-C permite personalizar por restaurante em reply_templates). */
export const MODELOS_S1 = {
  aberto_sim: { texto: 'A unidade {unidade} está aberta agora e fecha {fecha}.', variaveis: ['unidade', 'fecha'] },
  aberto_nao: { texto: 'A unidade {unidade} está fechada agora e abre {quando} {abre}.', variaveis: ['unidade', 'quando', 'abre'] },
  aberto_sem_previsao: { texto: 'A unidade {unidade} está fechada agora.', variaveis: ['unidade'] },
  aberto_varias: { texto: 'Agora:\n{linhas}', variaveis: ['linhas'] },
  horario_dia: { texto: '{quando}, a unidade {unidade} abre {turnos}.', variaveis: ['quando', 'unidade', 'turnos'] },
  horario_dia_fechado: { texto: '{quando}, a unidade {unidade} não abre.', variaveis: ['quando', 'unidade'] },
  horario_varias: { texto: '{quando}:\n{linhas}', variaveis: ['quando', 'linhas'] },
  horario_semana: { texto: 'Horários da unidade {unidade}:\n{linhas}', variaveis: ['unidade', 'linhas'] },
  endereco: { texto: 'A unidade {unidade} fica em {endereco}.', variaveis: ['unidade', 'endereco'] },
  como_chegar: { texto: 'A unidade {unidade} fica em {endereco}. Rota no mapa: {mapa}', variaveis: ['unidade', 'endereco', 'mapa'] },
  endereco_varias: { texto: 'Nossos endereços:\n{linhas}', variaveis: ['linhas'] },
  lista_unidades: { texto: 'Nossas unidades:\n{linhas}', variaveis: ['linhas'] },
  escolher_unidade: { texto: 'De qual unidade você quer saber? Toque em "Ver unidades" e escolha.', variaveis: [] },
  data_nao_entendida: {
    texto: 'Não entendi para qual dia é a pergunta. Pode dizer o dia da semana ou a data (ex.: sábado ou 12/10)?',
    variaveis: [],
  },
  lista_expirada: { texto: 'Essa lista expirou. Pode me mandar a pergunta de novo?', variaveis: [] },
  lacuna: { texto: 'Ainda não tenho essa informação; vou verificar com a equipe.', variaveis: [] },
  em_breve: { texto: 'Sobre {servico}, ainda estou aprendendo e em breve vou conseguir responder por aqui.', variaveis: ['servico'] },
  // S2 — avisos de presença (Etapa 03)
  escolher_unidade_aviso: { texto: 'Para qual unidade é o aviso? Toque em "Ver unidades" e escolha.', variaveis: [] },
  aviso_registrado: {
    texto: 'Anotado: {unidade}, {quando}, {pessoas}{horario}. Se mudar de ideia, é só me avisar.',
    variaveis: ['unidade', 'quando', 'pessoas', 'horario'],
  },
  aviso_atualizado: { texto: 'Atualizei seu aviso: {unidade}, {quando}, {pessoas}{horario}.', variaveis: ['unidade', 'quando', 'pessoas', 'horario'] },
  aviso_pessoas_invalido: {
    texto: 'Consigo anotar avisos de 1 a 60 pessoas. Para grupos maiores, fale com a nossa equipe.',
    variaveis: [],
  },
  // a triagem não vê o histórico: a pergunta de retorno pede o aviso completo de novo
  aviso_data_fora: { texto: 'Consigo anotar avisos de hoje até {limite}. Se quiser, mande o aviso de novo com outro dia.', variaveis: ['limite'] },
  aviso_unidade_fechada: {
    texto: '{quando}, a unidade {unidade} não abre. Se quiser, mande o aviso de novo para outro dia.',
    variaveis: ['quando', 'unidade'],
  },
  aviso_horario_fora: {
    texto: '{quando}, a unidade {unidade} funciona {turnos}. Se quiser, mande o aviso de novo com um horário nesse período.',
    variaveis: ['quando', 'unidade', 'turnos'],
  },
  aviso_horario_passado: { texto: 'Esse horário de hoje já passou. Se quiser, mande o aviso de novo com outro horário ou dia.', variaveis: [] },
  aviso_cancelado: { texto: 'Pronto, cancelei seu aviso: {unidade}, {quando}.', variaveis: ['unidade', 'quando'] },
  aviso_nao_encontrado: { texto: 'Não encontrei nenhum aviso ativo seu.', variaveis: [] },
  aviso_qual_cancelar: {
    texto: 'Você tem estes avisos:\n{linhas}\nPara cancelar, mande por exemplo: "{exemplo}".',
    variaveis: ['linhas', 'exemplo'],
  },
  // S2 — reserva com lotação (reservas-logo). Um dado por vez; o código decide unidade, data, lotação e horário.
  escolher_unidade_reserva: { texto: 'Para qual unidade é a reserva? Toque em "Ver unidades" e escolha.', variaveis: [] },
  reserva_pergunta_data: { texto: 'Para qual dia é a reserva? Consigo reservar de hoje até {limite}.', variaveis: ['limite'] },
  reserva_pergunta_pessoas: { texto: 'Para quantas pessoas?', variaveis: [] },
  reserva_pergunta_horario: { texto: 'Para que horas é a reserva?', variaveis: [] },
  reserva_pergunta_nome: { texto: 'Em nome de quem fica a reserva?', variaveis: [] },
  reserva_pergunta_contato: { texto: 'Posso usar este número do WhatsApp para falar com você sobre a reserva?', variaveis: [] },
  reserva_pergunta_contato_numero: {
    texto: 'Qual número devo usar para falar com você sobre a reserva? Mande com DDD, por exemplo: (61) 99999-8888.',
    variaveis: [],
  },
  reserva_contato_invalido: { texto: 'Não consegui ler esse número. Mande com DDD, por exemplo: (61) 99999-8888.', variaveis: [] },
  reserva_contato_invalido_whatsapp: {
    texto: 'Não consegui ler o número, então vou usar este número do WhatsApp para falar com você sobre a reserva.',
    variaveis: [],
  },
  reserva_horario_fora: {
    texto: '{quando}, a unidade {unidade} funciona {turnos}. Para que horas é a reserva?',
    variaveis: ['quando', 'unidade', 'turnos'],
  },
  reserva_horario_passado: { texto: 'Esse horário de hoje já passou. Para que horas é a reserva?', variaveis: [] },
  reserva_confirmada: {
    texto: 'Reserva feita: unidade {unidade}, {quando}, {horario}, {pessoas}, em nome de {nome}.\n\n{regras}',
    variaveis: ['unidade', 'quando', 'horario', 'pessoas', 'nome', 'regras'],
  },
  reserva_lotada: { texto: 'A unidade {unidade} está lotada {quando} para {pessoas}.', variaveis: ['unidade', 'quando', 'pessoas'] },
  reserva_lotada_outras_unidades: { texto: 'Nesse dia, temos vaga para {pessoas} em: {unidades}.', variaveis: ['pessoas', 'unidades'] },
  reserva_lotada_outro_dia: { texto: 'Se preferir, me diga outro dia.', variaveis: [] },
  reserva_lotada_grupo_menor: { texto: 'Na unidade {unidade}, ainda temos vaga para até {vagas}.', variaveis: ['unidade', 'vagas'] },
  reserva_grupo_grande: {
    texto: 'Reservas vão até 60 pessoas. Para um grupo maior, registro um pedido de evento e a nossa equipe entra em contato.',
    variaveis: [],
  },
  reserva_cancelada: { texto: 'Pronto, cancelei sua reserva: {unidade}, {quando}.', variaveis: ['unidade', 'quando'] },
  reserva_nao_encontrada: { texto: 'Não encontrei nenhuma reserva sua.', variaveis: [] },
  reserva_qual_cancelar: {
    texto: 'Você tem estas reservas:\n{linhas}\nPara cancelar, mande por exemplo: "{exemplo}".',
    variaveis: ['linhas', 'exemplo'],
  },
  // S3 — eventos (Etapa 04). Nunca "reservado"/"confirmado": a confirmação é sempre humana.
  evento_registrado: {
    texto: 'Recebemos seu pedido de {tipo} para {convidados} na unidade {unidade}, {quando}{espaco}. Nossa equipe vai entrar em contato para confirmar.',
    variaveis: ['tipo', 'convidados', 'unidade', 'quando', 'espaco'],
  },
  evento_ja_registrado: {
    texto: 'Já temos seu pedido de {tipo} para {convidados} na unidade {unidade}, {quando}. Nossa equipe vai entrar em contato para confirmar.',
    variaveis: ['tipo', 'convidados', 'unidade', 'quando'],
  },
  evento_pergunta_unidade: { texto: 'Para qual unidade é o evento? Toque em "Ver unidades" e escolha.', variaveis: [] },
  evento_pergunta_data: { texto: 'Para qual data é o evento?', variaveis: [] },
  evento_pergunta_convidados: { texto: 'Para quantos convidados?', variaveis: [] },
  evento_pergunta_tipo: { texto: 'Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)', variaveis: [] },
  evento_data_fora: { texto: 'Consigo registrar pedidos de evento de amanhã até {limite}. Qual data você prefere?', variaveis: ['limite'] },
  evento_convidados_invalido: { texto: 'Consigo registrar eventos de 1 a 1000 convidados. Para quantos convidados?', variaveis: [] },
  evento_espaco_capacidade: {
    texto: 'O espaço {espaco} recebe de {min} a {max} pessoas.{sugestoes} Qual espaço prefere? Se tanto faz, diga "pode ser qualquer um".',
    variaveis: ['espaco', 'min', 'max', 'sugestoes'],
  },
  evento_espacos: { texto: 'Espaços para eventos:\n{linhas}', variaveis: ['linhas'] },
  evento_cancelado: { texto: 'Pronto, cancelei seu pedido de evento: {unidade}, {quando}.', variaveis: ['unidade', 'quando'] },
  evento_nao_encontrado: { texto: 'Não encontrei pedido de evento seu em andamento.', variaveis: [] },
  evento_qual_cancelar: {
    texto: 'Você tem estes pedidos:\n{linhas}\nPara cancelar, mande por exemplo: "{exemplo}".',
    variaveis: ['linhas', 'exemplo'],
  },
  evento_confirmado_humano: { texto: 'Esse evento já foi confirmado pela equipe. Vou chamar um atendente para te ajudar.', variaveis: [] },
  // correções da homologação da Etapa 04 (Etapa 05): mudança de pedido e pedido em dia já confirmado vão para a equipe
  evento_mudanca_humano: { texto: 'Anotei o que você pediu e vou chamar a equipe para ajustar seu pedido de evento.', variaveis: [] },
  evento_ja_confirmado_humano: { texto: 'Já temos um evento confirmado seu nesse dia. Vou chamar a equipe para te ajudar.', variaveis: [] },
  // revisão final da Etapa 06: o cancelamento não foi feito porque a equipe recusou ou cancelou o pedido no meio
  evento_atualizado_humano: { texto: 'Seu pedido de evento foi atualizado pela equipe. Vou chamar alguém para te ajudar.', variaveis: [] },
  // S4 — cardápio (Etapa 05). Preço só do banco (`R$ 1.234,56`); nunca texto extraído pelo LLM.
  cardapio_item: { texto: 'Temos sim: {itens}', variaveis: ['itens'] },
  cardapio_indisponivel: { texto: 'Na unidade {unidade}, {item} está indisponível no momento.', variaveis: ['unidade', 'item'] },
  cardapio_filtro: { texto: 'Opções {tag}:\n{itens}', variaveis: ['tag', 'itens'] },
  cardapio_nao_encontrado: { texto: 'Não encontrei esse item no cardápio. Quer que eu mande o cardápio completo?', variaveis: [] },
  cardapio_parecido: { texto: 'Não encontrei esse item no cardápio. Temos parecido: {itens}. Quer saber o preço?', variaveis: ['itens'] },
  cardapio_enviando: { texto: 'Aqui está o nosso cardápio.', variaveis: [] },
  cardapio_sem_arquivo: { texto: 'Nosso cardápio:\n{categorias}', variaveis: ['categorias'] },
  // Handoff (Etapa 06): `handoff_fora` em todo handoff fora do horário da equipe; `handoff_frustracao` dentro do horário
  handoff_dentro: { texto: 'Vou passar você para alguém da nossa equipe. Já já te respondem por aqui.', variaveis: [] },
  handoff_fora: {
    texto: 'Vou passar você para alguém da nossa equipe. Nossa equipe atende {proximo_horario} e te responde assim que voltar.',
    variaveis: ['proximo_horario'],
  },
  // cortesia sem item (pedido vago, "tenho uma dúvida"): não conta falha
  cortesia: { texto: 'Posso ajudar com horários e unidades, aviso de presença, eventos e cardápio. É só me dizer do que precisa. 😊', variaveis: [] },
  handoff_frustracao: { texto: 'Desculpe pelo transtorno. Vou chamar alguém da nossa equipe para continuar com você.', variaveis: [] },
} as const satisfies Record<string, { texto: string; variaveis: readonly string[] }>

export type ChaveModelo = keyof typeof MODELOS_S1

const VARIAVEL = /\{(\w+)\}/g

export function renderModelo(
  chave: ChaveModelo,
  vars: Record<string, string>,
  personalizados?: Partial<Record<ChaveModelo, string>>,
): string {
  const base = personalizados?.[chave] ?? MODELOS_S1[chave].texto
  return base.replace(VARIAVEL, (todo, nome: string) => (Object.hasOwn(vars, nome) ? vars[nome]! : todo))
}

const VARIAVEL_COM_ESPACO = /\{\s+\w+\s*\}|\{\w+\s+\}/

export function validarModelo(chave: ChaveModelo, texto: string): string | null {
  if (!texto.trim()) return 'Escreva o texto do modelo.'
  if (texto.length > 1000) return 'Use no máximo 1000 caracteres.'
  if (VARIAVEL_COM_ESPACO.test(texto)) return 'Escreva as variáveis sem espaços, como {unidade}.'
  const permitidas: readonly string[] = MODELOS_S1[chave].variaveis
  for (const [, nome] of texto.matchAll(VARIAVEL)) {
    if (!permitidas.includes(nome!)) {
      const uso = permitidas.length ? `Use: ${permitidas.map((v) => `{${v}}`).join(', ')}.` : 'Este modelo não usa variáveis.'
      return `A variável {${nome}} não existe neste modelo. ${uso}`
    }
  }
  // {unidade} pode sair (resposta de uma unidade só); as demais carregam a informação
  const faltando = permitidas.find((v) => v !== 'unidade' && !texto.includes(`{${v}}`))
  if (faltando) return `Inclua {${faltando}} no texto: é ali que entra a informação.`
  return null
}

export function formatarHora(h: string): string {
  const m = minutosDe(h)
  if (m === 0) return 'meia-noite'
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, '0')}`
}

const singular = (h: string) => Math.floor(minutosDe(h) / 60) === 1 // 1h, 1h30: "à 1h"
export const asHora = (h: string) => (minutosDe(h) === 0 || singular(h) ? 'à ' : 'às ') + formatarHora(h)
export const dasHora = (h: string) => (minutosDe(h) === 0 || singular(h) ? 'da ' : 'das ') + formatarHora(h)

export function formatarTurnos(turnos: readonly Turno[]): string {
  const partes = turnos.map((t) => `${dasHora(t.abre)} ${asHora(t.fecha)}`)
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}`
}

export const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const

export const ddmm = (d: DataIso) => {
  const { dia, mes } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`
}

export const ddmmaaaa = (d: DataIso) => `${ddmm(d)}/${partesDaData(d).ano}`

/** "Hoje", "Amanhã", "Domingo (11/10)", "Segunda-feira (12/10, Nossa Senhora Aparecida)" */
export function rotuloDoDia(data: DataIso, hoje: DataIso, feriado: string | null): string {
  const delta = diasEntre(hoje, data)
  if (delta === 0) return feriado ? `Hoje (${feriado})` : 'Hoje'
  if (delta === 1) return feriado ? `Amanhã (${feriado})` : 'Amanhã'
  return `${DIAS_SEMANA[diaDaSemana(data)]} (${ddmm(data)}${feriado ? `, ${feriado}` : ''})`
}

/** "hoje", "amanhã", "no sábado (10/10)", "na quarta-feira (07/10)" */
export function quandoAbre(data: DataIso, hoje: DataIso): string {
  const delta = diasEntre(hoje, data)
  if (delta === 0) return 'hoje'
  if (delta === 1) return 'amanhã'
  const dia = diaDaSemana(data)
  return `${dia === 0 || dia === 6 ? 'no' : 'na'} ${DIAS_SEMANA[dia]!.toLowerCase()} (${ddmm(data)})`
}

export function formatarEndereco(u: { endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null }): string | null {
  if (!u.endereco?.trim()) return null
  const cidade = u.cidade && u.uf ? `${u.cidade}/${u.uf}` : (u.cidade ?? null)
  return [u.endereco.trim(), u.bairro, cidade].filter(Boolean).join(', ')
}
