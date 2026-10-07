import { carregarUnidadesPainel, lerLimites, relatorioMes, resumoGastos } from '@atd/db'
import { Limites } from '@/components/painel/limites'
import { RelatorioGastos } from '@/components/painel/relatorio-gastos'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { mesDaBusca, ultimosMeses } from '@/lib/gastos-tela'
import { getDb } from '@/lib/server/db'
import { salvarCotacaoAction, salvarLimiteAction } from './actions'

export const dynamic = 'force-dynamic'

const acoes = { salvarLimite: salvarLimiteAction, salvarCotacao: salvarCotacaoAction }

/** Dono edita; gerente só vê; atendente é mandado de volta (requireStaff). */
export default async function GastosPage(props: { searchParams: Promise<{ mes?: string | string[] }> }) {
  const s = await requireStaff(['dono', 'gerente'])
  const db = getDb()
  const agora = new Date()
  const { restaurante } = await carregarUnidadesPainel(db, s.claims)
  const meses = ultimosMeses(agora, restaurante.timezone)
  const mes = mesDaBusca((await props.searchParams).mes, meses)
  const [{ limites, cotacao }, uso, linhas] = await Promise.all([
    lerLimites(db, s.claims), resumoGastos(db, s.claims, agora), relatorioMes(db, s.claims, mes),
  ])
  return (
    <>
      <TopBar title="Gastos e limites" subtitle="Quanto a IA e o WhatsApp custam" />
      <main className="mx-auto flex max-w-xl lg:mx-0 lg:max-w-6xl lg:px-8 flex-col gap-8 px-4 py-6">
        <section aria-labelledby="limites" className="flex flex-col gap-3">
          <h2 id="limites" className="text-sm font-medium text-foreground">Limites</h2>
          <p className="text-sm text-muted-foreground">
            Ao chegar no limite, a IA entra em modo econômico (mensagens fixas e a conversa vai para a equipe, sem novo gasto)
            até o próximo dia ou mês, ou até você aumentar o limite. O limite de simulação vale só para os testes no simulador.
            Um aviso aparece no painel quando o uso passa do percentual escolhido.
          </p>
          <Limites limites={limites} uso={{ hoje: uso.hoje, mes: uso.mes }} cotacao={cotacao} acoes={acoes} somenteLeitura={s.role !== 'dono'} />
        </section>
        <section aria-labelledby="relatorio" className="flex flex-col gap-3">
          <h2 id="relatorio" className="text-sm font-medium text-foreground">Relatório do mês</h2>
          <RelatorioGastos mes={mes} meses={meses} linhas={linhas} cotacao={cotacao} />
        </section>
      </main>
    </>
  )
}
