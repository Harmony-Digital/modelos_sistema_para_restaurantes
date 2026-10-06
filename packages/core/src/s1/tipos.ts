import type { AgendaUnidade, PoliticaFeriado } from './horarios.ts'
import type { ChaveModelo } from './modelos.ts'

export const SERVICOS = ['horario_unidades', 'aviso_presenca', 'evento', 'cardapio', 'humano', 'lgpd'] as const
export type Servico = (typeof SERVICOS)[number]

export const TIPOS_S1 = [
  'aberto_agora', 'horario_dia', 'horario_semana', 'feriado', 'endereco', 'como_chegar', 'lista_unidades', 'info',
] as const
export type TipoS1 = (typeof TIPOS_S1)[number]

export const TIPOS_S2 = ['registrar', 'cancelar'] as const
export type TipoS2 = (typeof TIPOS_S2)[number]

/**
 * Um pedido extraído da mensagem pela triagem. Textos como o cliente escreveu.
 * `pessoas`/`horario` só vêm em avisos de presença (triage-v3); a v2 preenche null.
 */
export type ItemExtraido = {
  servico: Servico
  tipo: TipoS1 | TipoS2 | null
  unidade: string | null
  data: string | null
  tema: string | null
  pessoas: number | null
  horario: string | null
}

export type UnidadeS1 = AgendaUnidade & {
  id: string
  nome: string
  apelidos: string[]
  ordem: number
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  lat: number | null
  lng: number | null
  mapsUrl: string | null
}

export type FatoS1 = { id: string; tema: string; exemplos: string[]; texto: string; unitId: string | null }

export type ContextoS1 = {
  restaurante: string
  timezone: string
  politicaFeriado: PoliticaFeriado
  /** só unidades ativas */
  unidades: UnidadeS1[]
  fatos: FatoS1[]
  modelos: Partial<Record<ChaveModelo, string>>
}

export type Localizacao = { lat: number; lng: number; nome: string; endereco: string }
export type OpcaoLista = { id: string; titulo: string; descricao: string }
export type ListaUnidades = { corpo: string; botao: string; opcoes: OpcaoLista[] }
export type Lacuna = { chave: string; unitId: string | null }

export type ResultadoS1 = {
  texto: string | null
  localizacoes: Localizacao[]
  lista: ListaUnidades | null
  pendente: ItemExtraido[]
  lacunas: Lacuna[]
  validos: number
  respondidos: number
}
