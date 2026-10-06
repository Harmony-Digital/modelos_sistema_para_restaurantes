/** Jobs simultâneos por fila neste processo (`localConcurrency` do pg-boss). */
export const CONCORRENCIA = { process: 4, deliver: 2, ingest: 1 } as const

/**
 * Conexões do drizzle: cada job segura uma conexão enquanto roda (inclusive durante o HTTP da Meta, que fica dentro da
 * transação da mensagem: até 10 s, 60 s no upload de mídia). 7 jobs + heartbeat + 1 de folga = 9.
 */
export const POOL_DRIZZLE_WORKER = CONCORRENCIA.process + CONCORRENCIA.deliver + CONCORRENCIA.ingest + 2
