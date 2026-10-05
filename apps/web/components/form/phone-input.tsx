'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskTelefone } from './masks'

export const PhoneInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PhoneInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskTelefone} maxLength={15} inputMode="tel" placeholder="Ex.: (61) 99999-8888" autoComplete="tel-national" {...props} />
})
