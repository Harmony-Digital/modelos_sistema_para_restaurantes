import { describe, expect, it } from 'vitest'
import { valoresDadosUnidade } from './unidade-form'

describe('valoresDadosUnidade', () => {
  it('nulos viram vazio; telefone e CEP formatados', () => {
    const u = {
      id: 'x', nome: 'Asa Sul', slug: 'asa-sul', ativo: true, ordem: 1, apelidos: ['204 sul'],
      endereco: 'SCLS 404', bairro: null, cidade: 'Brasília', uf: 'DF', cep: '70390040', telefone: '6133334444',
      lat: -15.8, lng: -47.9, mapsUrl: null, capacidadePessoas: null as number | null, semanal: [[], [], [], [], [], [], []], excecoes: {},
    }
    expect(valoresDadosUnidade(u)).toEqual({
      nome: 'Asa Sul', endereco: 'SCLS 404', bairro: '', cidade: 'Brasília', uf: 'DF', cep: '70390-040',
      telefone: '(61) 3333-4444', apelidos: ['204 sul'], mapsUrl: '', ativo: true, capacidadePessoas: '',
    })
    expect(valoresDadosUnidade({ ...u, capacidadePessoas: 150 }).capacidadePessoas).toBe('150')
  })
})
