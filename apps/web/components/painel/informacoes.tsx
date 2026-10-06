'use client'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { removerFatoAction, salvarFatoAction } from '@/app/(painel)/conteudo/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { sugestoesDeTemas } from '@/lib/respostas'
import type { FatoForm as ValoresFato } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FatoForm } from './fato-form'
import { FolhaFormulario } from './folha-formulario'

export type FatoTela = { id: string; tema: string; exemplos: string[]; texto: string; unitId: string | null; unidade: string | null; ativo: boolean }

const vazio = (tema = ''): ValoresFato => ({ tema, exemplos: [], texto: '', unitId: '', ativo: true })

export function Informacoes(props: { fatos: FatoTela[]; unidades: { id: string; nome: string }[]; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<{ id: string | null; inicial: ValoresFato } | null>(null)
  const [apagando, setApagando] = useState<FatoTela | null>(null)
  const sugestoes = sugestoesDeTemas(props.fatos)

  return (
    <div className="flex flex-col gap-4">
      {!props.somenteLeitura && (
        <Button className="self-start" onClick={() => setEditando({ id: null, inicial: vazio() })}>
          <Plus aria-hidden="true" className="size-4" /> Nova informação
        </Button>
      )}
      {props.fatos.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nenhuma informação cadastrada" description="Cadastre o que os clientes costumam perguntar: estacionamento, formas de pagamento, pet, acessibilidade…" />
      ) : (
        <ul className="flex flex-col gap-3">
          {props.fatos.map((f) => (
            <li key={f.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  {f.tema}
                  {!f.ativo && <Badge variant="secondary">Desativada</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{f.unidade ?? 'Todas as unidades'}</p>
                <p className="mt-1 text-sm text-foreground">{f.texto}</p>
              </div>
              {!props.somenteLeitura && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label={`Editar ${f.tema}`} onClick={() => setEditando({
                    id: f.id, inicial: { tema: f.tema, exemplos: f.exemplos, texto: f.texto, unitId: f.unitId ?? '', ativo: f.ativo },
                  })}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Apagar ${f.tema}`} onClick={() => setApagando(f)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!props.somenteLeitura && sugestoes.length > 0 && (
        <section aria-labelledby="titulo-sugestoes" className="flex flex-col gap-2">
          <h2 id="titulo-sugestoes" className="text-sm font-semibold text-foreground">Assuntos comuns ainda sem resposta</h2>
          <div className="flex flex-wrap gap-2">
            {sugestoes.map((t) => (
              <Button key={t} variant="outline" onClick={() => setEditando({ id: null, inicial: vazio(t) })}>{t}</Button>
            ))}
          </div>
        </section>
      )}
      <FolhaFormulario aberto={editando !== null} onAbertoChange={(a) => !a && setEditando(null)} titulo={editando?.id ? 'Editar informação' : 'Nova informação'}>
        {editando && (
          <FatoForm
            inicial={editando.inicial}
            unidades={props.unidades}
            rotuloSalvar="Salvar informação"
            acao={(v) => salvarFatoAction(editando.id, v)}
            onSalvo={() => setEditando(null)}
          />
        )}
      </FolhaFormulario>
      <Confirmar
        aberto={apagando !== null}
        onAbertoChange={(a) => !a && setApagando(null)}
        titulo={`Apagar "${apagando?.tema ?? ''}"?`}
        descricao="A IA deixa de responder sobre esse assunto e a pergunta volta a aparecer como sem resposta."
        rotuloConfirmar="Apagar"
        onConfirmar={async () => {
          if (!apagando) return
          try {
            const r = await removerFatoAction(apagando.id)
            if (r.ok) toast.success('Informação apagada')
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
