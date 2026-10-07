import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import SimuladorFlutuante from './simulador-flutuante'

const original = window.matchMedia
/** Largura simulada: ≥ lg sempre (o flutuante só existe aí); `xl` decide se o painel é compacto. */
function largura(xl: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(min-width: 1024px)' || (xl && query === '(min-width: 1280px)'), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
afterEach(() => { window.matchMedia = original })

function Montar() {
  const [minimizado, setMinimizado] = useState(false)
  return (
    <>
      <textarea aria-label="Resposta" />
      <button type="button">Sair</button>
      <SimuladorFlutuante
        minimizado={minimizado}
        onMinimizado={setMinimizado}
        onFechar={() => {}}
        restaurante="Casa Teste"
        mensagens={[]}
        digitando={false}
        onEnviar={() => {}}
        onEscolher={() => {}}
        controles={<div><button type="button">Novo cliente</button></div>}
      />
    </>
  )
}
const painel = () => screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })

describe('SimuladorFlutuante', () => {
  it('fica abaixo da barra, da faixa de alertas e do cabeçalho da coluna e acima da borda de baixo; a área vazia não captura clique, só o painel', () => {
    largura(true)
    render(<Montar />)
    const p = painel()!
    // barra (56 px) + cabeçalho da conversa aberta (~73 px): a pílula não cobre o "Fechar conversa"; com a faixa de
    // alertas, desce a altura dela (--faixa-alertas, posta pelo AppShell) e não cobre o "Ajustar limites"
    expect(p.className).toContain('top-[calc(8.5rem_+_var(--faixa-alertas,0rem))]')
    // < xl (ex.: 1024×768 com o menu aberto) termina acima do compositor de Conversas: o Enviar fica livre
    expect(p.className).toMatch(/(^|\s)bottom-28(\s|$)/)
    expect(p.className).toMatch(/(^|\s)xl:bottom-4(\s|$)/)
    expect(p.className).toContain('pointer-events-none')
    for (const filho of Array.from(p.children).filter((c) => !c.classList.contains('sr-only'))) {
      expect(filho.className).toContain('pointer-events-auto')
    }
  })

  it('o celular cabe na altura disponível (encolhe em telas de 768–864 px) e é mais estreito abaixo de xl', () => {
    largura(true)
    render(<Montar />)
    const celular = painel()!.querySelector('[data-celular]')!
    expect(celular.className).toContain('md:h-[min(760px,calc(100dvh_-_19.5rem_-_var(--faixa-alertas,0rem)))]')
    expect(celular.className).toContain('xl:h-[min(760px,calc(100dvh_-_13.5rem_-_var(--faixa-alertas,0rem)))]')
    expect(celular.className).toContain('md:w-[320px]')
    expect(celular.className).toContain('xl:w-[360px]')
  })

  it('o celular é o bloco de contenção das folhas fixas do chat (lista "Ver unidades" presa ao celular, não à janela)', () => {
    largura(true)
    render(<Montar />)
    const celular = painel()!.querySelector('[data-celular]')!
    // `transform` cria o bloco de contenção de `position: fixed` (a folha da lista usa fixed inset-x-0 bottom-0)
    expect(celular.className).toContain('[transform:translateZ(0)]')
  })

  it('≥ xl: controles sempre ao lado do celular, sem botão para recolher', () => {
    largura(true)
    render(<Montar />)
    const controles = painel()!.querySelector('[data-controles]')!
    expect(controles.className).toContain('xl:block')
    expect(controles.className).toContain('xl:right-full')
    expect(screen.getByRole('button', { name: 'Controles da simulação' }).className).toContain('xl:hidden')
  })

  it('< xl: controles recolhidos atrás de um botão, abrem sobre o celular', async () => {
    largura(false)
    const user = userEvent.setup()
    render(<Montar />)
    const controles = painel()!.querySelector('[data-controles]')!
    const botao = screen.getByRole('button', { name: 'Controles da simulação' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(controles.className).toMatch(/(^|\s)hidden(\s|$)/)
    await user.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')
    expect(controles.className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(within(controles as HTMLElement).getByRole('button', { name: 'Novo cliente' })).toBeInTheDocument()
  })

  it('< xl: clicar fora (ex.: o compositor da conversa) minimiza sem roubar o foco', async () => {
    largura(false)
    const user = userEvent.setup()
    render(<Montar />)
    await user.click(screen.getByRole('button', { name: 'Controles da simulação' })) // dentro: continua aberto
    expect(painel()).not.toBeNull()
    await user.click(screen.getByRole('textbox', { name: 'Resposta' }))
    expect(painel()).toBeNull()
    expect(screen.getByRole('button', { name: 'Restaurar simulador' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Resposta' })).toHaveFocus())
  })

  it('≥ xl: clicar fora não minimiza (há espaço para o painel e a tela)', async () => {
    largura(true)
    const user = userEvent.setup()
    render(<Montar />)
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(painel()).not.toBeNull()
  })

  it('minimizado vira uma coluna estreita só de ícones no canto (não cobre o Enviar do compositor)', async () => {
    largura(true)
    const user = userEvent.setup()
    render(<Montar />)
    await user.click(screen.getByRole('button', { name: 'Minimizar simulador' }))
    const pilula = screen.getByRole('group', { name: 'Simulador minimizado' })
    expect(pilula.className).toContain('flex-col')
    expect(pilula.className).toMatch(/\bright-6\b/)
    expect(within(pilula).getByText('Simulador').className).toContain('sr-only')
  })
})
