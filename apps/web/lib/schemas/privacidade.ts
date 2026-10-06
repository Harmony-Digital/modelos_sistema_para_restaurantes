import { z } from 'zod'

// cópia das regras de `@atd/db` (painel-privacidade): o formulário roda no navegador e não pode importar o pacote do banco.
// `privacidade.test.ts` confere que as duas continuam iguais.
export const DADOS_RETENCAO_TELA = ['messages', 'attendance_notices', 'event_requests', 'ai_runs', 'customers_inativos', 'audit_log'] as const
export type DadoRetencaoTela = (typeof DADOS_RETENCAO_TELA)[number]
export const minimoDiasRetencao = (dado: DadoRetencaoTela) => (dado === 'messages' ? 7 : 30)
export const MAXIMO_DIAS_RETENCAO = 3650

export const PALAVRA_EXCLUSAO = 'EXCLUIR'
/** Confirmação da exclusão: a pessoa digita EXCLUIR (sem diferenciar maiúsculas; espaços nas pontas não contam). */
export const confirmouExclusao = (texto: string) => texto.trim().toUpperCase() === PALAVRA_EXCLUSAO

export const MAX_RESPOSTA_NEGAR = 300
export const negarSchema = z.object({
  resposta: z.string().trim().min(1, 'Escreva o motivo em poucas palavras').max(MAX_RESPOSTA_NEGAR, `Use no máximo ${MAX_RESPOSTA_NEGAR} caracteres`),
})
export type NegarForm = z.input<typeof negarSchema>

export const retencaoSchema = z
  .object({
    dado: z.enum(DADOS_RETENCAO_TELA),
    dias: z.number({ error: 'Informe o número de dias' }).int('Use um número inteiro de dias'),
  })
  .superRefine((v, ctx) => {
    const min = minimoDiasRetencao(v.dado)
    if (v.dias < min) ctx.addIssue({ code: 'custom', path: ['dias'], message: `O mínimo é ${min} dias.` })
    else if (v.dias > MAXIMO_DIAS_RETENCAO) ctx.addIssue({ code: 'custom', path: ['dias'], message: `O máximo é ${MAXIMO_DIAS_RETENCAO} dias (10 anos).` })
  })
export type RetencaoForm = z.input<typeof retencaoSchema>
