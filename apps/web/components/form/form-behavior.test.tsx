import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { email, texto } from '@/lib/validation'
import { applyServerErrors, ErrorSummary, Field, SubmitButton, TextInput, useErrorSummary, useZodForm } from './index'

const schema = z.object({ nome: texto(2, 80, 'Nome da unidade'), contato: email })
const LABELS = { nome: 'Nome da unidade', contato: 'E-mail de contato' }

function Exemplo({ servidor }: { servidor?: { fieldErrors?: Record<string, string>; formError?: string } }) {
  const form = useZodForm(schema, { defaultValues: { nome: '', contato: '' } })
  const summary = useErrorSummary(form, LABELS)
  const { errors } = form.formState
  return (
    <form noValidate onSubmit={form.handleSubmit(() => { if (servidor) applyServerErrors(form, { ok: false, ...servidor }) })}>
      <ErrorSummary errors={summary} />
      <Field id="nome" label={LABELS.nome} hint="Como o cliente chama a unidade" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('nome')} />}
      </Field>
      <Field id="contato" label={LABELS.contato} error={errors.contato?.message} required>
        {(a) => <TextInput {...a} type="email" placeholder="Ex.: gerente@restaurante.com.br" {...form.register('contato')} />}
      </Field>
      <SubmitButton>Salvar</SubmitButton>
    </form>
  )
}

describe('comportamento dos formulários', () => {
  it('rótulo, ajuda e erro ligados ao campo (acessibilidade)', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    const nome = screen.getByLabelText(/Nome da unidade/)
    expect(nome).toHaveAttribute('aria-required', 'true')
    expect(nome).toHaveAccessibleDescription(/Como o cliente chama a unidade/)
    await user.click(nome)
    await user.tab() // sai do campo vazio
    expect(nome).toHaveAttribute('aria-invalid', 'true')
    expect(nome).toHaveAccessibleDescription(/Informe Nome da unidade/)
    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent('Informe Nome da unidade')
  })

  it('depois do primeiro erro, valida a cada tecla e o erro some ao corrigir', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    const nome = screen.getByLabelText(/Nome da unidade/)
    await user.click(nome)
    await user.tab()
    expect(nome).toHaveAttribute('aria-invalid', 'true')
    await user.type(nome, 'As')
    expect(nome).toHaveAttribute('aria-invalid', 'false')
  })

  it('envio inválido: resumo com links e foco no primeiro campo errado', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    const resumo = screen.getByRole('region', { name: /Corrija 2 campos/ })
    expect(within(resumo).getByRole('link', { name: /Nome da unidade/ })).toHaveAttribute('href', '#nome')
    expect(within(resumo).getByRole('link', { name: /E-mail de contato/ })).toHaveAttribute('href', '#contato')
    expect(screen.getByLabelText(/Nome da unidade/)).toHaveFocus()
  })

  it('erro do servidor aparece no campo certo e recebe foco', async () => {
    const user = userEvent.setup()
    render(<Exemplo servidor={{ fieldErrors: { contato: 'Este e-mail já está em uso' } }} />)
    await user.type(screen.getByLabelText(/Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/E-mail de contato/), 'a@b.com.br')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    const contato = screen.getByLabelText(/E-mail de contato/)
    expect(contato).toHaveAttribute('aria-invalid', 'true')
    expect(contato).toHaveAccessibleDescription(/Este e-mail já está em uso/)
    expect(contato).toHaveFocus()
  })
})
