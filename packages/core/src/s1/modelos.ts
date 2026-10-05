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

const ddmm = (d: DataIso) => {
  const { dia, mes } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`
}

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
