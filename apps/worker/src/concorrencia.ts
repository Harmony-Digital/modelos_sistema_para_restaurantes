/** Jobs simultâneos por fila neste processo (`localConcurrency` do pg-boss). */
export const CONCORRENCIA = { process: 4, deliver: 2, ingest: 1, convite: 1, retencao: 1 } as const

/**
 * Conexões do drizzle: cada job segura uma conexão enquanto roda (inclusive durante o HTTP da Meta, que fica dentro da
 * transação da mensagem: até 10 s, 60 s no upload de mídia). 9 jobs + heartbeat + 1 de folga = 11.
 */
export const POOL_DRIZZLE_WORKER = Object.values(CONCORRENCIA).reduce((a, b) => a + b, 0) + 2
