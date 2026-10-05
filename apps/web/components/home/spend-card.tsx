type Periodos = { dia: string | null; mes: string | null }
export type Gastos = { ia: Periodos; whatsapp: Periodos }

const usd4 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })
const usd2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Centavos de centavo importam no dia a dia (IA custa frações de centavo): 4 casas abaixo de US$ 1, 2 casas acima. */
export function formatUsd(valor: string | null): string {
  const n = Number(valor ?? 0)
  // NBSP do Intl vira espaço comum: mesmo texto na tela e nos testes.
  return (Math.abs(n) < 1 ? usd4 : usd2).format(n).replace(/ /g, ' ')
}

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

const linhas = [
  { chave: 'ia', rotulo: 'IA', detalhe: 'OpenRouter' },
  { chave: 'whatsapp', rotulo: 'WhatsApp', detalhe: 'API oficial' },
] as const

export function SpendCard(props: { gastos: Gastos }) {
  const { ia, whatsapp } = props.gastos
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
              <th scope="row" className="py-2 pr-2 text-left font-medium text-foreground">
                {l.rotulo}
                <span className="block text-xs font-normal text-muted-foreground">{l.detalhe}</span>
              </th>
              <td className="py-2 text-right break-words text-foreground">{formatUsd(props.gastos[l.chave].dia)}</td>
              <td className="py-2 pl-2 text-right break-words text-foreground">{formatUsd(props.gastos[l.chave].mes)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <th scope="row" className="pt-2 pr-2 text-left font-display font-semibold text-foreground">Total</th>
            <td className="pt-2 text-right font-display font-semibold break-words text-foreground">{formatUsd(somar(ia.dia, whatsapp.dia))}</td>
            <td className="pt-2 pl-2 text-right font-display font-semibold break-words text-foreground">{formatUsd(somar(ia.mes, whatsapp.mes))}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  )
}
