import { z } from 'zod'
import { DIAS_HORARIO_HUMANO, horarioHumanoSchema, type DiaHorarioHumano, type HorarioHumano } from '@atd/core/conversa'

export const MAX_RESPOSTAS_ATIVAS = 30

export const respostaRapidaSchema = z.object({
  titulo: z.string().trim().min(1, 'Dê um título curto, como "Boas-vindas"').max(40, 'Use no máximo 40 caracteres'),
  texto: z.string().trim().min(1, 'Escreva o texto da resposta').max(1000, 'Use no máximo 1000 caracteres'),
  ativo: z.boolean(),
})
export type RespostaRapidaForm = z.input<typeof respostaRapidaSchema>

/** Formulário: os 7 dias sempre presentes (lista vazia = a equipe não atende); dias vazios saem antes da validação do core. */
export const horarioHumanoFormSchema = z
  .object({ dias: z.partialRecord(z.enum(DIAS_HORARIO_HUMANO), z.array(z.object({ inicio: z.string(), fim: z.string() }))) })
  .transform((v) => ({
    dias: Object.fromEntries(Object.entries(v.dias).filter(([, ts]) => ts !== undefined && ts.length > 0)),
  }))
  .pipe(horarioHumanoSchema)
export type HorarioHumanoForm = z.input<typeof horarioHumanoFormSchema>

export function horarioParaForm(h: HorarioHumano): HorarioHumanoForm {
  return {
    dias: Object.fromEntries(DIAS_HORARIO_HUMANO.map((d) => [d, (h.dias[d] ?? []).map((t) => ({ ...t }))])) as Record<
      DiaHorarioHumano,
      { inicio: string; fim: string }[]
    >,
  }
}

/** O que está no banco pode não bater com o formato (jsonb cru): cai em "sem horário". */
export function lerHorarioSalvo(cru: unknown): HorarioHumano {
  const p = horarioHumanoSchema.safeParse(cru)
  return p.success ? p.data : { dias: {} }
}
