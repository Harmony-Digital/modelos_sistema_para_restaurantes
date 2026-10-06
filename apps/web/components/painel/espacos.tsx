'use client'
import { Pencil, Plus, Store } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { salvarEspacoAction } from '@/app/(painel)/unidades/actions'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shell/empty-state'
import { chamarAcao } from '@/lib/action-result'
import type { EspacoForm as Valores } from '@/lib/schemas/espacos'
import { ESPACO_VAZIO, EspacoForm } from './espaco-form'
import { FolhaFormulario } from './folha-formulario'

export type EspacoTela = {
  id: string
  nome: string
  capacidadeMin: number
  capacidadeMax: number
  descricao: string | null
  condicoes: string | null
  ativo: boolean
}

const valores = (e: EspacoTela, ativo = e.ativo): Valores => ({
  nome: e.nome, capacidadeMin: String(e.capacidadeMin), capacidadeMax: String(e.capacidadeMax),
  descricao: e.descricao ?? '', condicoes: e.condicoes ?? '', ativo,
})

export function Espacos(props: { unitId: string; espacos: EspacoTela[]; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<{ id: string | null; valores: Valores } | null>(null)
  const [trocando, setTrocando] = useState<string | null>(null)
  const ocupado = useRef(false)

  async function alternar(e: EspacoTela, ativo: boolean) {
    if (ocupado.current) return
    ocupado.current = true
    setTrocando(e.id)
    try {
      const r = await chamarAcao(() => salvarEspacoAction(props.unitId, e.id, valores(e, ativo)))
      if (r.ok) toast.success(ativo ? 'Espaço ativado' : 'Espaço desativado')
      else toast.error(r.formError ?? 'Não foi possível salvar agora.')
    } finally {
      ocupado.current = false
      setTrocando(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">Espaços para eventos</h2>
        {!props.somenteLeitura && (
          <Button onClick={() => setEditando({ id: null, valores: ESPACO_VAZIO })}>
            <Plus aria-hidden="true" className="size-4" /> Novo espaço
          </Button>
        )}
      </div>
      {props.espacos.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Nenhum espaço cadastrado"
          description="Cadastre o salão, a varanda ou a área reservada. Assim a IA sabe dizer quantas pessoas cada espaço comporta ao receber um pedido de evento."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {props.espacos.map((e) => (
            <li key={e.id} aria-label={e.nome} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{e.nome}</p>
                <p className="text-sm text-muted-foreground">de {e.capacidadeMin} a {e.capacidadeMax} pessoas{e.ativo ? '' : ' · Inativo'}</p>
              </div>
              {!props.somenteLeitura && (
                <>
                  <Switch aria-label={`Ativo: ${e.nome}`} checked={e.ativo} disabled={trocando !== null} onCheckedChange={(v) => void alternar(e, v)} />
                  <Button variant="ghost" size="icon" aria-label={`Editar espaço ${e.nome}`} onClick={() => setEditando({ id: e.id, valores: valores(e) })}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo={editando?.id ? 'Editar espaço' : 'Novo espaço'}
        descricao="Quantas pessoas cabem e o que a equipe precisa lembrar."
      >
        {editando && (
          <EspacoForm inicial={editando.valores} acao={(v) => salvarEspacoAction(props.unitId, editando.id, v)} onSalvo={() => setEditando(null)} />
        )}
      </FolhaFormulario>
    </div>
  )
}
