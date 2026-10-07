import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  acessoInbox: vi.fn(),
  listarInbox: vi.fn(),
  modoDemonstracao: vi.fn(),
  lerConversa: vi.fn(),
  listarRespostasRapidas: vi.fn(),
}))
const useInbox = vi.hoisted(() => vi.fn())
const push = vi.hoisted(() => vi.fn())
vi.mock('@atd/db', () => ({ ...db, schema: { restaurants: { id: 'id', timezone: 'tz' } } }))
vi.mock('@/lib/dal', () => ({
  requireStaff: vi.fn(async () => ({ claims: { sub: 'eu' }, userId: 'eu', role: 'atendente', restaurantId: 'r1' })),
}))
vi.mock('@/lib/server/db', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: async () => [{ timezone: 'America/Sao_Paulo' }] }) }) }),
}))
vi.mock('@/lib/server/midias-conversa', () => ({ midiasDasMensagens: vi.fn(async () => new Map()) }))
vi.mock('@/lib/realtime/use-inbox', () => ({ useInbox }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/conversas',
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
}))
vi.mock('@/app/(painel)/actions', () => ({ setTheme: vi.fn(), signOut: vi.fn() }))
vi.mock('./actions', () => ({
  assumirAction: vi.fn(), devolverAction: vi.fn(), encerrarAction: vi.fn(), mostrarTelefoneConversaAction: vi.fn(),
  reenviarAction: vi.fn(), responderAction: vi.fn(),
}))

import { ColunaConversas } from './coluna-lista'
import ConversaPage from './[id]/page'
import ConversasPage from './page'

const ID = '11111111-1111-4111-8111-111111111111'
const OUTRA = '11111111-1111-4111-8111-000000000002'
const item = (id: string, nome: string) => ({
  id, nome, unidade: 'Asa Sul', trecho: 'oi', estado: 'aguardando_humano' as const, atendente: null, atendenteId: null,
  aguardandoDesde: new Date(), lastMessageAt: new Date(), simulada: true, handoffMotivo: 'pedido' as const,
})
const classes = (el: HTMLElement) => el.className.split(' ')

beforeEach(() => {
  vi.clearAllMocks()
  db.acessoInbox.mockResolvedValue({ restaurantId: 'r1', todas: true, unidades: [{ id: 'u1', nome: 'Asa Sul' }] })
  db.modoDemonstracao.mockResolvedValue(false)
  db.listarInbox.mockResolvedValue({ itens: [item(ID, 'Maria'), item(OUTRA, 'Bia')], proximo: null })
  db.listarRespostasRapidas.mockResolvedValue([])
  db.lerConversa.mockResolvedValue({
    conversa: {
      id: ID, nome: 'Maria', unidade: 'Asa Sul', estado: 'aguardando_humano', atendente: null, atendenteId: null,
      janelaAte: null, simulada: true, handoffMotivo: 'pedido',
    },
    mensagens: [],
  })
})

describe('Conversas: lista + detalhe', () => {
  it('sem conversa aberta: lista visível em todas as larguras; detalhe com "Escolha uma conversa" só a partir de lg', async () => {
    render(<>{await ColunaConversas({ sp: { aba: 'aguardando', sim: '1' } })}{ConversasPage()}</>)
    const lista = screen.getByRole('region', { name: 'Lista de conversas' })
    expect(classes(lista)).toContain('flex')
    expect(classes(lista)).not.toContain('hidden')
    // tempo real (spec §4): a lista mostra o indicador "● AO VIVO"
    expect(within(lista).getByText('Ao vivo')).toHaveAttribute('role', 'status')
    const vazio = screen.getByRole('region', { name: 'Conversa aberta' })
    expect(classes(vazio)).toEqual(expect.arrayContaining(['hidden', 'lg:flex']))
    expect(within(vazio).getByRole('heading', { name: 'Escolha uma conversa' })).toBeInTheDocument()
    // abrir uma conversa leva os filtros da lista
    expect(screen.getByRole('link', { name: /Maria/ })).toHaveAttribute('href', `/conversas/${ID}?aba=aguardando&sim=1`)
  })

  it('com conversa aberta: < lg só o detalhe; ≥ lg a lista ao lado com a aberta marcada e os filtros no próprio item', async () => {
    const sp = { aba: 'aguardando', sim: '1' }
    render(
      <>
        {await ColunaConversas({ sp, abertaId: ID })}
        {await ConversaPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(sp) })}
      </>,
    )
    const lista = screen.getByRole('region', { name: 'Lista de conversas' })
    expect(classes(lista)).toEqual(expect.arrayContaining(['hidden', 'lg:flex']))
    expect(within(lista).getByRole('link', { name: /Maria/ })).toHaveAttribute('aria-current', 'page')
    // abas e filtro continuam na conversa aberta
    expect(within(lista).getByRole('link', { name: 'Com a IA' })).toHaveAttribute('href', `/conversas/${ID}?aba=ia&sim=1`)
    expect(lista.querySelector('form')).toHaveAttribute('action', `/conversas/${ID}`)

    const detalhe = screen.getByRole('region', { name: 'Conversa com Maria' })
    expect(classes(detalhe)).toEqual(expect.arrayContaining(['flex', 'lg:flex']))
    expect(classes(detalhe)).not.toContain('hidden')
    // < lg: voltar; ≥ lg: fechar (Esc) — os dois voltam para a lista com os filtros
    expect(within(detalhe).getByRole('link', { name: 'Voltar para Conversas' })).toHaveAttribute('href', '/conversas?aba=aguardando&sim=1')
    expect(within(detalhe).getByRole('link', { name: 'Fechar conversa' })).toHaveAttribute('href', '/conversas?aba=aguardando&sim=1')
    expect(within(detalhe).getByRole('heading', { level: 2, name: 'Maria' })).toBeInTheDocument()
  })

  it('tempo real com o detalhe aberto: a lista não assina nada (o layout do painel assina a inbox) e o detalhe só a própria conversa', async () => {
    const sp = { aba: 'aguardando' }
    render(
      <>
        {await ColunaConversas({ sp, abertaId: ID })}
        {await ConversaPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(sp) })}
      </>,
    )
    expect(useInbox).toHaveBeenCalledTimes(1)
    expect(useInbox).toHaveBeenCalledWith([`conversa:${ID}`])
  })

  it('conversa fora do acesso: notFound (a lista ao lado continua)', async () => {
    db.lerConversa.mockResolvedValue(null)
    await expect(ConversaPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
