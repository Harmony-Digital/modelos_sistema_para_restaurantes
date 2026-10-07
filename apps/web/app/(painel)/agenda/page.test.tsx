import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))
const db = vi.hoisted(() => ({ previsaoDoDia: vi.fn(), listarPedidos: vi.fn(), membrosDaEquipe: vi.fn(), contarPedidosNovos: vi.fn() }))
vi.mock('@atd/db', () => db)
const sessao = vi.hoisted(() => ({ role: 'gerente', claims: { sub: 'u' } }))
vi.mock('@/lib/dal', () => ({ requireStaff: vi.fn(async () => sessao) }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
const agendaProps = vi.hoisted(() => ({ atual: null as Record<string, unknown> | null }))
vi.mock('@/components/painel/agenda-dia', () => ({ AgendaDia: (p: Record<string, unknown>) => { agendaProps.atual = p; return null } }))
vi.mock('@/components/shell/top-bar', () => ({ TopBar: () => null }))

const { default: AgendaPage } = await import('./page')
const { default: PrevisaoRedireciona } = await import('../previsao/page')
const { render } = await import('@testing-library/react')

const U1 = '00000000-0000-4000-8000-000000000001'
const unidades = [{ unitId: U1, unidade: 'Asa Sul', totalPessoas: 0, avisos: [] }]
const abrir = async (q: Record<string, string>) => render(await AgendaPage({ searchParams: Promise.resolve(q) }))

beforeEach(() => {
  vi.clearAllMocks()
  agendaProps.atual = null
  sessao.role = 'gerente'
  db.previsaoDoDia.mockResolvedValue(unidades)
  db.listarPedidos.mockResolvedValue([{ id: 'p1' }])
  db.membrosDaEquipe.mockResolvedValue([])
  db.contarPedidosNovos.mockResolvedValue(2)
})

describe('Agenda: página', () => {
  it('junta avisos do dia e pedidos de evento (todos os status: a tela separa) da unidade escolhida, com o contador de novos', async () => {
    await abrir({ dia: '2026-12-20', unidade: U1, pedido: 'p1' })
    expect(db.previsaoDoDia).toHaveBeenCalledWith('db', sessao.claims, { data: '2026-12-20', incluirCancelados: false })
    expect(db.listarPedidos).toHaveBeenCalledWith('db', sessao.claims, { status: ['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'], unitId: U1 })
    expect(agendaProps.atual).toMatchObject({
      dia: '2026-12-20', unidade: U1, pedidoId: 'p1', cancelados: false, podeEditar: true, unidades, pedidos: [{ id: 'p1' }],
      ver: 'dia', status: ['novo', 'em_contato'], novos: 2,
    })
  })

  it('?ver=pedidos&status=…: a lista de todos os pedidos com o filtro de status da URL', async () => {
    await abrir({ ver: 'pedidos', status: 'confirmado,lixo' })
    expect(agendaProps.atual).toMatchObject({ ver: 'pedidos', status: ['confirmado'] })
  })

  it('unidade fora do alcance vira "todas"; cancelados busca todos os status; atendente não edita avisos', async () => {
    sessao.role = 'atendente'
    await abrir({ unidade: '00000000-0000-4000-8000-0000000000ff', cancelados: '1' })
    expect(db.previsaoDoDia).toHaveBeenCalledWith('db', sessao.claims, expect.objectContaining({ incluirCancelados: true }))
    expect(db.listarPedidos).toHaveBeenCalledWith('db', sessao.claims, { status: ['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'], unitId: null })
    expect(agendaProps.atual).toMatchObject({ unidade: null, cancelados: true, podeEditar: false, pedidoId: null })
  })

  it('endereço antigo (?aba=…, ?data=) redireciona para o novo preservando dia e unidade', async () => {
    await expect(abrir({ aba: 'previsao', data: '2026-10-06', unidade: U1 })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(`/agenda?dia=2026-10-06&unidade=${U1}`)
    await expect(abrir({ aba: 'eventos', status: 'novo' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/agenda?ver=pedidos&status=novo')
    expect(db.previsaoDoDia).not.toHaveBeenCalled()
  })

  it('/previsao redireciona para a Agenda com dia, unidade e cancelados', async () => {
    await expect(PrevisaoRedireciona({ searchParams: Promise.resolve({ data: '2026-10-06', unidade: U1, cancelados: '1' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(`/agenda?dia=2026-10-06&unidade=${U1}&cancelados=1`)
    await expect(PrevisaoRedireciona({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/agenda')
  })
})
