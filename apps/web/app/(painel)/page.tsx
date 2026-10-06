import Link from 'next/link'
import {
  contarPedidosNovos, getPanelStatus, lerLimites, listAwaitingHuman, listarPedidosTitular, resumoInicio, tempoAteAssumirHoje, totalPrevistoHoje,
} from '@atd/db'
import { AwaitingHuman } from '@/components/conversations/awaiting-human'
import { CartaoPrazoLgpd } from '@/components/home/cartao-prazo-lgpd'
import { PerguntasSemResposta } from '@/components/home/perguntas-sem-resposta'
import { SpendCard } from '@/components/home/spend-card'
import { CartaoAlertasGastos } from '@/components/painel/alerta-gastos'
import { StatCard } from '@/components/home/stat-card'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { formatarEspera } from '@/lib/conversas'
import { percentual } from '@/lib/inicio'
import { rotuloProvedorIa } from '@/lib/provedor-ia'
import { getDb } from '@/lib/server/db'
import { resumoGastosDoRequest } from '@/lib/server/gastos'
import { devolverAction } from './conversas/actions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000

export default async function InicioPage() {
  const session = await requireStaff()
  const s = await getPanelStatus(getDb(), session.claims)
  const gestao = session.role !== 'atendente'
  const previstos = await totalPrevistoHoje(getDb(), session.claims)
  const pedidosNovos = await contarPedidosNovos(getDb(), session.claims)
  const resumo = gestao ? await resumoInicio(getDb(), session.claims) : null
  const espera = gestao ? await tempoAteAssumirHoje(getDb(), session.claims) : null
  const [limites, gastos] = gestao
    ? await Promise.all([lerLimites(getDb(), session.claims), resumoGastosDoRequest(session.claims)])
    : [null, null]
  const pedidosLgpd = gestao ? await listarPedidosTitular(getDb(), session.claims, { status: ['aberto', 'em_andamento'] }) : []
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
              <Link href="/agenda?aba=previsao" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
                Ver previsão
              </Link>
            }
          />
          <StatCard
            label="Pedidos de evento novos"
            value={String(pedidosNovos)}
            hint={pedidosNovos === 1 ? 'pedido esperando a equipe' : 'pedidos esperando a equipe'}
            action={
              <Link href="/agenda?aba=eventos" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
                Ver pedidos
              </Link>
            }
          />
          {gestao && (
            <StatCard
              label="Tempo até assumir (hoje)"
              value={formatarEspera(espera)}
              hint={espera === null ? 'Ninguém foi assumido hoje' : 'Mediana da espera por um atendente'}
              action={
                <Link href="/conversas" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline">
                  Ver conversas
                </Link>
              }
            />
          )}
          {resumo && (
            <StatCard
              label="Respondido pela IA hoje"
              value={percentual(resumo.taxa.hoje.respondidos, resumo.taxa.hoje.validos)}
              hint={`Últimos 7 dias: ${percentual(resumo.taxa.seteDias.respondidos, resumo.taxa.seteDias.validos)}`}
            />
          )}
        </div>
        {gestao && <CartaoPrazoLgpd pedidos={pedidosLgpd} agora={new Date()} />}
        {resumo && <PerguntasSemResposta lacunas={resumo.lacunas} />}
        {gastos && <CartaoAlertasGastos alertas={gastos.alertas} />}
        {limites && <SpendCard gastos={s.gastos} cotacao={limites.cotacao} provedor={rotuloProvedorIa()} />}
        <AwaitingHuman itens={await listAwaitingHuman(getDb(), session.claims)} action={devolverAction} />
      </main>
    </>
  )
}
