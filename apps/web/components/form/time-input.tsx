'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskHora } from './masks'

export const TimeInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TimeInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskHora} maxLength={5} placeholder="Ex.: 11:30" autoComplete="off" {...props} />
})
