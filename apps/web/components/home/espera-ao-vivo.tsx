'use client'
import { useEffect, useState } from 'react'
import { Numero } from '@/components/ui/numero'
import { cronometro } from '@/lib/inicio'

/** Espera desde `desde`, em mm:ss, atualizada a cada segundo (servidor e navegador podem diferir em 1 s). */
export function EsperaAoVivo(props: { desde: Date }) {
  const inicio = new Date(props.desde).getTime()
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <time dateTime={new Date(inicio).toISOString()}>
      <Numero suppressHydrationWarning>{cronometro((agora - inicio) / 1000)}</Numero>
    </time>
  )
}
