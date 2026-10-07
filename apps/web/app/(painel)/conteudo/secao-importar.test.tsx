import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))
const db = vi.hoisted(() => ({
  arquivosImportacao: vi.fn(), lerImportacao: vi.fn(), listarCardapio: vi.fn(), listarFatos: vi.fn(), listarImportacoes: vi.fn(),
  revisaoImportacao: vi.fn(),
}))
vi.mock('@atd/db', () => db)
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
const alvo = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/components/painel/importar-alvo', () => ({
  ImportarAlvo: (p: Record<string, unknown>) => { alvo.props = p; return <p>nova importação</p> },
  ArquivosImportacao: (p: { alvo: string }) => <p>arquivos de {p.alvo}</p>,
}))
vi.mock('@/components/painel/importar', () => ({ AcompanharImportacao: (p: { voltar: string }) => <p>lendo; voltar {p.voltar}</p> }))
vi.mock('@/components/painel/revisao-alvos', () => ({ RevisaoEspacos: () => null, RevisaoHorarios: () => null, RevisaoInformacoes: () => null, RevisaoSoPrecos: () => null }))
vi.mock('@/components/painel/revisao-rascunho', () => ({ RevisaoRascunho: () => null }))

const { BotaoImportar, SecaoImportar } = await import('./secao-importar')

const IMP = '11111111-1111-4111-8111-000000000001'
const s = { role: 'dono', claims: { sub: 'u' } } as never
const imp = (over = {}) => ({
  id: IMP, alvo: 'horarios', modo: 'completo', origem: 'arquivo', storagePath: null, recebendo: false, status: 'processando', erro: null,
  criadoEm: new Date('2026-10-07T12:00:00Z'), loteAtual: 0, lotesTotal: 1, draft: null, ...over,
})
const abrir = async (p: { alvo: 'cardapio' | 'informacoes' | 'horarios' | 'espacos'; imp?: string; geral?: boolean }) =>
  render(await SecaoImportar({ imp: p.imp, alvo: p.alvo, geral: p.geral ?? true, s, unidades: [] }))

beforeEach(() => {
  vi.clearAllMocks()
  alvo.props = null
  db.listarImportacoes.mockResolvedValue([])
  db.lerImportacao.mockResolvedValue(null)
})

describe('Importar em cada tela', () => {
  it('o botão abre o fluxo já no alvo da tela', () => {
    render(<><BotaoImportar alvo="cardapio" /><BotaoImportar alvo="horarios" rotulo="Importar horários e espaços" /></>)
    expect(screen.getByRole('link', { name: 'Importar' })).toHaveAttribute('href', '/conteudo?aba=cardapio&importar=1')
    expect(screen.getByRole('link', { name: 'Importar horários e espaços' })).toHaveAttribute('href', '/unidades/importar?alvo=horarios')
  })

  it('sem importação aberta: o fluxo atual (nova importação + histórico) no alvo da tela', async () => {
    await abrir({ alvo: 'informacoes' })
    expect(db.listarImportacoes).toHaveBeenCalledWith('db', { sub: 'u' }, { alvo: 'informacoes' })
    expect(alvo.props).toMatchObject({ alvo: 'informacoes', restrito: false })
    expect(screen.queryByRole('navigation', { name: 'O que importar' })).toBeNull()
  })

  it('Unidades escolhe entre horários e espaços', async () => {
    await abrir({ alvo: 'espacos' })
    const seletor = screen.getByRole('navigation', { name: 'O que importar' })
    expect(within(seletor).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href'), l.getAttribute('aria-current')])).toEqual([
      ['Horários', '/unidades/importar?alvo=horarios', null], ['Espaços', '/unidades/importar?alvo=espacos', 'page'],
    ])
  })

  it('importação de outro alvo (link do Início ou endereço antigo) vai para a tela do alvo dela, com a mesma importação', async () => {
    db.lerImportacao.mockResolvedValue(imp({ alvo: 'horarios' }))
    await expect(abrir({ alvo: 'cardapio', imp: IMP })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith(`/unidades/importar?alvo=horarios&imp=${IMP}`)
  })

  it('importação do alvo da tela abre no estado em que está (Unidades: horários ou espaços)', async () => {
    db.lerImportacao.mockResolvedValue(imp({ alvo: 'espacos' }))
    await abrir({ alvo: 'horarios', imp: IMP })
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByText('lendo; voltar /unidades/importar?alvo=espacos')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'O que importar' })).getByRole('link', { name: 'Espaços' })).toHaveAttribute('aria-current', 'page')
  })

  it('gerente restrito: cardápio como hoje (envia e revisa, sem confirmar); outros alvos explicam quem importa', async () => {
    await abrir({ alvo: 'cardapio', geral: false })
    expect(alvo.props).toMatchObject({ alvo: 'cardapio', restrito: true })
    document.body.innerHTML = ''
    alvo.props = null
    await abrir({ alvo: 'horarios', geral: false })
    expect(alvo.props).toBeNull()
    expect(screen.getByText('Importar os horários é do dono ou de gerente com acesso a todas as unidades.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Importar o cardápio' })).toHaveAttribute('href', '/conteudo?aba=cardapio&importar=1')
  })
})
