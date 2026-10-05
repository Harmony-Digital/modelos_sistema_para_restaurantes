import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { describe, expect, it } from 'vitest'
import { DateInput, Field, PhoneInput, Select, SwitchField, TagInput, TimeInput } from './index'

describe('campos especializados', () => {
  it('hora recebe a máscara ao digitar e abre teclado numérico', async () => {
    const user = userEvent.setup()
    render(<label>Abre<TimeInput /></label>)
    const input = screen.getByLabelText('Abre')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    await user.type(input, '1130')
    expect(input).toHaveValue('11:30')
  })

  it('telefone formata com DDD', async () => {
    const user = userEvent.setup()
    render(<label>Telefone<PhoneInput /></label>)
    await user.type(screen.getByLabelText('Telefone'), '61999998888')
    expect(screen.getByLabelText('Telefone')).toHaveValue('(61) 99999-8888')
  })

  function Tags() {
    const [v, setV] = useState<string[]>(['Asa Sul'])
    return (
      <Field id="apelidos" label="Apelidos">
        {(c) => <TagInput {...c} value={v} onChange={setV} placeholder="Ex.: a do lago" />}
      </Field>
    )
  }

  it('etiquetas: Enter e vírgula adicionam, duplicado é ignorado, Backspace remove', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    const input = screen.getByLabelText('Apelidos')
    await user.type(input, 'lago{Enter}')
    await user.type(input, 'centro,')
    await user.type(input, 'asa sul{Enter}')
    expect(screen.getAllByRole('button', { name: /^Remover/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remover Asa Sul',
      'Remover lago',
      'Remover centro',
    ])
    await user.type(input, '{Backspace}')
    expect(screen.queryByRole('button', { name: 'Remover centro' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remover lago' }))
    expect(screen.getAllByRole('button', { name: /^Remover/ })).toHaveLength(1)
  })

  it('hora, data e telefone aceitam colagem sem truncar antes da máscara', async () => {
    const user = userEvent.setup()
    render(<><label>Tel<PhoneInput /></label><label>Hora<TimeInput /></label><label>Data<DateInput /></label></>)
    const tel = screen.getByLabelText('Tel')
    expect(tel).not.toHaveAttribute('maxlength')
    await user.click(tel)
    await user.paste('(61) 9 9999-8888')
    expect(tel).toHaveValue('(61) 99999-8888')
    await user.clear(tel)
    await user.paste('+55 61 99999-8888')
    expect(tel).toHaveValue('(61) 99999-8888')
    await user.click(screen.getByLabelText('Hora'))
    await user.paste('11h30')
    expect(screen.getByLabelText('Hora')).toHaveValue('11:30')
    await user.click(screen.getByLabelText('Data'))
    await user.paste('12 / 10 / 2026')
    expect(screen.getByLabelText('Data')).toHaveValue('12/10/2026')
  })

  it('o cursor fica logo depois do dígito digitado no meio do valor', async () => {
    const user = userEvent.setup()
    render(<label>Abre<TimeInput defaultValue="11:30" /></label>)
    const input = screen.getByLabelText<HTMLInputElement>('Abre')
    await user.type(input, '2', { initialSelectionStart: 1, initialSelectionEnd: 1 })
    expect(input).toHaveValue('12:13')
    expect(input.selectionStart).toBe(2)
    await user.keyboard('9')
    expect(input).toHaveValue('12:91')
    expect(input.selectionStart).toBe(4)
  })

  it('etiquetas: lista rotulada, vírgula no meio separa, aviso ao vivo e foco volta ao campo', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    const input = screen.getByLabelText('Apelidos')
    expect(screen.getByRole('list', { name: 'Etiquetas' })).toBeInTheDocument()
    await user.click(input)
    await user.paste('a,b')
    expect(screen.getByRole('button', { name: 'Remover a' })).toBeInTheDocument()
    expect(input).toHaveValue('b')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('b adicionada')
    await user.click(screen.getByRole('button', { name: 'Remover a' }))
    expect(screen.getByRole('status')).toHaveTextContent('a removida')
    expect(input).toHaveFocus()
  })

  it('etiquetas: tab segue a ordem visual e sair para um botão da lista não confirma o rascunho', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    const input = screen.getByLabelText('Apelidos')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Remover Asa Sul' })).toHaveFocus()
    await user.tab()
    expect(input).toHaveFocus()
    await user.type(input, 'rascunho')
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Remover Asa Sul' })).toHaveFocus()
    expect(screen.getAllByRole('button', { name: /^Remover/ })).toHaveLength(1)
    await user.tab()
    await user.tab()
    expect(screen.getAllByRole('button', { name: /^Remover/ })).toHaveLength(2)
  })

  it('etiquetas: avisa ao atingir o limite e compõe onBlur do chamador', async () => {
    const user = userEvent.setup()
    let blurred = 0
    function Limited() {
      const [v, setV] = useState<string[]>(['a'])
      return <Field id="x" label="X">{(c) => <TagInput {...c} value={v} onChange={setV} max={1} onBlur={() => { blurred++ }} />}</Field>
    }
    render(<Limited />)
    await user.type(screen.getByLabelText('X'), 'b{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Limite de 1 etiquetas atingido')
    await user.tab()
    expect(blurred).toBe(1)
  })

  it('etiquetas funcionam com Controller do react-hook-form', async () => {
    const user = userEvent.setup()
    let enviado: string[] = []
    function Form() {
      const { control, handleSubmit } = useForm<{ tags: string[] }>({ defaultValues: { tags: [] } })
      return (
        <form onSubmit={handleSubmit((d) => { enviado = d.tags })}>
          <Controller control={control} name="tags" render={({ field }) => (
            <Field id="t" label="Tags">{(c) => <TagInput {...c} ref={field.ref} value={field.value} onChange={field.onChange} />}</Field>
          )} />
          <button type="submit">Enviar</button>
        </form>
      )
    }
    render(<Form />)
    await user.type(screen.getByLabelText('Tags'), 'um,dois{Enter}')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(enviado).toEqual(['um', 'dois'])
  })

  it('select expõe opções e marca erro', async () => {
    const user = userEvent.setup()
    render(
      <Field id="s" label="Dia" error="Escolha um dia">
        {(c) => <Select {...c}><option value="">—</option><option value="seg">Segunda</option></Select>}
      </Field>,
    )
    const sel = screen.getByLabelText('Dia')
    expect(sel).toHaveAttribute('aria-invalid', 'true')
    expect(sel).toHaveAccessibleDescription('Escolha um dia')
    await user.selectOptions(sel, 'seg')
    expect(sel).toHaveValue('seg')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('switch associa rótulo e dica e alterna', async () => {
    const user = userEvent.setup()
    function S() {
      const [on, setOn] = useState(false)
      return <SwitchField id="sw" label="Receber avisos" hint="Enviamos por WhatsApp" checked={on} onCheckedChange={setOn} />
    }
    render(<S />)
    const sw = screen.getByRole('switch', { name: 'Receber avisos' })
    expect(sw).toHaveAccessibleDescription('Enviamos por WhatsApp')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(screen.getByText('Receber avisos'))
    expect(sw).toHaveAttribute('aria-checked', 'true')
  })
})
