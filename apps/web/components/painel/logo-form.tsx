'use client'
import { Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, SubmitButton } from '@/components/form'
import { LogoRestaurante } from '@/components/shell/logo-restaurante'
import { Button } from '@/components/ui/button'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { ACEITA_LOGO, ERRO_TAMANHO_LOGO, LIMITE_LOGO_BYTES } from '@/lib/logo'

type Erros = { arquivo?: string; geral?: string }

/**
 * Logo do restaurante em Ajustes (só dono e gerente chegam a ver): prévia no quadro de 32 px usado no menu, enviar,
 * trocar e remover. Tipo e tamanho são conferidos de novo no servidor pelos bytes.
 */
export function LogoForm(props: {
  nome: string
  logo: string | null
  enviar: (fd: FormData) => Promise<ActionResult<null>>
  remover: () => Promise<ActionResult<null>>
}) {
  const [erros, setErros] = useState<Erros>({})
  const [ocupado, setOcupado] = useState<'enviando' | 'removendo' | null>(null)
  const emAndamento = useRef(false)
  const entrada = useRef<HTMLInputElement>(null)

  const executar = async (tipo: 'enviando' | 'removendo', acao: () => Promise<ActionResult<null>>, sucesso: string) => {
    emAndamento.current = true
    setOcupado(tipo)
    setErros({})
    try {
      const r = await chamarAcao(acao)
      if (!r.ok) return setErros({ ...r.fieldErrors, ...(r.formError ? { geral: r.formError } : {}) })
      toast.success(sucesso)
      if (entrada.current) entrada.current.value = ''
    } finally {
      emAndamento.current = false
      setOcupado(null)
    }
  }

  const enviar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (emAndamento.current) return
    const arquivo = entrada.current?.files?.[0]
    if (!arquivo) return setErros({ arquivo: 'Escolha a imagem da logo.' })
    if (arquivo.size > LIMITE_LOGO_BYTES) return setErros({ arquivo: ERRO_TAMANHO_LOGO })
    const fd = new FormData()
    fd.set('arquivo', arquivo)
    await executar('enviando', () => props.enviar(fd), props.logo ? 'Logo trocada' : 'Logo enviada')
  }

  const remover = async () => {
    if (emAndamento.current) return
    await executar('removendo', props.remover, 'Logo removida')
  }

  return (
    <form noValidate onSubmit={enviar} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium text-foreground">Logo</h3>
        {props.logo && <LogoRestaurante url={props.logo} nome={props.nome} />}
      </div>
      {erros.geral && <p role="alert" className="text-sm text-destructive">{erros.geral}</p>}
      <Field id="logo-arquivo" label="Imagem da logo" hint="PNG, JPG ou WebP, até 1 MB. Aparece no menu, no topo do celular e na tela de login." error={erros.arquivo}>
        {(a) => (
          <input
            {...a}
            ref={entrada}
            type="file"
            accept={ACEITA_LOGO}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={ocupado === 'enviando'} pendingText="Enviando…">
          <Upload aria-hidden="true" className="size-4" /> {props.logo ? 'Trocar logo' : 'Enviar logo'}
        </SubmitButton>
        {props.logo && (
          <Button type="button" variant="outline" disabled={ocupado !== null} onClick={remover}>
            <Trash2 aria-hidden="true" className="size-4" /> Remover logo
          </Button>
        )}
      </div>
    </form>
  )
}
