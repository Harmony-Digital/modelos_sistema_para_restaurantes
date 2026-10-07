'use client'
import { useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import type { ModoDemonstracaoForm } from '@/lib/schemas/restaurante'

/** Interruptor do modo demonstração (Mais → Restaurante): o dono muda; o gerente só vê. */
export function ModoDemonstracao(props: {
  ligado: boolean
  acao: (v: ModoDemonstracaoForm) => Promise<ActionResult<null>>
  somenteLeitura?: boolean
}) {
  const [ligado, setLigado] = useState(props.ligado)
  const [salvando, setSalvando] = useState(false)
  const ocupado = useRef(false)
  const id = useId()

  async function alternar(v: boolean) {
    if (ocupado.current) return
    ocupado.current = true
    setSalvando(true)
    setLigado(v)
    try {
      const r = await chamarAcao(() => props.acao({ ligado: v }))
      if (r.ok) toast.success(v ? 'Modo demonstração ligado' : 'Modo demonstração desligado')
      else {
        setLigado(!v)
        toast.error(r.formError ?? 'Não foi possível salvar agora.')
      }
    } finally {
      ocupado.current = false
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="font-medium text-foreground">Modo demonstração</label>
        <Switch id={id} checked={ligado} disabled={props.somenteLeitura || salvando} onCheckedChange={(v) => void alternar(v)} aria-describedby={`${id}-ajuda`} />
      </div>
      <p id={`${id}-ajuda`} className="text-sm text-muted-foreground">
        Ligado: conversas, reservas e pedidos de evento do simulador aparecem no painel como se fossem reais, marcados
        {' '}“Simulação”. Desligue quando começar a atender clientes reais.
        {props.somenteLeitura && ' Só o dono muda.'}
      </p>
    </div>
  )
}
