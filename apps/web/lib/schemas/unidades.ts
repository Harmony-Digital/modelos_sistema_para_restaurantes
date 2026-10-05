import { z } from 'zod'
import { ehLinkGoogleMaps, validarSemana, validarTurnos } from '@atd/core/s1'
import { dataBr, hora, telefoneBr } from '@/lib/validation'

const opcional = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres`)
const turno = z.object({ abre: hora, fecha: hora })
/** Só valida a regra de negócio quando todo horário já tem formato válido (senão o erro do campo basta). */
const turnosBemFormados = (turnos: { abre: string; fecha: string }[]) => turnos.every((t) => turno.safeParse(t).success)

export const dadosUnidadeSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da unidade, como "Asa Sul"').max(60, 'Use no máximo 60 caracteres'),
  endereco: opcional(120),
  bairro: opcional(60),
  cidade: opcional(60),
  uf: z.string().trim().toUpperCase().refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'Use a sigla do estado, como DF'),
  cep: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{5}-?\d{3}$/.test(v), 'Use os 8 números do CEP, como 70390-040')
    .transform((v) => v.replace('-', '')),
  telefone: z.string().trim().pipe(z.union([z.literal(''), telefoneBr])),
  apelidos: z.array(z.string().trim().min(1).max(40, 'Cada apelido pode ter até 40 caracteres')).max(10, 'Use no máximo 10 apelidos'),
  mapsUrl: z.string().trim().refine((v) => v === '' || ehLinkGoogleMaps(v), 'Cole um link do Google Maps (no app: Compartilhar → Copiar link)'),
  ativo: z.boolean(),
})
export type DadosUnidadeForm = z.input<typeof dadosUnidadeSchema>

export const horariosSchema = z
  .object({ semanal: z.array(z.array(turno).max(6, 'Use no máximo 6 turnos por dia')).length(7) })
  .superRefine((v, ctx) => {
    if (!v.semanal.every(turnosBemFormados)) return
    const e = validarSemana(v.semanal)
    if (e) ctx.addIssue({ code: 'custom', path: ['semanal', e.dia], message: e.erro })
  })
export type HorariosForm = z.input<typeof horariosSchema>

export const excecaoSchema = z
  .object({
    data: dataBr,
    fechado: z.boolean(),
    turnos: z.array(turno).max(6, 'Use no máximo 6 turnos'),
    motivo: opcional(80),
  })
  .superRefine((v, ctx) => {
    if (v.fechado) return
    if (v.turnos.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['turnos'], message: 'Adicione pelo menos um turno ou marque "Fechado o dia todo".' })
      return
    }
    if (!turnosBemFormados(v.turnos)) return
    const e = validarTurnos(v.turnos)
    if (e) ctx.addIssue({ code: 'custom', path: ['turnos'], message: e })
  })
export type ExcecaoForm = z.input<typeof excecaoSchema>
