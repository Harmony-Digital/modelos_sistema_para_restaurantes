'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskData } from './masks'

export const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function DateInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskData} maxLength={10} placeholder="Ex.: 12/10/2026" autoComplete="off" {...props} />
})
