import { describe, expect, it } from 'vitest'
import { fatoSchema, modeloSchema } from './respostas'
import { restauranteSchema } from './restaurante'
import { dadosUnidadeSchema, excecaoSchema, horariosSchema } from './unidades'

const unidade = { nome: 'Asa Sul', endereco: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true }
const msgs = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))

describe('schemas do painel', () => {
  it('unidade: mensagens exatas e normalização', () => {
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, nome: ' ' }))).toEqual({ nome: 'Informe o nome da unidade, como "Asa Sul"' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, uf: 'Distrito' }))).toEqual({ uf: 'Use a sigla do estado, como DF' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, cep: '7039' }))).toEqual({ cep: 'Use os 8 números do CEP, como 70390-040' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, mapsUrl: 'https://evil.com/maps' }))).toEqual({
      mapsUrl: 'Cole um link do Google Maps (no app: Compartilhar → Copiar link)',
    })
    const ok = dadosUnidadeSchema.parse({ ...unidade, uf: 'df', cep: '70390-040', telefone: '(61) 3333-4444' })
    expect(ok).toMatchObject({ uf: 'DF', cep: '70390040', telefone: '6133334444' })
  })

  it('horários: erro no dia certo; madrugada invadindo o dia seguinte', () => {
    const semanal = [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][]
    semanal[2] = [{ abre: '11:00', fecha: '11:00' }]
    expect(msgs(horariosSchema.safeParse({ semanal }))).toEqual({ 'semanal.2': 'Turno 1: a abertura e o fechamento não podem ser iguais.' })
    semanal[2] = [{ abre: '25:00', fecha: '11:00' }]
    expect(msgs(horariosSchema.safeParse({ semanal }))).toEqual({ 'semanal.2.0.abre': 'Use o formato 24h HH:mm, como 11:30' })
  })

  it('exceção: data dd/mm/aaaa vira ISO; aberta sem turno pede turno', () => {
    expect(excecaoSchema.parse({ data: '25/12/2026', fechado: true, turnos: [], motivo: 'Natal' }).data).toBe('2026-12-25')
    expect(msgs(excecaoSchema.safeParse({ data: '24/12/2026', fechado: false, turnos: [], motivo: '' }))).toEqual({
      turnos: 'Adicione pelo menos um turno ou marque "Fechado o dia todo".',
    })
  })

  it('restaurante, informação e modelo', () => {
    expect(msgs(restauranteSchema.safeParse({ nome: 'Casa', politicaFeriado: 'normal', politicaUrl: 'http://x' }))).toEqual({
      politicaUrl: 'Use um link completo que comece com https://',
    })
    expect(msgs(fatoSchema.safeParse({ tema: '', exemplos: [], texto: '', unitId: '', ativo: true }))).toEqual({
      tema: 'Informe o assunto, como "Estacionamento"',
      texto: 'Escreva a resposta que a IA deve enviar',
    })
    expect(msgs(modeloSchema('horario_dia').safeParse({ texto: '{quando}, abrimos.' }))).toEqual({
      texto: 'Inclua {turnos} no texto: é ali que entra a informação.',
    })
  })
})
