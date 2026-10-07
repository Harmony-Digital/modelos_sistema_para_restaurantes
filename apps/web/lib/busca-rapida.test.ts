import { describe, expect, it } from 'vitest'
import { hrefDoResultado, normalizarBusca, telasDaBusca } from './busca-rapida'

describe('busca rápida — telas e destinos', () => {
  it('normaliza sem acento, caixa e espaços', () => {
    expect(normalizarBusca('  Conteúdo  ')).toBe('conteudo')
  })

  it('telas filtradas pelo papel e pelo termo (sem acento); termo vazio lista todas', () => {
    const dono = telasDaBusca('dono', '').map((t) => t.id)
    expect(dono).toEqual(['inicio', 'conversas', 'agenda', 'simulador', 'conteudo', 'unidades', 'gastos', 'equipe', 'privacidade', 'ajustes'])
    expect(telasDaBusca('atendente', '').map((t) => t.id)).toEqual(['inicio', 'conversas', 'agenda', 'conteudo', 'unidades', 'ajustes'])
    expect(telasDaBusca('dono', 'conte').map((t) => t.id)).toEqual(['conteudo'])
    expect(telasDaBusca('dono', 'INÍCIO').map((t) => t.id)).toEqual(['inicio'])
    // grupo também conta: "gestão" acha as telas do grupo que o papel vê
    expect(telasDaBusca('atendente', 'gestao').map((t) => t.id)).toEqual(['ajustes'])
    expect(telasDaBusca('atendente', 'gastos')).toEqual([])
    // "reserva" e "evento" levam à Agenda (onde ficam as reservas e os pedidos de evento)
    expect(telasDaBusca('atendente', 'reserva').map((t) => t.id)).toEqual(['agenda'])
    expect(telasDaBusca('dono', 'Reservas').map((t) => t.id)).toEqual(['agenda'])
    expect(telasDaBusca('dono', 'evento').map((t) => t.id)).toEqual(['agenda'])
  })

  it('cada resultado leva à tela onde ele aparece', () => {
    const base = { titulo: 'x', detalhe: null, simulada: false }
    expect(hrefDoResultado({ ...base, tipo: 'unidade', id: 'u1' })).toBe('/unidades/u1')
    expect(hrefDoResultado({ ...base, tipo: 'item', id: 'i1' })).toBe('/conteudo?aba=cardapio')
    expect(hrefDoResultado({ ...base, tipo: 'informacao', id: 'f1' })).toBe('/conteudo?aba=informacoes')
    expect(hrefDoResultado({ ...base, tipo: 'conversa', id: 'c1' })).toBe('/conversas/c1')
  })
})
