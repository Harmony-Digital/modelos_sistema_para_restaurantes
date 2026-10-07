import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LogoForm } from './logo-form'

const URL_LOGO = 'https://x.test/storage/v1/object/public/marca/r/logo.png'
const png = (tamanho = 10) => {
  const b = new Uint8Array(tamanho)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new File([b], 'logo.png', { type: 'image/png' })
}

describe('LogoForm', () => {
  it('sem logo: escolher e enviar; manda o arquivo à ação', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<LogoForm nome="Casa Harmonia" logo={null} enviar={enviar} remover={vi.fn()} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remover logo' })).toBeNull()
    const entrada = screen.getByLabelText(/^Imagem da logo/)
    expect(entrada).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    await user.upload(entrada, png())
    await user.click(screen.getByRole('button', { name: 'Enviar logo' }))
    expect(enviar).toHaveBeenCalledTimes(1)
    const fd = enviar.mock.calls[0]![0] as FormData
    expect((fd.get('arquivo') as File).name).toBe('logo.png')
  })

  it('com logo: prévia no quadro de 32 px, trocar e remover', async () => {
    const user = userEvent.setup()
    const remover = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<LogoForm nome="Casa Harmonia" logo={URL_LOGO} enviar={vi.fn()} remover={remover} />)
    const previa = screen.getByRole('img', { name: 'Casa Harmonia' })
    expect(previa).toHaveAttribute('src', URL_LOGO)
    expect(previa.className).toContain('object-contain')
    expect(screen.getByRole('button', { name: 'Trocar logo' })).toBeInTheDocument()
    // pede confirmação antes de tirar a logo de todas as telas
    await user.click(screen.getByRole('button', { name: 'Remover logo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Remover a logo?' })
    expect(remover).not.toHaveBeenCalled()
    await user.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    expect(remover).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remover logo' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Remover a logo?' })).getByRole('button', { name: 'Remover logo' }))
    expect(remover).toHaveBeenCalledTimes(1)
  })

  it('confere no navegador: sem arquivo e acima de 1 MB não chamam a ação', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn()
    render(<LogoForm nome="R" logo={null} enviar={enviar} remover={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Enviar logo' }))
    expect(await screen.findByText('Escolha a imagem da logo.')).toBeInTheDocument()
    await user.upload(screen.getByLabelText(/^Imagem da logo/), png(1024 * 1024 + 1))
    await user.click(screen.getByRole('button', { name: 'Enviar logo' }))
    expect(await screen.findByText('A logo passa de 1 MB. Envie uma imagem menor.')).toBeInTheDocument()
    expect(enviar).not.toHaveBeenCalled()
  })

  it('recusa do servidor aparece no campo (ex.: SVG renomeado) e erro geral como alerta', async () => {
    const user = userEvent.setup()
    const enviar = vi.fn()
      .mockResolvedValueOnce({ ok: false, fieldErrors: { arquivo: 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).' } })
      .mockResolvedValueOnce({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
    render(<LogoForm nome="R" logo={null} enviar={enviar} remover={vi.fn()} />)
    await user.upload(screen.getByLabelText(/^Imagem da logo/), png())
    await user.click(screen.getByRole('button', { name: 'Enviar logo' }))
    expect(await screen.findByText('Envie a logo em PNG, JPG ou WebP (SVG não é aceito).')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar logo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar o arquivo agora. Tente de novo.')
  })
})
