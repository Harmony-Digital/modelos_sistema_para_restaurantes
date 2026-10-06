'use client'
import { MessageCircleQuestion } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { ignorarLacunaAction, responderLacunaAction } from '@/app/(painel)/respostas/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Button } from '@/components/ui/button'
import { acaoDaLacuna, tituloDaLacuna } from '@/lib/respostas'
import type { FatoForm as ValoresFato } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FatoForm } from './fato-form'
import { FolhaFormulario } from './folha-formulario'

export type LacunaTela = {
  id: string
  chave: string
  unitId: string | null
  unidade: string | null
  pergunta: string | null
  ocorrencias: number
  ultimaVez: string
}

const LINK: Record<'horarios' | 'endereco' | 'unidades', (l: LacunaTela) => { href: string; rotulo: string }> = {
  horarios: (l: LacunaTela) => l.unitId
    ? { href: `/unidades/${l.unitId}?aba=horarios`, rotulo: `Cadastrar horários da ${l.unidade}` }
    : { href: '/unidades', rotulo: 'Cadastrar horários' },
  endereco: (l: LacunaTela) => l.unitId
    ? { href: `/unidades/${l.unitId}?aba=dados`, rotulo: `Cadastrar endereço da ${l.unidade}` }
    : { href: '/unidades', rotulo: 'Cadastrar endereço' },
  unidades: () => ({ href: '/unidades', rotulo: 'Cadastrar unidades' }),
}

/** Espaços são por unidade: a lacuna leva à primeira unidade (ou à lista, sem nenhuma). */
export const linkDeEspacos = (unidades: { id: string }[]) => unidades[0]
  ? { href: `/unidades/${unidades[0].id}?aba=espacos`, rotulo: 'Cadastrar espaços' }
  : { href: '/unidades', rotulo: 'Cadastrar espaços' }

export function SemResposta(props: { lacunas: LacunaTela[]; unidades: { id: string; nome: string }[]; somenteLeitura: boolean }) {
  const [respondendo, setRespondendo] = useState<{ lacuna: LacunaTela; inicial: ValoresFato } | null>(null)
  const [ignorando, setIgnorando] = useState<LacunaTela | null>(null)

  if (props.lacunas.length === 0) {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title="Nenhuma pergunta sem resposta"
        description="Quando a IA não souber responder algo, a pergunta aparece aqui para você cadastrar a resposta uma vez só."
      />
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {props.lacunas.map((l) => {
          const acao = acaoDaLacuna(l.chave)
          const alvo = acao === 'fato' ? null : acao === 'espacos' ? linkDeEspacos(props.unidades) : LINK[acao](l)
          const titulo = tituloDaLacuna(l.chave)
          return (
            <li key={l.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{titulo}</p>
                  <p className="text-sm text-muted-foreground">{l.unidade ?? 'Todas as unidades'}</p>
                  {l.pergunta && <p className="mt-1 text-sm text-foreground">“{l.pergunta}”</p>}
                </div>
                <span className="shrink-0 text-sm font-medium text-link">{l.ocorrencias === 1 ? '1 vez' : `${l.ocorrencias} vezes`}</span>
              </div>
              {!props.somenteLeitura && (
                <div className="flex flex-wrap gap-2">
                  {acao === 'fato' || !alvo ? (
                    <Button
                      aria-label={`Responder: ${titulo}`}
                      onClick={() => setRespondendo({
                        lacuna: l,
                        inicial: { tema: titulo, exemplos: l.pergunta ? [l.pergunta] : [], texto: '', unitId: l.unitId ?? '', ativo: true },
                      })}
                    >
                      Responder
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href={alvo.href}>{alvo.rotulo}</Link>
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setIgnorando(l)}>{acao === 'fato' ? 'Ignorar' : 'Já resolvi'}</Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <FolhaFormulario
        aberto={respondendo !== null}
        onAbertoChange={(a) => !a && setRespondendo(null)}
        titulo="Responder pergunta"
        descricao="Cadastre a resposta uma vez; a IA passa a responder sozinha."
      >
        {respondendo && (
          <FatoForm
            inicial={respondendo.inicial}
            unidades={props.unidades}
            rotuloSalvar="Salvar resposta"
            acao={(v) => responderLacunaAction(respondendo.lacuna.id, v)}
            onSalvo={() => setRespondendo(null)}
          />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={ignorando !== null}
        onAbertoChange={(a) => !a && setIgnorando(null)}
        titulo="Tirar esta pergunta da lista?"
        descricao="Se a pergunta voltar a aparecer, ela entra de novo na lista."
        rotuloConfirmar="Tirar da lista"
        rotuloAndamento="Tirando da lista…"
        onConfirmar={async () => {
          if (!ignorando) return
          try {
            const r = await ignorarLacunaAction(ignorando.id)
            if (r.ok) toast.success('Pergunta tirada da lista')
            else toast.error(r.formError ?? 'Não foi possível agora.')
          } catch {
            toast.error('Não foi possível agora. Tente de novo.')
          }
          setIgnorando(null)
        }}
      />
    </>
  )
}
