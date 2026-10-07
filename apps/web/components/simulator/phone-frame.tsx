'use client'
import { BatteryFull, SignalHigh, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

function agora() {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date())
}

/**
 * iPhone 17 a partir de md (tamanho externo 393×852 pt, limitado à altura da janela); tela cheia no celular.
 * `className` ajusta o tamanho (ex.: o simulador flutuante, menor, ancorado no canto).
 */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  const [hora, setHora] = useState(agora)
  useEffect(() => { const t = setInterval(() => setHora(agora()), 30_000); return () => clearInterval(t) }, [])
  return (
    <div className={cn('relative min-h-0 w-full flex-1 md:flex-none md:h-[min(852px,calc(100dvh-2rem))] md:w-[393px] md:rounded-[55px] md:border-[12px] md:border-black md:shadow-2xl md:ring-1 md:ring-white/10 overflow-hidden', className)}>
      <div aria-hidden="true" className="hidden md:flex absolute inset-x-0 top-0 z-20 h-12 items-center justify-between px-7 text-[15px] font-semibold text-white">
        <span>{hora}</span>
        <span className="absolute left-1/2 top-2.5 h-[34px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
        <span className="flex items-center gap-1.5"><SignalHigh className="size-4" /><Wifi className="size-4" /><BatteryFull className="size-5" /></span>
      </div>
      <div className="h-full md:pt-12 md:pb-6">{children}</div>
      <span aria-hidden="true" className="hidden md:block absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/80" />
    </div>
  )
}
