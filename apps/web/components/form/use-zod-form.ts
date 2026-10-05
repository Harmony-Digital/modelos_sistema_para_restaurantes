'use client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type FieldValues, type Resolver, type UseFormProps } from 'react-hook-form'
import type { z } from 'zod'

export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  opts: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'> = {},
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema) as unknown as Resolver<z.input<S>, unknown, z.output<S>>,
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    ...opts,
  })
}
