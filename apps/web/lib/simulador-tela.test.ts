import { describe, expect, it } from 'vitest'
import {
  avisoDoEstado, horarioLocal, instanteDoHorarioLocal, paraSimMessage, rotuloRelogio, type MensagemTela,
} from './simulador-tela'

const TZ = 'America/Sao_Paulo'
const base = { criadaEm: '2026-10-05T17:01:00.000Z', payload: null } as const

describe('paraSimMessage', () => {
  it('texto do cliente e do restaurante, com hora no fuso do restaurante', () => {
    const cli: MensagemTela = { ...base, id: 1, direcao: 'in', tipo: 'texto', texto: 'abre domingo?' }
    const res: MensagemTela = { ...base, id: 2, direcao: 'out', tipo: 'texto', texto: 'Abrimos às 11h30.' }
    expect(paraSimMessage(cli, TZ, null)).toEqual({ id: '1', de: 'cliente', tipo: 'texto', texto: 'abre domingo?', hora: '14:01', status: 'lida' })
    expect(paraSimMessage(res, TZ, null)).toEqual({ id: '2', de: 'restaurante', tipo: 'texto', texto: 'Abrimos às 11h30.', hora: '14:01' })
  })
  it('hora segue o relógio simulado', () => {
    const m: MensagemTela = { ...base, id: 1, direcao: 'out', tipo: 'texto', texto: 'x' }
    expect(paraSimMessage(m, TZ, 3600)).toMatchObject({ hora: '15:01' })
  })
  it('lista com os mesmos cortes da Meta (título 24, descrição 72, botão 20)', () => {
    const m: MensagemTela = {
      ...base, id: 3, direcao: 'out', tipo: 'lista', texto: 'Qual unidade?',
      payload: { botao: 'Escolher unidade agora!!', opcoes: [{ id: 'u1', titulo: 'Águas Claras Shopping Park', descricao: 'Rua 1' }] },
    }
    expect(paraSimMessage(m, TZ, null)).toEqual({
      id: '3', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Escolher unidade ago', hora: '14:01',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Águas Claras Shopping Pa', descricao: 'Rua 1' }] }],
    })
  })
  it('localização', () => {
    const m: MensagemTela = { ...base, id: 4, direcao: 'out', tipo: 'localizacao', texto: 'Asa Sul: SCLS 404', payload: { lat: -15.8, lng: -47.9, nome: 'Asa Sul', endereco: 'SCLS 404' } }
    expect(paraSimMessage(m, TZ, null)).toEqual({ id: '4', de: 'restaurante', tipo: 'localizacao', nome: 'Asa Sul', endereco: 'SCLS 404', lat: -15.8, lng: -47.9, hora: '14:01' })
  })
  it('payload quebrado vira o texto gravado (nunca some)', () => {
    const m: MensagemTela = { ...base, id: 5, direcao: 'out', tipo: 'lista', texto: 'Qual unidade?', payload: { botao: 1 } }
    expect(paraSimMessage(m, TZ, null)).toMatchObject({ tipo: 'texto', texto: 'Qual unidade?' })
  })
})

describe('avisoDoEstado', () => {
  it('só avisa fora do atendimento da IA', () => {
    expect(avisoDoEstado('ia')).toBeNull()
    expect(avisoDoEstado('aguardando_humano')).toMatchObject({ de: 'sistema', texto: expect.stringContaining('passada para um atendente') })
    expect(avisoDoEstado('humano')).toMatchObject({ texto: expect.stringContaining('passada para um atendente') })
    expect(avisoDoEstado('encerrada')).toMatchObject({ texto: expect.stringContaining('encerrada') })
  })
})

describe('relógio', () => {
  it('converte data e hora do restaurante em instante e volta', () => {
    const d = instanteDoHorarioLocal('2026-10-11T12:00', TZ)
    expect(d?.toISOString()).toBe('2026-10-11T15:00:00.000Z')
    expect(horarioLocal(d!, TZ)).toBe('2026-10-11T12:00')
  })
  it('data inexistente ou formato errado: null', () => {
    expect(instanteDoHorarioLocal('2026-02-30T10:00', TZ)).toBeNull()
    expect(instanteDoHorarioLocal('2026-10-11T24:00', TZ)).toBeNull()
    expect(instanteDoHorarioLocal('11/10/2026 12:00', TZ)).toBeNull()
  })
  it('rótulo do relógio simulado', () => {
    const agora = new Date('2026-10-05T17:00:00Z') // segunda 14h em Brasília
    expect(rotuloRelogio(null, TZ, agora)).toBeNull()
    expect(rotuloRelogio(6 * 86_400 - 2 * 3600, TZ, agora)).toBe('Relógio simulado: domingo, 11/10/2026 12:00')
  })
})
