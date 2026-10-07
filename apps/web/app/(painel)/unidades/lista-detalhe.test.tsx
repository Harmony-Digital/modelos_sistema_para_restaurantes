import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ carregarUnidadesPainel: vi.fn(), listarEspacos: vi.fn(), podeEditarCardapioGeral: vi.fn(), withUserContext: vi.fn() }))
const acesso = vi.hoisted(() => ({ geral: true }))
const sessao = vi.hoisted(() => ({ role: 'dono' as 'dono' | 'gerente' | 'atendente' }))
const dados = vi.hoisted(() => vi.fn())
vi.mock('@atd/db', () => db)
vi.mock('@/lib/dal', () => ({ requireStaff: vi.fn(async () => ({ claims: { sub: 'eu' }, userId: 'eu', role: sessao.role })) }))
vi.mock('@/lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) },
}))
const importador = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('@/app/(painel)/conteudo/secao-importar', () => ({
  BotaoImportar: (p: { alvo: string; rotulo?: string }) => <a href={`#importar-${p.alvo}`}>{p.rotulo ?? 'Importar'}</a>,
  CabecalhoImportar: (p: { titulo: string; fechar: string }) => <a href={p.fechar}>Fechar: {p.titulo}</a>,
  SecaoImportar: (p: Record<string, unknown>) => { importador.props = p; return <p>importador</p> },
}))
vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))
vi.mock('@/app/(painel)/unidades/actions', () => ({ salvarDadosUnidadeAction: vi.fn(), salvarHorariosAction: vi.fn() }))
vi.mock('@/lib/selo-unidade', () => ({ seloDaUnidade: () => ({ tom: 'aberta', texto: 'Aberta agora' }) }))
vi.mock('@/lib/feriados-unidade', () => ({ feriadosComComportamento: () => [], excecoesCadastradas: () => [] }))
vi.mock('@/lib/unidade-form', () => ({ valoresDadosUnidade: () => ({}) }))
vi.mock('@/components/painel/dados-unidade-form', () => ({
  DadosUnidadeForm: (p: { idPrefixo?: string }) => { dados(p); return <p>formulário de dados</p> },
}))
vi.mock('@/components/painel/horarios-form', () => ({ HorariosForm: () => <p>formulário de horários</p> }))
vi.mock('@/components/painel/excecoes-unidade', () => ({ ExcecoesUnidade: () => <p>exceções</p> }))
vi.mock('@/components/painel/espacos', () => ({ Espacos: () => <p>espaços</p> }))
vi.mock('@/components/painel/nova-unidade', () => ({ NovaUnidade: () => <button type="button">Nova unidade</button> }))

import { ColunaUnidades } from './coluna-lista'
import UnidadePage from './[id]/page'
import UnidadesPage from './page'
import ImportarUnidadesPage from './importar/page'

const A = '22222222-2222-4222-8222-000000000001'
const B = '22222222-2222-4222-8222-000000000002'
const unidade = (id: string, nome: string) => ({ id, nome, endereco: 'Rua 1', bairro: null, ativo: true, semanal: {}, excecoes: {} })
const classes = (el: HTMLElement) => el.className.split(' ')

beforeEach(() => {
  vi.clearAllMocks()
  sessao.role = 'dono'
  db.carregarUnidadesPainel.mockResolvedValue({
    restaurante: { politicaFeriado: 'abre', timezone: 'America/Sao_Paulo' },
    unidades: [unidade(A, 'Asa Sul'), unidade(B, 'Lago Sul')],
  })
  db.listarEspacos.mockResolvedValue([])
  acesso.geral = true
  importador.props = null
  db.withUserContext.mockImplementation(async () => acesso.geral)
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Unidades: lista + detalhe', () => {
  it('sem unidade aberta: lista em todas as larguras (com "Nova unidade"); "Escolha uma unidade" só a partir de lg', async () => {
    render(<>{await ColunaUnidades({})}{UnidadesPage()}</>)
    const lista = screen.getByRole('region', { name: 'Lista de unidades' })
    expect(classes(lista)).not.toContain('hidden')
    expect(within(lista).getByRole('link', { name: /Asa Sul/ })).toHaveAttribute('href', `/unidades/${A}`)
    expect(within(lista).getByRole('button', { name: 'Nova unidade' })).toBeInTheDocument()
    const vazio = screen.getByRole('region', { name: 'Unidade aberta' })
    expect(classes(vazio)).toEqual(expect.arrayContaining(['hidden', 'lg:flex']))
    expect(within(vazio).getByRole('heading', { name: 'Escolha uma unidade' })).toBeInTheDocument()
  })

  it('atendente não vê "Nova unidade"', async () => {
    sessao.role = 'atendente'
    render(await ColunaUnidades({}))
    expect(screen.queryByRole('button', { name: 'Nova unidade' })).toBeNull()
  })

  it('com unidade aberta: lista some < lg e marca a aberta; detalhe com as quatro seções numa página e âncoras', async () => {
    render(
      <>
        {await ColunaUnidades({ abertaId: B })}
        {await UnidadePage({ params: Promise.resolve({ id: B }), searchParams: Promise.resolve({}) })}
      </>,
    )
    const lista = screen.getByRole('region', { name: 'Lista de unidades' })
    expect(classes(lista)).toEqual(expect.arrayContaining(['hidden', 'lg:flex']))
    const aberta = within(lista).getByRole('link', { name: /Lago Sul/ })
    expect(aberta).toHaveAttribute('aria-current', 'page')
    // selo "Aberta agora" (tom sucesso) fica AA: cartão + barra laranja, sem tint accent/muted
    expect(aberta.className).toContain('shadow-[inset_3px_0_0_var(--primary)]')
    expect(aberta.className).not.toMatch(/(^|\s)bg-accent/)
    expect(within(lista).getByRole('link', { name: /Asa Sul/ })).not.toHaveAttribute('aria-current')

    const detalhe = screen.getByRole('region', { name: 'Unidade Lago Sul' })
    expect(classes(detalhe)).not.toContain('hidden')
    const secoes = within(detalhe).getByRole('navigation', { name: 'Seções da unidade' })
    expect(within(secoes).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Dados', '#dados'], ['Horários', '#horarios'], ['Exceções', '#excecoes'], ['Espaços', '#espacos'],
    ])
    for (const [id, titulo] of [['dados', 'Dados'], ['horarios', 'Horários'], ['excecoes', 'Exceções'], ['espacos', 'Espaços']] as const) {
      const s = within(detalhe).getByRole('region', { name: titulo })
      expect(s).toHaveAttribute('id', id)
    }
    expect(screen.getByText('formulário de dados')).toBeInTheDocument()
    expect(screen.getByText('formulário de horários')).toBeInTheDocument()
    expect(screen.getByText('exceções')).toBeInTheDocument()
    expect(screen.getByText('espaços')).toBeInTheDocument()
    // a folha "Nova unidade" e a de espaço usam ids como "nome": o formulário da unidade aberta usa ids próprios
    expect(dados).toHaveBeenCalledWith(expect.objectContaining({ idPrefixo: 'unidade-' }))
    expect(within(detalhe).getByRole('link', { name: 'Voltar para unidades' })).toHaveAttribute('href', '/unidades')
    expect(within(detalhe).getByRole('link', { name: 'Fechar unidade' })).toHaveAttribute('href', '/unidades')
  })

  it('link antigo com ?aba=espacos leva à seção de espaços', async () => {
    render(await UnidadePage({ params: Promise.resolve({ id: A }), searchParams: Promise.resolve({ aba: 'espacos' }) }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0]).toBe(document.getElementById('espacos'))
  })

  it('unidade fora do acesso: notFound', async () => {
    await expect(UnidadePage({ params: Promise.resolve({ id: 'x' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('Unidades: Importar (horários e espaços)', () => {
  it('dono vê "Importar" na lista; gerente restrito e atendente não', async () => {
    render(await ColunaUnidades({}))
    expect(screen.getByRole('link', { name: 'Importar horários e espaços' })).toHaveAttribute('href', '#importar-horarios')
    document.body.innerHTML = ''
    sessao.role = 'gerente'
    acesso.geral = false
    render(await ColunaUnidades({}))
    expect(screen.queryByRole('link', { name: /Importar/ })).toBeNull()
    document.body.innerHTML = ''
    sessao.role = 'atendente'
    render(await ColunaUnidades({}))
    expect(screen.queryByRole('link', { name: /Importar/ })).toBeNull()
  })

  it('importador aberto ao lado da lista (a lista some < lg), no alvo pedido e com a importação', async () => {
    const I = '11111111-1111-4111-8111-000000000001'
    render(
      <>
        {await ColunaUnidades({ detalheAberto: true })}
        {await ImportarUnidadesPage({ searchParams: Promise.resolve({ alvo: 'espacos', imp: I }) })}
      </>,
    )
    expect(classes(screen.getByRole('region', { name: 'Lista de unidades' }))).toEqual(expect.arrayContaining(['hidden', 'lg:flex']))
    const detalhe = screen.getByRole('region', { name: 'Importar horários e espaços' })
    expect(classes(detalhe)).not.toContain('hidden')
    expect(importador.props).toMatchObject({ alvo: 'espacos', imp: I, geral: true, unidades: [{ id: A, nome: 'Asa Sul' }, { id: B, nome: 'Lago Sul' }] })
    expect(within(detalhe).getByRole('link', { name: 'Fechar: Importar horários e espaços' })).toHaveAttribute('href', '/unidades')
    expect(within(detalhe).getByRole('link', { name: 'Voltar para unidades' })).toHaveAttribute('href', '/unidades')
  })

  it('alvo desconhecido abre em horários; atendente volta para Unidades', async () => {
    render(await ImportarUnidadesPage({ searchParams: Promise.resolve({ alvo: 'cardapio' }) }))
    expect(importador.props).toMatchObject({ alvo: 'horarios' })
    sessao.role = 'atendente'
    await expect(ImportarUnidadesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT /unidades')
  })
})
