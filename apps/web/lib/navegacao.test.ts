import { describe, expect, it } from 'vitest'
import { gruposDoMenu, itemAtivo, navegacaoInferior, PAPEIS_SIMULADOR } from './navegacao.ts'

const rotulos = (papel: 'dono' | 'gerente' | 'atendente') =>
  gruposDoMenu(papel).map((g) => [g.rotulo, g.itens.map((i) => i.rotulo)])

describe('navegação do painel', () => {
  it('dono vê todos os grupos, na ordem do protótipo', () => {
    expect(rotulos('dono')).toEqual([
      [null, ['Início']],
      ['Atendimento', ['Conversas', 'Agenda', 'Simulador']],
      ['Restaurante', ['Conteúdo', 'Unidades']],
      ['Gestão', ['Gastos', 'Equipe', 'Privacidade', 'Ajustes']],
    ])
  })
  it('gerente (inclusive o restrito a unidades) vê o mesmo menu do dono: as telas limitam o que ele edita', () => {
    expect(rotulos('gerente')).toEqual(rotulos('dono'))
  })
  it('atendente não vê Simulador, Gastos, Equipe nem Privacidade; Ajustes (tema e conta) fica', () => {
    expect(rotulos('atendente')).toEqual([
      [null, ['Início']],
      ['Atendimento', ['Conversas', 'Agenda']],
      ['Restaurante', ['Conteúdo', 'Unidades']],
      ['Gestão', ['Ajustes']],
    ])
  })
  it('rotas novas de Gestão e Ajustes; Simulador é ação, não rota; só Conversas tem contador', () => {
    const itens = gruposDoMenu('dono').flatMap((g) => g.itens)
    const por = (r: string) => itens.find((i) => i.rotulo === r)!
    expect(por('Gastos').href).toBe('/gestao/gastos')
    expect(por('Equipe').href).toBe('/gestao/equipe')
    expect(por('Privacidade').href).toBe('/gestao/privacidade')
    expect(por('Ajustes').href).toBe('/ajustes')
    expect(por('Simulador')).toMatchObject({ acao: 'simulador' })
    expect(por('Simulador').href).toBeUndefined()
    expect(itens.filter((i) => i.contador).map((i) => i.rotulo)).toEqual(['Conversas'])
  })
  it('barra inferior: 4 destinos fixos e o resto na folha Mais, filtrado por papel', () => {
    const dono = navegacaoInferior('dono')
    expect(dono.principais.map((i) => i.rotulo)).toEqual(['Início', 'Conversas', 'Agenda', 'Conteúdo'])
    expect(dono.mais.map((i) => i.rotulo)).toEqual(['Simulador', 'Unidades', 'Gastos', 'Equipe', 'Privacidade', 'Ajustes'])
    expect(navegacaoInferior('atendente').mais.map((i) => i.rotulo)).toEqual(['Unidades', 'Ajustes'])
  })
  it('Simulador no menu segue a mesma regra do lançador montado no layout (constante única)', () => {
    const sim = gruposDoMenu('dono').flatMap((g) => g.itens).find((i) => i.id === 'simulador')!
    expect(sim.papeis).toBe(PAPEIS_SIMULADOR)
    expect(PAPEIS_SIMULADOR).toEqual(['dono', 'gerente'])
  })
  it('item ativo: Início só na raiz; subpáginas contam; prefixo parecido não', () => {
    expect(itemAtivo('/', '/')).toBe(true)
    expect(itemAtivo('/conversas', '/')).toBe(false)
    expect(itemAtivo('/conversas/123', '/conversas')).toBe(true)
    expect(itemAtivo('/conversasX', '/conversas')).toBe(false)
    expect(itemAtivo('/gestao/gastos', '/gestao/gastos')).toBe(true)
    expect(itemAtivo('/gestao/gastos', '/gestao/equipe')).toBe(false)
  })
})
