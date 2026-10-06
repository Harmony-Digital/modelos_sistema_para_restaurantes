import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Bolha, type MensagemTelaInbox } from './bolha'

const base: MensagemTelaInbox = {
  id: 1, direcao: 'in', autor: 'cliente', atendente: null, tipo: 'texto', texto: 'Oi', transcrito: false, payload: null,
  statusEnvio: null, createdAt: new Date('2026-10-06T15:00:00Z'),
}
const TZ = 'America/Sao_Paulo'
const m = (extra: Partial<MensagemTelaInbox>): MensagemTelaInbox => ({ ...base, ...extra })

describe('Bolha', () => {
  it('rótulo por autor: cliente, IA, nome do atendente e sistema', () => {
    const { rerender } = render(<Bolha m={base} timezone={TZ} />)
    expect(screen.getByRole('article', { name: 'Cliente às 12:00' })).toHaveTextContent('Oi')
    rerender(<Bolha m={m({ direcao: 'out', autor: 'ia', texto: 'Olá!' })} timezone={TZ} />)
    expect(screen.getByRole('article', { name: 'IA às 12:00' })).toBeInTheDocument()
    rerender(<Bolha m={m({ direcao: 'out', autor: 'humano', atendente: 'Ana', statusEnvio: 'enviado' })} timezone={TZ} />)
    expect(screen.getByRole('article', { name: 'Ana às 12:00' })).toHaveTextContent('Enviada')
    rerender(<Bolha m={m({ direcao: 'out', autor: 'humano', atendente: null })} timezone={TZ} />)
    expect(screen.getByRole('article', { name: 'Equipe às 12:00' })).toBeInTheDocument()
    rerender(<Bolha m={m({ direcao: 'out', autor: 'sistema', texto: 'Vou passar você para a equipe.' })} timezone={TZ} />)
    expect(screen.getByRole('article', { name: 'Sistema às 12:00' })).toBeInTheDocument()
  })

  it('áudio: transcrição com microfone, ou aviso de não transcrito', () => {
    const { rerender } = render(<Bolha m={m({ tipo: 'audio', texto: 'quero reservar', transcrito: true })} timezone={TZ} />)
    expect(screen.getByText('quero reservar').tagName).toBe('EM')
    expect(screen.getByRole('article')).toHaveTextContent('🎤 quero reservar')
    rerender(<Bolha m={m({ tipo: 'audio', texto: null, transcrito: false })} timezone={TZ} />)
    expect(screen.getByRole('article')).toHaveTextContent('🎤 Áudio (não transcrito)')
  })

  it('mídia: documento com link, localização com mapa, lista com as opções', () => {
    const { rerender } = render(
      <Bolha m={m({ direcao: 'out', autor: 'ia', tipo: 'documento', texto: null, midia: { titulo: 'Cardápio', url: 'https://x/c.pdf' } })} timezone={TZ} />,
    )
    expect(screen.getByRole('link', { name: 'Abrir Cardápio' })).toHaveAttribute('href', 'https://x/c.pdf')
    rerender(<Bolha m={m({ direcao: 'out', autor: 'ia', tipo: 'localizacao', texto: null, payload: { lat: -15.8, lng: -47.9, nome: 'Asa Sul', endereco: 'SCLS 404' } })} timezone={TZ} />)
    expect(screen.getByText('SCLS 404')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir no Maps' })).toHaveAttribute('href', 'https://www.google.com/maps?q=-15.8,-47.9')
    rerender(<Bolha m={m({ direcao: 'out', autor: 'ia', tipo: 'lista', texto: 'Qual unidade?', payload: { botao: 'Ver', opcoes: [{ id: 'a', titulo: 'Asa Sul', descricao: '' }] } })} timezone={TZ} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('Asa Sul')
  })

  it('resposta humana que falhou: "Tentar de novo"', async () => {
    const onTentarDeNovo = vi.fn()
    render(<Bolha m={m({ direcao: 'out', autor: 'humano', atendente: 'Ana', statusEnvio: 'falhou:131047' })} timezone={TZ} onTentarDeNovo={onTentarDeNovo} />)
    expect(screen.getByRole('article')).toHaveTextContent('Não enviada')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onTentarDeNovo).toHaveBeenCalledWith(1)
  })

  it('linha antiga do webhook (failed:<código>) também é falha e pode ser reenviada', async () => {
    const onTentarDeNovo = vi.fn()
    render(<Bolha m={m({ direcao: 'out', autor: 'humano', atendente: 'Ana', statusEnvio: 'failed:131026' })} timezone={TZ} onTentarDeNovo={onTentarDeNovo} />)
    expect(screen.getByRole('article')).toHaveTextContent('Não enviada')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onTentarDeNovo).toHaveBeenCalledWith(1)
  })

  it('sem quem possa reenviar: só o estado, sem botão', () => {
    render(<Bolha m={m({ direcao: 'out', autor: 'humano', atendente: 'Ana', statusEnvio: 'falhou:x' })} timezone={TZ} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
