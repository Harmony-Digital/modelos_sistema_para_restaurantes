import type { ItemExtraido, ResultadoS1 } from '../s1/tipos.ts'
import type { DataIso } from '../s1/tempo.ts'
import type { AcaoS3, PerguntaEvento, PerguntaEventoAdiada } from '../s3/tipos.ts'
import type { AcaoS4 } from '../s4/tipos.ts'

/**
 * Reserva confirmada do próprio cliente (lida pelo worker antes de resolver). `horario` (HH:MM) e `nome` só existem
 * nas reservas novas; ausentes (avisos antigos), a mudança pergunta o que faltar.
 */
export type AvisoAtivoS2 = {
  id: string
  unitId: string
  data: DataIso
  pessoas: number
  horarioAprox: string | null
  horario?: string | null
  nome?: string | null
}

/** Ocupação de uma unidade num dia (soma das reservas confirmadas do mesmo `simulado`); `capacidade` null = sem limite. */
export type VagasUnidade = { ocupadas: number; capacidade: number | null }

/** Resposta à pergunta `contato_numero`: o número que o worker capturou do texto bruto (E.164) ou null. */
export type RespostaNumero = { valor: string | null; tentativas: number }

/**
 * O que a reserva precisa além do S1. Sem ele, o S2 segue o aviso de presença antigo (worker anterior à reserva).
 * `vagas`: por dia e unidade; dia ou unidade ausente = sem limite conhecido (o banco confere de novo no commit).
 */
export type ContextoReserva = {
  vagas: ReadonlyMap<DataIso, ReadonlyMap<string, VagasUnidade>>
  /** `restaurants.regras_reserva`, enviado depois do resumo */
  regras: string
  /**
   * Pergunta da reserva que esta mensagem responde (o pendente). `contato_ok` do item só vale quando ela é `contato` ou
   * `contato_numero` (fora disso vale o já guardado nela); `numero` só vale quando ela é `contato_numero`.
   */
  pergunta?: PerguntaReserva | null
  /** número capturado do texto bruto; só com o pendente `contato_numero` */
  numero?: RespostaNumero
}

/**
 * Campo que a coleta da reserva está perguntando (um por vez, nesta ordem). `lotado`: a unidade estava cheia; a reserva
 * fica guardada (sem unidade fixa) para "e no domingo?", "e na Asa Norte?" ou "e para 3?" continuarem sem recomeçar.
 */
export type CampoReserva = 'unidade' | 'data' | 'pessoas' | 'horario' | 'nome' | 'contato' | 'contato_numero' | 'lotado'

/**
 * Reserva que espera uma resposta. `item` traz o que já foi validado (unidade pelo nome do banco, data AAAA-MM-DD,
 * horário HH:MM, nome limpo, `contato_ok`); `unitId` evita reabrir a lista. `campo === 'unidade'`: o item também está em
 * `pendenteUnidade` e a pergunta é o corpo da lista. `tentativasNumero`: números inválidos já recebidos (0 ou 1).
 */
export type PerguntaReserva = { campo: CampoReserva; item: ItemExtraido; unitId: string | null; tentativasNumero: number }

/** Contato da reserva: o próprio WhatsApp, um número informado (E.164, capturado pelo worker) ou o da reserva existente. */
export type ContatoReserva = 'whatsapp' | { numero: string } | 'manter'

/** O que o worker executa na transação do commit da resposta. */
export type AcaoS2 =
  /**
   * Reserva nova ou mudança (`atualiza`, `reservaId`). `texto` é o trecho da resposta; se o banco recusar por lotação
   * (corrida nas últimas vagas), o worker o troca por `textoSeLotado`.
   */
  | {
    tipo: 'registrar'; unitId: string; data: DataIso; pessoas: number; horario: string; nome: string; contato: ContatoReserva
    atualiza: boolean; reservaId?: string; texto: string; textoSeLotado: string
  }
  /** Aviso de presença antigo (sem `ContextoReserva`); sai com a troca do worker para a reserva. */
  | { tipo: 'registrar_aviso'; unitId: string; data: DataIso; pessoas: number; horarioAprox: string | null; atualiza: boolean }
  /** `texto` é o trecho da resposta; se o banco não cancelar (corrida), o worker o troca por `textoSeFalhar`. */
  | { tipo: 'cancelar'; avisoId: string; texto: string; textoSeFalhar: string }

export type ResultadoS2 = {
  texto: string | null
  acoes: AcaoS2[]
  /** reserva esperando um campo (no aviso antigo, só `pessoas`) */
  perguntarReserva: PerguntaReserva | null
  /** itens S2 que esperam a escolha da unidade na lista do S1 */
  pendenteUnidade: ItemExtraido[]
  validos: number
  respondidos: number
}

export type ResultadoAtendimento = ResultadoS1 & {
  acoesS2: AcaoS2[]
  /** reserva esperando um campo; `campo === 'unidade'` coincide com a lista pendente */
  perguntarReserva: PerguntaReserva | null
  acoesS3: AcaoS3[]
  /** pedido de evento esperando um campo; `campo === 'unidade'` coincide com a lista pendente */
  perguntarEvento: PerguntaEvento | null
  /** pergunta do evento escondida por outra pergunta desta resposta: o worker guarda e faz depois (`retomarPerguntaEvento`); ausente = nenhuma */
  perguntaEventoAdiada?: PerguntaEventoAdiada
  /** evento: cancelar pedido confirmado, mudar pedido em andamento ou pedir em dia já confirmado — a equipe assume */
  handoff: boolean
  /** cardápio: arquivos a enviar (vazio sem os dados do S4) */
  acoesS4: AcaoS4[]
}
