import { describe, expect, it } from 'vitest'
import { INGEST_EXPIRE_SECONDS, PRAZO_CONCESSAO_LOTE, PRAZO_PROCESSANDO } from '@atd/db'
import { INGESTAO_TIMEOUT_MS } from '@atd/ai'

/** Folga para download do Storage, divisão do PDF (pdf-lib), conferências e gravação no banco antes/depois da leitura. */
const FOLGA_MS = 30_000
/** Margem mínima entre o pior caso de uma execução e o prazo do job (o pg-boss não pode expirar um handler vivo). */
const MARGEM_MS = 60_000

describe('prazo da leitura (cardápio da Etapa 05 e lote da Etapa 07)', () => {
  const leituraMaxMs = 2 * INGESTAO_TIMEOUT_MS + FOLGA_MS

  it('a leitura inteira (até 2 chamadas, cada uma com prazo total) cabe com folga no prazo do job', () => {
    expect(leituraMaxMs + MARGEM_MS).toBeLessThanOrEqual(INGEST_EXPIRE_SECONDS * 1000)
  })

  it('arquivo único: a retomada (`PRAZO_PROCESSANDO`) nunca chega com uma chamada paga ainda em voo', () => {
    expect(PRAZO_PROCESSANDO).toBe('5 minutes')
    expect(leituraMaxMs).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('lote: a concessão dura o prazo do job — a repetição de um job expirado só retoma depois dela', () => {
    expect(PRAZO_CONCESSAO_LOTE).toBe(`${INGEST_EXPIRE_SECONDS} seconds`)
  })
})
