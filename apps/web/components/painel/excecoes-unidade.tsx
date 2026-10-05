'use client'
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { removerExcecaoAction, salvarExcecaoAction } from '@/app/(painel)/unidades/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DiaEspecial } from '@/lib/feriados-unidade'
import type { ExcecaoForm as Valores } from '@/lib/schemas/unidades'
import { Confirmar } from './confirmar'
import { ExcecaoForm } from './excecao-form'
import { FolhaFormulario } from './folha-formulario'

const VAZIA: Valores = { data: '', fechado: false, turnos: [], motivo: '' }

export function ExcecoesUnidade(props: {
  unitId: string
  feriados: DiaEspecial[]
  excecoes: (DiaEspecial & { inicial: Valores })[]
  somenteLeitura: boolean
}) {
  const [editando, setEditando] = useState<{ valores: Valores; existente: boolean } | null>(null)
  const [apagando, setApagando] = useState<DiaEspecial | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="titulo-excecoes" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="titulo-excecoes" className="font-display text-lg font-semibold">Datas especiais</h2>
          {!props.somenteLeitura && (
            <Button onClick={() => setEditando({ valores: VAZIA, existente: false })}>
              <CalendarPlus aria-hidden="true" className="size-4" /> Nova exceção
            </Button>
          )}
        </div>
        {props.excecoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma exceção cadastrada. Use para feriados locais, reformas ou horário especial.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.excecoes.map((e) => (
              <li key={e.data} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.rotulo}</p>
                  <p className="text-sm text-muted-foreground">{e.comportamento}{e.motivo ? ` · ${e.motivo}` : ''}</p>
                </div>
                {!props.somenteLeitura && (
                  <>
                    <Button variant="ghost" size="icon" aria-label={`Editar exceção de ${e.dataBr}`} onClick={() => setEditando({ valores: e.inicial, existente: true })}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Apagar exceção de ${e.dataBr}`} onClick={() => setApagando(e)}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-feriados" className="flex flex-col gap-3">
        <h2 id="titulo-feriados" className="font-display text-lg font-semibold">Feriados nacionais</h2>
        <p className="text-sm text-muted-foreground">É o que a IA responde em cada feriado. Para mudar um dia, defina uma exceção.</p>
        <ul className="flex flex-col gap-2">
          {props.feriados.map((f) => (
            <li key={f.data} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.feriado}</p>
                <p className="text-sm text-muted-foreground">{f.rotulo} · {f.comportamento}</p>
              </div>
              {f.temExcecao ? (
                <Badge variant="secondary">Exceção cadastrada</Badge>
              ) : (
                !props.somenteLeitura && (
                  <Button variant="outline" onClick={() => setEditando({ valores: { data: f.dataBr, fechado: false, turnos: [], motivo: f.feriado ?? '' }, existente: false })}>
                    Definir exceção
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo="Exceção de horário"
        descricao="Vale só para a data escolhida e vence a regra semanal e a de feriados."
      >
        {editando && (
          <ExcecaoForm
            inicial={editando.valores}
            dataFixa={editando.existente}
            acao={(v) => salvarExcecaoAction(props.unitId, v)}
            onSalvo={() => setEditando(null)}
          />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={apagando !== null}
        onAbertoChange={(a) => !a && setApagando(null)}
        titulo={`Apagar a exceção de ${apagando?.dataBr ?? ''}?`}
        descricao="A data volta a seguir a regra semanal e a política de feriados."
        rotuloConfirmar="Apagar"
        onConfirmar={async () => {
          if (!apagando) return
          try {
            const r = await removerExcecaoAction(props.unitId, apagando.data)
            if (r.ok) toast.success('Exceção apagada')
            else toast.error(r.formError ?? 'Não foi possível apagar agora.')
          } catch {
            toast.error('Não foi possível apagar agora. Tente de novo.')
          }
          setApagando(null)
        }}
      />
    </div>
  )
}
