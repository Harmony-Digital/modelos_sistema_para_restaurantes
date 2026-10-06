import { describe, expect, it } from 'vitest'
import { parseTriageV5, parseTriageV6 } from '../src/triage.ts'
import { CASOS as CASOS_S1 } from './s1/casos.ts'
import { CASOS as CASOS_S2, FRASES as FRASES_S2 } from './s2/casos.ts'
import { CASOS as CASOS_S3, FRASES as FRASES_S3 } from './s3/casos.ts'
import { CASOS as CASOS_S4, FRASES as FRASES_S4 } from './s4/casos.ts'

/**
 * Sem regressão da v6 nos gabaritos S1–S4: todo item esperado passa pelo Zod da v6 exatamente como passa pela v5
 * (a v6 só acrescenta `frustracao` no nível da mensagem), então a camada 2 — que roda sobre esses itens — vale para a v6.
 */
const grupos = { S1: CASOS_S1, S2: [...CASOS_S2, ...FRASES_S2], S3: [...CASOS_S3, ...FRASES_S3], S4: [...CASOS_S4, ...FRASES_S4] }

describe('gabaritos S1–S4 na triage-v6', () => {
  for (const [servico, casos] of Object.entries(grupos)) {
    it(`${servico}: ${casos.length} casos com os mesmos itens na v5 e na v6`, () => {
      expect(casos.length).toBeGreaterThan(0)
      for (const c of casos) {
        const v6 = parseTriageV6({ itens: c.itens, fora_escopo: false, frustracao: false })
        // igualdade com a v5 (não com o gabarito cru: há casos de borda como convidados 0, que o Zod normaliza para null)
        expect(v6.itens, c.id).toEqual(parseTriageV5({ itens: c.itens, fora_escopo: false }).itens)
      }
    })
  }
})
