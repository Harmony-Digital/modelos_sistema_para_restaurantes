'use client'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { salvarDadosUnidadeAction } from '@/app/(painel)/unidades/actions'
import { Button } from '@/components/ui/button'
import { DadosUnidadeForm, UNIDADE_VAZIA } from './dados-unidade-form'
import { FolhaFormulario } from './folha-formulario'

export function NovaUnidade() {
  const [aberto, setAberto] = useState(false)
  const router = useRouter()
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus aria-hidden="true" className="size-4" /> Nova unidade
      </Button>
      <FolhaFormulario aberto={aberto} onAbertoChange={setAberto} titulo="Nova unidade" descricao="Depois de salvar, cadastre os horários.">
        <DadosUnidadeForm
          idPrefixo="nova-"
          inicial={UNIDADE_VAZIA}
          acao={(v) => salvarDadosUnidadeAction(null, v)}
          onSalvo={(id) => {
            setAberto(false)
            router.push(`/unidades/${id}?aba=horarios`)
          }}
        />
      </FolhaFormulario>
    </>
  )
}
