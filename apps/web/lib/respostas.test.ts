import { describe, expect, it } from 'vitest'
import { acaoDaLacuna, sugestoesDeTemas, temaDaChave, tituloDaLacuna } from './respostas'

describe('respostas', () => {
  it('tema e ação a partir da chave da lacuna', () => {
    expect(temaDaChave('info:area kids')).toBe('Area kids')
    expect(temaDaChave('info:geral')).toBe('Geral')
    expect(acaoDaLacuna('info:wifi')).toBe('fato')
    expect(acaoDaLacuna('horario')).toBe('horarios')
    expect(acaoDaLacuna('endereco')).toBe('endereco')
    expect(acaoDaLacuna('unidades')).toBe('unidades')
    expect(tituloDaLacuna('info:wifi')).toBe('Wifi')
    expect(tituloDaLacuna('horario')).toBe('Horário não cadastrado')
    expect(tituloDaLacuna('unidades')).toBe('Nenhuma unidade cadastrada')
  })
  it('sugere temas comuns ainda não cadastrados (sem acento e sem caixa)', () => {
    const s = sugestoesDeTemas([{ tema: 'estacionamento' }, { tema: 'WI-FI' }, { tema: 'Área Kids' }])
    expect(s).not.toContain('Estacionamento')
    expect(s).not.toContain('Wi-Fi')
    expect(s).not.toContain('Área kids')
    expect(s).toContain('Pet friendly')
  })
})
