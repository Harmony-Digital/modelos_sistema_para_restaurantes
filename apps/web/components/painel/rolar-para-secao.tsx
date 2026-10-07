'use client'
import { useEffect } from 'react'

/** Links antigos (`?aba=horarios`) e o "Nova unidade" levam direto à seção, agora numa página só com âncoras. */
export function RolarParaSecao({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [id])
  return null
}
