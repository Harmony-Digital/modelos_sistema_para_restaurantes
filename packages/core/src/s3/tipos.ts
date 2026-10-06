import type { DataIso } from '../s1/tempo.ts'
import type { ItemExtraido, Lacuna } from '../s1/tipos.ts'

/** Espelho do enum `event_type` do banco (o teste de @atd/db confere a igualdade). */
export const TIPOS_EVENTO = ['aniversario', 'casamento', 'corporativo', 'confraternizacao', 'outro'] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]

/** Espaço de evento ativo (lido pelo worker antes de resolver). */
export type EspacoS3Core = {
  id: string
  unitId: string
  nome: string
  capacidadeMin: number
  capacidadeMax: number
  descricao: string | null
  condicoes: string | null
}

/** Pedido de evento do próprio cliente ainda em andamento. */
export type PedidoAtivoS3 = {
  id: string
  unitId: string
  data: DataIso
  convidados: number
  tipo: TipoEvento
  status: 'novo' | 'em_contato' | 'confirmado'
  /** espaço do pedido; ausente (worker antigo) ⇒ o espaço citado não é comparado */
  spaceId?: string | null
}

/** Campo que a coleta guiada está perguntando (um por vez, nesta ordem; `espaco` só quando o citado não comporta). */
export type CampoPedido = 'unidade' | 'data' | 'convidados' | 'tipo' | 'espaco'

/** O que o worker executa na transação do commit da resposta. */
export type AcaoS3 =
  | {
    tipo: 'registrar_evento'
    unitId: string
    spaceId: string | null
    data: DataIso
    convidados: number
    tipoEvento: TipoEvento
    /** texto do cliente; só quando `tipoEvento === 'outro'` (minimização) */
    tipoTexto: string | null
    observacoes: string | null
  }
  /** `texto` é o trecho da resposta; se o banco não cancelar (corrida), o worker o troca por `textoSeFalhar`. */
  | { tipo: 'cancelar_evento'; pedidoId: string; texto: string; textoSeFalhar: string }
  /** mudança pedida num pedido em andamento: o worker acrescenta `observacao` (texto nosso, ≤ 300) às observações */
  | { tipo: 'observar_pedido'; pedidoId: string; observacao: string }

/**
 * Pedido que espera uma resposta do cliente. `item` traz o que já foi validado (unidade pelo nome do banco,
 * data em AAAA-MM-DD); `unitId` evita reabrir a lista. `campo === 'unidade'`: o item também está em
 * `pendenteUnidade` e a pergunta é o corpo da lista "Ver unidades".
 */
export type PerguntaEvento = { campo: CampoPedido; item: ItemExtraido; unitId: string | null }

export type ResultadoS3 = {
  texto: string | null
  acoes: AcaoS3[]
  perguntar: PerguntaEvento | null
  /** itens S3 que esperam a escolha da unidade na lista do S1 */
  pendenteUnidade: ItemExtraido[]
  /** pedido `confirmado` que o cliente quer cancelar, mudança de pedido em andamento ou pedido em dia já confirmado: a equipe assume */
  handoff: boolean
  lacunas: Lacuna[]
  validos: number
  respondidos: number
}
