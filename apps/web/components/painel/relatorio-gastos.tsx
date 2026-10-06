import { BarChart3 } from 'lucide-react'
import { emReais, formatarUsd } from '@atd/core/gastos'
import type { LinhasRelatorio } from '@atd/db'
import { Select } from '@/components/form'
import { Button } from '@/components/ui/button'
import { mediaPorConversa, type OpcaoMes } from '@/lib/gastos-tela'

const ETAPA: Record<string, string> = {
  triagem: 'Triagem', resposta: 'Resposta', stt: 'Transcrição de áudio', ingestao: 'Importação do cardápio',
}

const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function Dinheiro(props: { usd: string; cotacao: string }) {
  return (
    <>
      <span className="block text-foreground">{formatarUsd(props.usd)}</span>
      <span className="block text-xs text-muted-foreground">{emReais(props.usd, props.cotacao)}</span>
    </>
  )
}

function Tabela(props: {
  titulo: string
  rotulo: string
  linhas: { chave: string; nome: string; realUsd: string; simulacaoUsd?: string }[]
  cotacao: string
  comSimulacao?: boolean
}) {
  const id = `rel-${props.titulo.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-lg border border-border bg-card p-4">
      <h3 id={id} className="text-sm font-medium text-foreground">{props.titulo}</h3>
      <table aria-labelledby={id} className="mt-2 w-full table-fixed text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="pb-2 text-left font-normal">{props.rotulo}</th>
            <th scope="col" className="pb-2 text-right font-normal">Clientes</th>
            {props.comSimulacao && <th scope="col" className="pb-2 text-right font-normal">Simulação</th>}
          </tr>
        </thead>
        <tbody>
          {props.linhas.map((l) => (
            <tr key={l.chave} className="border-t border-border">
              <th scope="row" className="py-2 pr-2 text-left align-top font-medium break-words text-foreground">{l.nome}</th>
              <td className="py-2 text-right align-top"><Dinheiro usd={l.realUsd} cotacao={props.cotacao} /></td>
              {props.comSimulacao && <td className="py-2 pl-2 text-right align-top"><Dinheiro usd={l.simulacaoUsd ?? '0'} cotacao={props.cotacao} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** Relatório do mês (dono/gerente): totais, custo médio por conversa real e os cortes por dia, etapa, modelo e unidade. */
export function RelatorioGastos(props: { mes: string; meses: OpcaoMes[]; linhas: LinhasRelatorio; cotacao: string }) {
  const { linhas, cotacao } = props
  const rotuloMes = props.meses.find((m) => m.valor === props.mes)?.rotulo ?? props.mes
  const vazio = linhas.porDia.length === 0 && linhas.porEtapa.length === 0 && linhas.porModelo.length === 0
  const media = mediaPorConversa(linhas.totalRealUsd, linhas.conversasReais)
  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="mes" className="text-sm font-medium text-foreground">Mês</label>
          <Select id="mes" name="mes" defaultValue={props.mes}>
            {props.meses.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </Select>
        </div>
        <Button type="submit" variant="outline">Ver mês</Button>
      </form>

      {vazio ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-link">
            <BarChart3 aria-hidden="true" className="size-6" />
          </span>
          <p className="font-semibold text-foreground">Nenhum gasto de IA em {rotuloMes}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            O custo aparece aqui quando a IA responde um cliente, lê um cardápio importado ou quando alguém testa no simulador
            (o botão no canto da tela). Os testes ficam separados do custo com clientes.
          </p>
        </div>
      ) : (
        <>
          <div role="group" aria-label={`Totais de ${rotuloMes}`} className="grid grid-cols-2 gap-3 tabular-nums">
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4">
              <span className="text-sm text-muted-foreground">Clientes</span>
              <span className="font-display text-xl font-semibold text-foreground">{formatarUsd(linhas.totalRealUsd)}</span>
              <span className="text-sm text-muted-foreground">{emReais(linhas.totalRealUsd, cotacao)}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4">
              <span className="text-sm text-muted-foreground">Simulação</span>
              <span className="font-display text-xl font-semibold text-foreground">{formatarUsd(linhas.totalSimulacaoUsd)}</span>
              <span className="text-sm text-muted-foreground">{emReais(linhas.totalSimulacaoUsd, cotacao)}</span>
            </div>
            <div className="col-span-2 flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4">
              <span className="text-sm text-muted-foreground">Custo médio por conversa com cliente</span>
              <span className="font-display text-xl font-semibold text-foreground">{media === null ? '—' : formatarUsd(media)}</span>
              <span className="text-sm text-muted-foreground">
                {media === null ? 'Nenhuma conversa com cliente teve custo de IA' : `${emReais(media, cotacao)} · ${linhas.conversasReais} ${linhas.conversasReais === 1 ? 'conversa' : 'conversas'}`}
              </span>
            </div>
          </div>
          <Tabela titulo="Por dia" rotulo="Dia" comSimulacao cotacao={cotacao}
            linhas={linhas.porDia.map((l) => ({ chave: l.dia, nome: diaCurto(l.dia), realUsd: l.realUsd, simulacaoUsd: l.simulacaoUsd }))} />
          <Tabela titulo="Por etapa" rotulo="Etapa" comSimulacao cotacao={cotacao}
            linhas={linhas.porEtapa.map((l) => ({ chave: l.etapa, nome: ETAPA[l.etapa] ?? l.etapa, realUsd: l.realUsd, simulacaoUsd: l.simulacaoUsd }))} />
          <Tabela titulo="Por modelo" rotulo="Modelo" comSimulacao cotacao={cotacao}
            linhas={linhas.porModelo.map((l) => ({ chave: l.modelo, nome: l.modelo, realUsd: l.realUsd, simulacaoUsd: l.simulacaoUsd }))} />
          {linhas.porUnidade.length > 0 && (
            <Tabela titulo="Por unidade (clientes)" rotulo="Unidade" cotacao={cotacao}
              linhas={linhas.porUnidade.map((l) => ({ chave: l.unitId ?? 'sem', nome: l.unidade ?? 'Sem unidade', realUsd: l.realUsd }))} />
          )}
        </>
      )}
    </div>
  )
}
