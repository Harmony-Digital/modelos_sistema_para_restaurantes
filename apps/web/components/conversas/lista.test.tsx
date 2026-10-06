import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ListaConversas, type ItemLista } from './lista'

const agora = new Date('2026-10-06T12:00:00Z')
const item = (extra: Partial<ItemLista>): ItemLista => ({
  id: '11111111-1111-4111-8111-111111111111', nome: 'Maria', unidade: 'Asa Sul', trecho: 'Quero falar com alguém',
  estado: 'aguardando_humano', atendente: null, atendenteId: null, aguardandoDesde: new Date('2026-10-06T11:50:00Z'),
  lastMessageAt: new Date('2026-10-06T11:55:00Z'), simulada: false, handoffMotivo: 'pedido', ...extra,
})

describe('ListaConversas', () => {
  it('estado vazio que ensina', () => {
    render(<ListaConversas itens={[]} aba="aguardando" meuId="eu" agora={agora} />)
    expect(screen.getByText('Nenhuma conversa aguardando. Quando a IA passar alguém para a equipe, aparece aqui.')).toBeInTheDocument()
  })

  it('item: nome, unidade, trecho, há quanto espera, motivo e link para a conversa', () => {
    render(<ListaConversas itens={[item({})]} aba="aguardando" meuId="eu" agora={agora} />)
    const link = screen.getByRole('link', { name: /Maria/ })
    expect(link).toHaveAttribute('href', '/conversas/11111111-1111-4111-8111-111111111111')
    expect(link).toHaveTextContent('Asa Sul')
    expect(link).toHaveTextContent('Quero falar com alguém')
    expect(link).toHaveTextContent('há 10 minutos')
    expect(link).toHaveTextContent('Pediu atendente')
  })

  it('cliente sem nome, conversa sem unidade e simulação com selo', () => {
    render(<ListaConversas itens={[item({ nome: null, unidade: null, simulada: true })]} aba="aguardando" meuId="eu" agora={agora} />)
    const link = screen.getByRole('link')
    expect(link).toHaveTextContent('Cliente sem nome')
    expect(link).toHaveTextContent('Unidade não definida')
    expect(link).toHaveTextContent('Simulação')
  })

  it('Em atendimento: quem atende, com destaque "Você" para as minhas', () => {
    render(
      <ListaConversas
        itens={[
          item({ id: '11111111-1111-4111-8111-000000000001', nome: 'Minha', estado: 'humano', atendente: 'Ana', atendenteId: 'eu' }),
          item({ id: '11111111-1111-4111-8111-000000000002', nome: 'Da Bia', estado: 'humano', atendente: 'Bia', atendenteId: 'bia' }),
        ]}
        aba="em_atendimento"
        meuId="eu"
        agora={agora}
      />,
    )
    const [minha, outra] = screen.getAllByRole('listitem')
    expect(within(minha!).getByText('Você')).toBeInTheDocument()
    expect(outra).toHaveTextContent('Com Bia')
    expect(within(outra!).queryByText('Você')).toBeNull()
  })
})
