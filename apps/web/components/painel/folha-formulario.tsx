'use client'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

function useDesktop() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)')
    const atualizar = () => setDesktop(m.matches)
    atualizar()
    m.addEventListener('change', atualizar)
    return () => m.removeEventListener('change', atualizar)
  }, [])
  return desktop
}

/** Formulário em bottom sheet no celular e em diálogo no desktop (spec §4). */
export function FolhaFormulario(props: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao?: string
  children: React.ReactNode
}) {
  const desktop = useDesktop()
  if (desktop) {
    return (
      <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{props.titulo}</DialogTitle>
            {props.descricao && <DialogDescription>{props.descricao}</DialogDescription>}
          </DialogHeader>
          {props.children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={props.aberto} onOpenChange={props.onAbertoChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[22px] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0">
          <SheetTitle>{props.titulo}</SheetTitle>
          {props.descricao && <SheetDescription>{props.descricao}</SheetDescription>}
        </SheetHeader>
        {props.children}
      </SheetContent>
    </Sheet>
  )
}
