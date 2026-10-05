'use client'
import { forwardRef } from 'react'
import { TextInput } from './text-input'

type Props = React.InputHTMLAttributes<HTMLInputElement> & { mask: (v: string) => string }

export const MaskedInput = forwardRef<HTMLInputElement, Props>(function MaskedInput({ mask, onChange, ...props }, ref) {
  return (
    <TextInput
      ref={ref}
      inputMode="numeric"
      {...props}
      onChange={(e) => {
        e.target.value = mask(e.target.value)
        onChange?.(e)
      }}
    />
  )
})
