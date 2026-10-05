'use client'
import { forwardRef } from 'react'
import { TextInput } from './text-input'

type Props = React.InputHTMLAttributes<HTMLInputElement> & { mask: (v: string) => string }

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9'

export const MaskedInput = forwardRef<HTMLInputElement, Props>(function MaskedInput({ mask, onChange, ...props }, ref) {
  return (
    <TextInput
      ref={ref}
      inputMode="numeric"
      {...props}
      onChange={(e) => {
        const el = e.target
        const caret = el.selectionStart ?? el.value.length
        const atEnd = caret >= el.value.length
        const digitsLeft = [...el.value.slice(0, caret)].filter(isDigit).length
        const masked = mask(el.value)
        el.value = masked
        let pos = 0
        if (atEnd) pos = masked.length
        else {
          for (let seen = 0; pos < masked.length && seen < digitsLeft; pos++) if (isDigit(masked[pos])) seen++
        }
        el.setSelectionRange(pos, pos)
        onChange?.(e)
      }}
    />
  )
})
