import { describe, expect, it } from 'vitest'
import { INGEST_EXPIRE_SECONDS, PRAZO_PROCESSANDO } from '@atd/db'
import { INGESTAO_TIMEOUT_MS } from '@atd/ai'

/** Folga para download do Storage, conferências e gravação no banco antes/depois da leitura. */
const FOLGA_MS = 30_000

describe('prazo da leitura de cardápio', () => {
  it('a leitura inteira (até 2 chamadas, cada uma com prazo total) cabe no prazo do job e antes da retomada', () => {
    // a retomada (`PRAZO_PROCESSANDO`) libera a reserva: não pode acontecer com uma chamada paga ainda em voo
    expect(PRAZO_PROCESSANDO).toBe('5 minutes')
    const leituraMaxMs = 2 * INGESTAO_TIMEOUT_MS + FOLGA_MS
    expect(leituraMaxMs).toBeLessThanOrEqual(INGEST_EXPIRE_SECONDS * 1000)
    expect(leituraMaxMs).toBeLessThanOrEqual(5 * 60 * 1000)
  })
})
