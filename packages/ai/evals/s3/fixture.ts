// Mesma fixture do S1 (unidades, horários, fatos): o S3 acrescenta os espaços de evento de cada unidade.
import type { ContextoS1, EspacoS3Core } from '@atd/core'
import { ASA_NORTE, CONTEXTO } from '../s1/fixture.ts'

export * from '../s1/fixture.ts'

const espaco = (id: string, unitId: string, nome: string, capacidadeMin: number, capacidadeMax: number, descricao: string | null = null, condicoes: string | null = null): EspacoS3Core =>
  ({ id, unitId, nome, capacidadeMin, capacidadeMax, descricao, condicoes })

export const ESPACOS: EspacoS3Core[] = [
  // Asa Sul
  espaco('e-as-varanda', 'u-asa-sul', 'Varanda', 10, 30),
  espaco('e-as-salao', 'u-asa-sul', 'Salão Principal', 30, 80, 'Salão climatizado com som.', 'Consumação mínima por pessoa.'),
  espaco('e-as-privativa', 'u-asa-sul', 'Sala Privativa', 8, 20),
  // Asa Norte
  espaco('e-an-mezanino', 'u-asa-norte', 'Mezanino', 15, 40, 'Área no andar de cima.'),
  espaco('e-an-jardim', 'u-asa-norte', 'Salão Jardim', 40, 120),
  // Lago Sul
  espaco('e-ls-terraco', 'u-lago-sul', 'Terraço', 15, 50),
  espaco('e-ls-adega', 'u-lago-sul', 'Adega', 6, 12, null, 'Taxa de rolha.'),
  // Águas Claras
  espaco('e-ac-gourmet', 'u-aguas-claras', 'Espaço Gourmet', 10, 40),
  espaco('e-ac-salao', 'u-aguas-claras', 'Salão AC', 40, 100),
]

export const CONTEXTO_UMA_UNIDADE: ContextoS1 = { ...CONTEXTO, unidades: [ASA_NORTE] }
export const CONTEXTO_SEM_UNIDADES: ContextoS1 = { ...CONTEXTO, unidades: [] }
