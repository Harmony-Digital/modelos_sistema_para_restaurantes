import { describe, expect, it } from 'vitest'
import { CONCORRENCIA, POOL_DRIZZLE_WORKER } from './concorrencia.ts'

describe('pool do worker', () => {
  it('cabe todos os jobs simultâneos (cada um segura uma conexão, inclusive durante o HTTP da Meta) + heartbeat + folga', () => {
    const jobs = CONCORRENCIA.process + CONCORRENCIA.deliver + CONCORRENCIA.ingest
    expect(POOL_DRIZZLE_WORKER).toBeGreaterThanOrEqual(jobs + 2)
    expect(POOL_DRIZZLE_WORKER).toBeGreaterThanOrEqual(8)
  })
})
