import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { actionErrorFromZod } from '@/lib/action-result'
import { email, texto } from '@/lib/validation'
import { applyServerErrors, ErrorSummary, Field, FormError, PasswordInput, SubmitButton, TextInput, useErrorSummary, useZodForm } from './index'

const schema = z.object({ nome: texto(2, 80, 'Nome da unidade'), contato: email })
const LABELS = { nome: 'Nome da unidade', contato: 'E-mail de contato' }

function Exemplo({ servidor }: { servidor?: { fieldErrors?: Record<string, string>; formError?: string } }) {
  const form = useZodForm(schema, { defaultValues: { nome: '', contato: '' } })
  const summary = useErrorSummary(form, LABELS)
  const { errors } = form.formState
  return (
    <form noValidate onSubmit={form.handleSubmit(() => { if (servidor) applyServerErrors(form, { ok: false, ...servidor }) })}>
      <FormError form={form} />
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
    expect(document.getElementById('nome-erro')).toHaveTextContent('Informe Nome da unidade')
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

  it('erro de campo desconhecido vai para o erro do formulário e o campo conhecido recebe foco', async () => {
    const user = userEvent.setup()
    render(<Exemplo servidor={{ fieldErrors: { fantasma: 'Valor recusado', contato: 'Este e-mail já está em uso' } }} />)
    await user.type(screen.getByLabelText(/Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/E-mail de contato/), 'a@b.com.br')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByLabelText(/E-mail de contato/)).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('Valor recusado')
  })

  it('formError aparece no FormError', async () => {
    const user = userEvent.setup()
    render(<Exemplo servidor={{ formError: 'Não foi possível salvar agora' }} />)
    await user.type(screen.getByLabelText(/Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/E-mail de contato/), 'a@b.com.br')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível salvar agora')
  })

  it('PasswordInput com register envia o valor e recebe foco no erro', async () => {
    const user = userEvent.setup()
    const enviados: unknown[] = []
    const sch = z.object({ senha: z.string().min(3, 'Senha curta') })
    function Senha() {
      const form = useZodForm(sch, { defaultValues: { senha: '' } })
      return (
        <form noValidate onSubmit={form.handleSubmit((v) => { enviados.push(v) })}>
          <Field id="senha" label="Senha" error={form.formState.errors.senha?.message}>
            {(a) => <PasswordInput {...a} {...form.register('senha')} />}
          </Field>
          <SubmitButton>Enviar</SubmitButton>
        </form>
      )
    }
    render(<Senha />)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.getByLabelText('Senha', { exact: true })).toHaveFocus()
    await user.type(screen.getByLabelText('Senha', { exact: true }), 'abcd')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviados).toEqual([{ senha: 'abcd' }])
  })

  it('SubmitButton pendente mantém o foco e não envia de novo', async () => {
    const user = userEvent.setup()
    let envios = 0
    render(
      <form onSubmit={(e) => { e.preventDefault(); envios++ }}>
        <SubmitButton pending>Salvar</SubmitButton>
      </form>,
    )
    const botao = screen.getByRole('button', { name: /Salvando/ })
    botao.focus()
    await user.click(botao)
    expect(envios).toBe(0)
    expect(botao).toHaveFocus()
    expect(botao).toHaveAttribute('aria-disabled', 'true')
  })

  it('actionErrorFromZod separa campo e erro do objeto', () => {
    const sch = z.object({ a: z.string(), b: z.string() }).refine((v) => v.a === v.b, 'Os campos precisam ser iguais')
    const r = sch.safeParse({ a: 'x', b: 'y' })
    expect(actionErrorFromZod(r.error!)).toEqual({ ok: false, fieldErrors: {}, formError: 'Os campos precisam ser iguais' })
    const r2 = z.object({ a: z.string().min(2, 'curto') }).safeParse({ a: '' })
    expect(actionErrorFromZod(r2.error!)).toEqual({ ok: false, fieldErrors: { a: 'curto' } })
  })
})
