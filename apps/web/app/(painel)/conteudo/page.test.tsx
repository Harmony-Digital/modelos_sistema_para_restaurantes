import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) }))
vi.mock('next/navigation', () => ({ redirect }))
const db = vi.hoisted(() => ({
  carregarUnidadesPainel: vi.fn(), listarCardapio: vi.fn(), listarFatos: vi.fn(), listarLacunas: vi.fn(), listarModelos: vi.fn(),
  listarRespostasRapidas: vi.fn(), podeEditarCardapioGeral: vi.fn(), withUserContext: vi.fn(),
}))
vi.mock('@atd/db', () => db)
const sessao = vi.hoisted(() => ({ role: 'dono' as 'dono' | 'gerente' | 'atendente', claims: { sub: 'u' } }))
vi.mock('@/lib/dal', () => ({ requireStaff: vi.fn(async () => sessao) }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/components/shell/top-bar', () => ({ TopBar: () => null }))
vi.mock('@/components/painel/cardapio', () => ({ Cardapio: () => <p>itens do cardápio</p> }))
vi.mock('@/components/painel/excecoes-item', () => ({ ExcecoesItem: () => <p>por unidade</p> }))
vi.mock('@/components/painel/arquivos-cardapio', () => ({ ArquivosCardapio: () => <p>arquivos</p> }))
vi.mock('@/components/painel/informacoes', () => ({ Informacoes: () => <p>lista de informações</p> }))
vi.mock('@/components/painel/sem-resposta', () => ({
  SemResposta: (p: { lacunas: unknown[] }) => <p>{p.lacunas.length} pendências com Responder</p>,
}))
vi.mock('@/components/painel/modelos', () => ({ Modelos: () => <p>modelos de mensagem</p> }))
vi.mock('@/components/painel/respostas-rapidas', () => ({ RespostasRapidas: () => <p>respostas rápidas</p> }))
const importador = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('./secao-importar', () => ({
  BotaoImportar: (p: { alvo: string }) => <a href={`#importar-${p.alvo}`}>Importar</a>,
  CabecalhoImportar: (p: { titulo: string; fechar: string }) => <a href={p.fechar}>Fechar: {p.titulo}</a>,
  SecaoImportar: (p: Record<string, unknown>) => { importador.props = p; return <p>importador</p> },
}))

const { default: ConteudoPage } = await import('./page')
const { default: RespostasAntiga } = await import('../respostas/page')

const abrir = async (q: Record<string, string>) => render(await ConteudoPage({ searchParams: Promise.resolve(q) }))
let geral = true

beforeEach(() => {
  vi.clearAllMocks()
  importador.props = null
  sessao.role = 'dono'
  geral = true
  db.withUserContext.mockImplementation(async () => geral)
  db.carregarUnidadesPainel.mockResolvedValue({ unidades: [{ id: 'u1', nome: 'Asa Sul', ativo: true }] })
  db.listarCardapio.mockResolvedValue({ categorias: [], itens: [], excecoes: [], arquivos: [] })
  db.listarFatos.mockResolvedValue([])
  db.listarLacunas.mockResolvedValue([{ id: 'l1', chave: 'estacionamento', ultimaVez: new Date('2026-10-05T12:00:00Z') }])
  db.listarModelos.mockResolvedValue([])
  db.listarRespostasRapidas.mockResolvedValue([])
})

const abas = () => within(screen.getByRole('navigation', { name: 'Seções de conteúdo' })).getAllByRole('link')

describe('Conteúdo: três abas', () => {
  it('Cardápio · Informações · Mensagens; sem aba abre o Cardápio', async () => {
    await abrir({})
    expect(abas().map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Cardápio', '/conteudo?aba=cardapio'], ['Informações', '/conteudo?aba=informacoes'], ['Mensagens', '/conteudo?aba=mensagens'],
    ])
    expect(abas()[0]).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('itens do cardápio')).toBeInTheDocument()
    // sub-abas sem "Importar": o importador é um botão da tela
    expect(within(screen.getByRole('navigation', { name: 'Partes do cardápio' })).getAllByRole('link').map((l) => l.textContent))
      .toEqual(['Itens', 'Por unidade', 'Arquivos'])
    expect(screen.getByRole('link', { name: 'Importar' })).toHaveAttribute('href', '#importar-cardapio')
  })

  it('Informações traz "Sem resposta" como pendências e a lista de informações', async () => {
    await abrir({ aba: 'informacoes' })
    const pendencias = screen.getByRole('region', { name: /Sem resposta/ })
    expect(pendencias).toHaveTextContent('1 pendências com Responder')
    expect(screen.getByRole('region', { name: 'Informações cadastradas' })).toHaveTextContent('lista de informações')
    expect(screen.getByRole('link', { name: 'Importar' })).toHaveAttribute('href', '#importar-informacoes')
  })

  it('Informações sem pendências: uma linha, sem o cartão grande', async () => {
    db.listarLacunas.mockResolvedValue([])
    await abrir({ aba: 'informacoes' })
    expect(screen.getByRole('region', { name: /Sem resposta/ })).toHaveTextContent('Nenhuma pergunta sem resposta agora')
  })

  it('Mensagens traz os modelos e as respostas rápidas, sem Importar', async () => {
    await abrir({ aba: 'mensagens' })
    expect(screen.getByText('modelos de mensagem')).toBeInTheDocument()
    expect(screen.getByText('respostas rápidas')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Importar' })).toBeNull()
  })

  it('gerente restrito importa o cardápio, mas não as informações', async () => {
    sessao.role = 'gerente'
    geral = false
    await abrir({ aba: 'cardapio' })
    expect(screen.getByRole('link', { name: 'Importar' })).toBeInTheDocument()
    document.body.innerHTML = ''
    await abrir({ aba: 'informacoes' })
    expect(screen.queryByRole('link', { name: 'Importar' })).toBeNull()
  })

  it('atendente não vê Importar e o importador não abre por endereço', async () => {
    sessao.role = 'atendente'
    await abrir({ aba: 'cardapio', importar: '1' })
    expect(screen.queryByRole('link', { name: 'Importar' })).toBeNull()
    expect(importador.props).toBeNull()
    expect(screen.getByText('itens do cardápio')).toBeInTheDocument()
  })
})

describe('Conteúdo: importador dentro da aba', () => {
  it('Cardápio com importar=1 abre o fluxo atual no alvo cardápio, com Fechar de volta à aba', async () => {
    await abrir({ aba: 'cardapio', importar: '1', imp: 'abc' })
    expect(importador.props).toMatchObject({ alvo: 'cardapio', imp: 'abc', geral: true, unidades: [{ id: 'u1', nome: 'Asa Sul' }] })
    expect(screen.getByRole('link', { name: 'Fechar: Importar cardápio' })).toHaveAttribute('href', '/conteudo?aba=cardapio')
    expect(screen.queryByText('itens do cardápio')).toBeNull()
    expect(abas()[0]).toHaveAttribute('aria-current', 'page')
  })

  it('Informações com importar=1 abre no alvo informações; o gerente restrito recebe geral=false (o importador explica)', async () => {
    sessao.role = 'gerente'
    geral = false
    await abrir({ aba: 'informacoes', importar: '1' })
    expect(importador.props).toMatchObject({ alvo: 'informacoes', geral: false })
    expect(abas()[1]).toHaveAttribute('aria-current', 'page')
  })
})

describe('Conteúdo: endereços antigos', () => {
  it('?aba=importar → Cardápio com o importador aberto; ?aba=sem-resposta → Informações', async () => {
    await expect(abrir({ aba: 'importar' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/conteudo?aba=cardapio&importar=1')
    await expect(abrir({ aba: 'sem-resposta' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/conteudo?aba=informacoes')
    await expect(abrir({ aba: 'cardapio', sub: 'importar' })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/conteudo?aba=cardapio&importar=1')
    expect(db.carregarUnidadesPainel).not.toHaveBeenCalled()
  })

  it('/respostas → Mensagens; com aba antiga passa pelo Conteúdo', async () => {
    await expect(RespostasAntiga({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/conteudo?aba=mensagens')
    await expect(RespostasAntiga({ searchParams: Promise.resolve({ aba: 'sem-resposta' }) })).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenLastCalledWith('/conteudo?aba=sem-resposta')
  })
})
