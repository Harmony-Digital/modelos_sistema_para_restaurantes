import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PhoneInput, TagInput, TimeInput } from './index'

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
    return <label>Apelidos<TagInput value={v} onChange={setV} placeholder="Ex.: a do lago" /></label>
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
})
