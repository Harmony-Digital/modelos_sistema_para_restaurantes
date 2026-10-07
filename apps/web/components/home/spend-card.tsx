import Link from 'next/link'
import { emReais, formatarUsd } from '@atd/core/gastos'
import { usdParaCampo } from '@/lib/gastos-tela'
import type { RotuloProvedor } from '@/lib/provedor-ia'

type Periodos = { dia: string | null; mes: string | null }
export type Gastos = { ia: Periodos; simulacao: Periodos; whatsapp: Periodos }

/** Soma valores numeric (até 6 casas) em micro-dólares inteiros, sem erro de ponto flutuante. */
function somar(...valores: (string | null)[]): string {
  let micros = 0n
  for (const v of valores) {
    if (!v) continue
    const [int = '0', frac = ''] = v.split('.')
    micros += BigInt(int) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6))
  }
  const s = micros.toString().padStart(7, '0')
  return `${s.slice(0, -6)}.${s.slice(-6)}`
}

/** US$ em cima, R$ (US$ × cotação, só exibição) embaixo. */
function Valor(props: { usd: string | null; cotacao: string; forte?: boolean }) {
  const usd = somar(props.usd)
  return (
    <>
      <span className={props.forte ? 'block font-display font-semibold text-foreground' : 'block text-foreground'}>{formatarUsd(usd)}</span>
      <span className="block text-xs text-muted-foreground">{emReais(usd, props.cotacao)}</span>
    </>
  )
}

const celula = 'py-2 text-right align-top break-words'

export function SpendCard(props: { gastos: Gastos; cotacao: string; provedor: RotuloProvedor }) {
  const { ia, simulacao, whatsapp } = props.gastos
  const linhas = [
    { chave: 'ia', rotulo: 'IA (clientes)', detalhe: props.provedor, valores: ia },
    { chave: 'whatsapp', rotulo: 'WhatsApp', detalhe: 'API oficial', valores: whatsapp },
  ] as const
  return (
    <section aria-labelledby="gastos-titulo" className="min-w-0 rounded-lg border border-border bg-card p-4">
      <h2 id="gastos-titulo" className="text-sm text-muted-foreground">Gastos</h2>
      <table aria-labelledby="gastos-titulo" className="mt-2 w-full table-fixed text-sm tabular-nums">
        <colgroup>
          <col className="w-[38%]" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="pb-2 text-left font-normal"><span className="sr-only">Serviço</span></th>
            <th scope="col" className="pb-2 text-right font-normal">Hoje</th>
            <th scope="col" className="pb-2 text-right font-normal">No mês</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.chave} className="border-t border-border">
              <th scope="row" className="py-2 pr-2 text-left align-top font-medium text-foreground">
                {l.rotulo}
                <span className="block text-xs font-normal text-muted-foreground">{l.detalhe}</span>
              </th>
              <td className={celula}><Valor usd={l.valores.dia} cotacao={props.cotacao} /></td>
              <td className={`${celula} pl-2`}><Valor usd={l.valores.mes} cotacao={props.cotacao} /></td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <th scope="row" className="py-2 pr-2 text-left align-top font-display font-semibold text-foreground">Total</th>
            <td className={celula}><Valor usd={somar(ia.dia, whatsapp.dia)} cotacao={props.cotacao} forte /></td>
            <td className={`${celula} pl-2`}><Valor usd={somar(ia.mes, whatsapp.mes)} cotacao={props.cotacao} forte /></td>
          </tr>
        </tbody>
        <tfoot>
          <tr className="border-t border-dashed border-border">
            <th scope="row" className="pt-2 pr-2 text-left align-top font-medium text-foreground">
              Simulação
              <span className="block text-xs font-normal text-muted-foreground">Testes no simulador, fora do total</span>
            </th>
            <td className={`${celula} pb-0`}><Valor usd={simulacao.dia} cotacao={props.cotacao} /></td>
            <td className={`${celula} pb-0 pl-2`}><Valor usd={simulacao.mes} cotacao={props.cotacao} /></td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">Cotação usada: US$ 1 = R$ {usdParaCampo(props.cotacao)}</p>
      <Link href="/gestao/gastos" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
        Ver gastos e limites
      </Link>
    </section>
  )
}
