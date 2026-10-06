import Link from 'next/link'
import { getPanelStatus, listAwaitingHuman, resumoInicio, totalPrevistoHoje } from '@atd/db'
import { AwaitingHuman } from '@/components/conversations/awaiting-human'
import { PerguntasSemResposta } from '@/components/home/perguntas-sem-resposta'
import { SpendCard } from '@/components/home/spend-card'
import { StatCard } from '@/components/home/stat-card'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { percentual } from '@/lib/inicio'
import { getDb } from '@/lib/server/db'
import { returnToAiAction } from './actions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000

export default async function InicioPage() {
  const session = await requireStaff()
  const s = await getPanelStatus(getDb(), session.claims)
  const gestao = session.role !== 'atendente'
  const previstos = await totalPrevistoHoje(getDb(), session.claims)
  const resumo = gestao ? await resumoInicio(getDb(), session.claims) : null
  const online = s.workerLastSeen !== null && Date.now() - s.workerLastSeen.getTime() < ONLINE_MS
  return (
    <>
      <TopBar title="Início" subtitle="Como está o atendimento agora" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="IA" value={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'alerta'} hint={online ? 'Respondendo clientes' : 'Verifique o worker'} />
          <StatCard label="Conversas abertas" value={String(s.conversasAbertas)} hint={`${s.aguardandoHumano} aguardando atendente`} />
          <StatCard
            label="Previstos hoje"
            value={String(previstos)}
            hint={previstos === 1 ? 'pessoa avisou que vai' : 'pessoas avisaram que vão'}
            action={
              <Link href="/previsao" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
                Ver previsão
              </Link>
            }
          />
          {resumo && (
            <StatCard
              label="Respondido pela IA hoje"
              value={percentual(resumo.taxa.hoje.respondidos, resumo.taxa.hoje.validos)}
              hint={`Últimos 7 dias: ${percentual(resumo.taxa.seteDias.respondidos, resumo.taxa.seteDias.validos)}`}
            />
          )}
        </div>
        {resumo && <PerguntasSemResposta lacunas={resumo.lacunas} />}
        {gestao && <SpendCard gastos={s.gastos} />}
        <AwaitingHuman itens={await listAwaitingHuman(getDb(), session.claims)} action={returnToAiAction} />
      </main>
    </>
  )
}
