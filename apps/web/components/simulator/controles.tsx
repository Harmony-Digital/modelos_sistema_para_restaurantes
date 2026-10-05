'use client'
import { Clock, Info, UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { horarioLocal, type DetalheTela } from '@/lib/simulador-tela'

const usd = (v: string) => `US$ ${v.replace('.', ',')}`

export function SimuladorControles(props: {
  timezone: string
  offset: number | null
  relogio: string | null
  erro: string | null
  detalhes: DetalheTela[] | 'erro' | null
  onNovoCliente: () => void
  onRelogio: (local: string | null) => Promise<string | null>
  onDetalhes: () => void
}) {
  const [painel, setPainel] = useState<'relogio' | 'detalhes' | null>(null)
  const [local, setLocal] = useState('')
  const [erroRelogio, setErroRelogio] = useState<string | null>(null)
  const campoId = useId()
  const erroId = useId()

  function alternar(p: 'relogio' | 'detalhes') {
    const abrindo = painel !== p
    setPainel(abrindo ? p : null)
    if (abrindo && p === 'relogio') {
      setLocal(horarioLocal(new Date(Date.now() + (props.offset ?? 0) * 1000), props.timezone))
      setErroRelogio(null)
    }
    if (abrindo && p === 'detalhes') props.onDetalhes()
  }

  async function aplicar(valor: string | null) {
    const erro = await props.onRelogio(valor)
    setErroRelogio(erro)
    if (!erro) setPainel(null)
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 bg-background p-2 pr-14 text-sm text-foreground md:absolute md:right-full md:top-0 md:mr-4 md:w-64 md:rounded-xl md:p-3 md:pr-3 md:shadow-xl">
      <div className="flex flex-wrap gap-2 md:flex-col">
        <Button type="button" variant="outline" onClick={props.onNovoCliente}>
          <UserPlus aria-hidden="true" /> Novo cliente
        </Button>
        <Button type="button" variant="outline" aria-expanded={painel === 'relogio'} onClick={() => alternar('relogio')}>
          <Clock aria-hidden="true" /> Simular data e hora
        </Button>
        <Button type="button" variant="outline" aria-expanded={painel === 'detalhes'} onClick={() => alternar('detalhes')}>
          <Info aria-hidden="true" /> Ver detalhes
        </Button>
      </div>
      {props.relogio && <p className="text-xs text-muted-foreground">{props.relogio}</p>}
      {props.erro && <p role="alert" className="text-xs text-destructive">{props.erro}</p>}

      {painel === 'relogio' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => { e.preventDefault(); void aplicar(local) }}
        >
          <label htmlFor={campoId} className="text-xs font-medium">Data e hora simuladas</label>
          <input
            id={campoId}
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            aria-invalid={erroRelogio ? true : undefined}
            aria-describedby={erroRelogio ? erroId : undefined}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
          {erroRelogio && <p id={erroId} role="alert" className="text-xs text-destructive">{erroRelogio}</p>}
          <p className="text-xs text-muted-foreground">Vale só para esta simulação: muda o "aberto agora" e os horários do dia.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar</Button>
            <Button type="button" variant="ghost" onClick={() => void aplicar(null)}>Usar relógio real</Button>
          </div>
        </form>
      )}

      {painel === 'detalhes' && (
        <section aria-label="Detalhes da IA" className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {props.detalhes === null && <p role="status" className="text-xs text-muted-foreground">Carregando…</p>}
          {props.detalhes === 'erro' && (
            <div className="flex flex-col items-start gap-2">
              <p role="alert" className="text-xs text-destructive">Não foi possível carregar os detalhes.</p>
              <Button type="button" variant="outline" onClick={props.onDetalhes}>Tentar de novo</Button>
            </div>
          )}
          {Array.isArray(props.detalhes) && props.detalhes.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma chamada da IA nesta conversa ainda.</p>}
          {Array.isArray(props.detalhes) && props.detalhes.length > 0 && (
            <ul className="flex flex-col gap-2">
              {props.detalhes.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-2 text-xs">
                  <p className="font-medium">{d.etapa} · {d.intent ?? '—'}</p>
                  <p className="text-muted-foreground">{d.modelo} · {usd(d.costUsd)}{d.latenciaMs !== null ? ` · ${d.latenciaMs} ms` : ''}</p>
                  {d.itensValidos !== null && (
                    <p>Respondeu {d.itensRespondidos ?? 0} de {d.itensValidos} perguntas com dado cadastrado</p>
                  )}
                  {d.erro && <p className="text-destructive">{d.erro}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Cada mensagem simulada usa a IA de verdade e entra no limite de gastos.</p>
        </section>
      )}
    </div>
  )
}
