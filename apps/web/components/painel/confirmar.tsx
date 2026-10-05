'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Confirmar(props: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao: string
  rotuloConfirmar: string
  onConfirmar: () => Promise<void> | void
}) {
  const [executando, setExecutando] = useState(false)
  const confirmar = async () => {
    setExecutando(true)
    try {
      await props.onConfirmar()
    } finally {
      setExecutando(false)
    }
  }
  return (
    <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.titulo}</DialogTitle>
          <DialogDescription>{props.descricao}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => props.onAbertoChange(false)}>Cancelar</Button>
          <Button variant="destructive" aria-busy={executando || undefined} disabled={executando} onClick={confirmar}>
            {executando ? 'Apagando…' : props.rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
