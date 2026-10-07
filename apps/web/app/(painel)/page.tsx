import {
  contarAguardando, contarPedidosNovos, getPanelStatus, lerLimites, listAwaitingHuman, listarImportacoes, listarPedidos, listarPedidosTitular,
  previsaoDoDia, resumoInicio, serieUltimos7Dias, tempoAteAssumirHoje, totalPrevistoHoje,
} from '@atd/db'
import { emReais, formatarUsd } from '@atd/core/gastos'
import { AwaitingHuman } from '@/components/conversations/awaiting-human'
import { AgendaHoje } from '@/components/home/agenda-hoje'
import { AlertasInicio } from '@/components/home/alertas-inicio'
import { Indicador } from '@/components/home/indicador'
import { SpendCard } from '@/components/home/spend-card'
import { TopBar } from '@/components/shell/top-bar'
import { EtiquetaStatus } from '@/components/ui/etiqueta-status'
import { requireStaff } from '@/lib/dal'
import { formatarEspera } from '@/lib/conversas'
import { agendaDeHoje, importacoesParadas, percentual } from '@/lib/inicio'
import { hojeLocal } from '@/lib/previsao'
import { rotuloProvedorIa } from '@/lib/provedor-ia'
import { getDb } from '@/lib/server/db'
import { resumoGastosDoRequest } from '@/lib/server/gastos'
import { cn } from '@/lib/utils'
import { devolverAction } from './conversas/actions'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000

export default async function InicioPage() {
  const session = await requireStaff()
  const db = getDb()
  const claims = session.claims
  const gestao = session.role !== 'atendente'
  const agora = new Date()
  const hoje = hojeLocal(agora)
  // em sequência: o web usa uma conexão só (pooler em modo transaction)
  const s = await getPanelStatus(db, claims)
  const aguardando = await contarAguardando(db, claims)
  const previstos = await totalPrevistoHoje(db, claims, agora)
  const pedidosNovos = await contarPedidosNovos(db, claims)
  const fila = await listAwaitingHuman(db, claims)
  const previsao = await previsaoDoDia(db, claims, { data: hoje, incluirCancelados: false })
  const pedidos = await listarPedidos(db, claims, { status: ['novo', 'em_contato', 'confirmado'], unitId: null })
  // dono/gerente: indicadores da IA, série de 7 dias, gastos e alertas (a RLS também os esconde do atendente)
  const g = gestao
    ? {
        resumo: await resumoInicio(db, claims, agora),
        espera: await tempoAteAssumirHoje(db, claims),
        serie: await serieUltimos7Dias(db, claims, agora),
        limites: await lerLimites(db, claims),
        gastos: await resumoGastosDoRequest(claims),
        pedidosLgpd: await listarPedidosTitular(db, claims, { status: ['aberto', 'em_andamento'] }),
        paradas: importacoesParadas(await listarImportacoes(db, claims), agora),
      }
    : null
  const online = s.workerLastSeen !== null && agora.getTime() - s.workerLastSeen.getTime() < ONLINE_MS
  const gastoHoje = g?.serie.at(-1)?.gastoUsd ?? '0'
  return (
    <>
      <TopBar title="Início" subtitle="Como está o atendimento agora" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6 lg:mx-0 lg:max-w-none lg:px-8">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <EtiquetaStatus variante={online ? 'ok' : 'erro'}>{online ? 'IA online' : 'IA offline'}</EtiquetaStatus>
          <span>{online ? 'Respondendo clientes' : 'Verifique o worker'}</span>
        </p>
        <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', gestao && 'xl:grid-cols-6')}>
          <Indicador
            rotulo="Aguardando"
            valor={String(aguardando)}
            dica={s.conversasAbertas === 1 ? '1 conversa aberta' : `${s.conversasAbertas} conversas abertas`}
            href="/conversas"
            tom={aguardando > 0 ? 'alerta' : 'neutro'}
          />
          <Indicador
            rotulo="Previstos hoje"
            valor={String(previstos)}
            dica={previstos === 1 ? 'pessoa avisou que vai' : 'pessoas avisaram que vão'}
            href={`/agenda?dia=${hoje}`}
          />
          <Indicador
            rotulo="Eventos novos"
            valor={String(pedidosNovos)}
            dica={pedidosNovos === 1 ? 'pedido esperando a equipe' : 'pedidos esperando a equipe'}
            href="/agenda?aba=eventos"
          />
          {g && (
            <>
              <Indicador
                rotulo="Conversas hoje"
                valor={String(g.serie.at(-1)?.conversas ?? 0)}
                dica={`Tempo até assumir: ${formatarEspera(g.espera)}`}
                href="/conversas"
                serie={{
                  valores: g.serie.map((d) => d.conversas),
                  rotulos: g.serie.map((d) => String(d.conversas)),
                  descricao: 'Conversas nos últimos 7 dias',
                }}
              />
              <Indicador
                rotulo="Respondido pela IA"
                valor={percentual(g.resumo.taxa.hoje.respondidos, g.resumo.taxa.hoje.validos)}
                dica={`Hoje · 7 dias: ${percentual(g.resumo.taxa.seteDias.respondidos, g.resumo.taxa.seteDias.validos)}`}
              />
              <Indicador
                rotulo="Gasto IA hoje"
                valor={emReais(gastoHoje, g.limites.cotacao)}
                dica={formatarUsd(gastoHoje)}
                href="/gestao/gastos"
                serie={{
                  valores: g.serie.map((d) => Number(d.gastoUsd)),
                  rotulos: g.serie.map((d) => emReais(d.gastoUsd, g.limites.cotacao)),
                  descricao: 'Gasto da IA nos últimos 7 dias',
                }}
              />
            </>
          )}
        </div>
        <div className={cn('grid gap-4 lg:items-start', gestao ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
          <AwaitingHuman itens={fila} action={devolverAction} />
          <AgendaHoje linhas={agendaDeHoje(previsao, pedidos, hoje)} hoje={hoje} />
          {g && (
            <div className="flex min-w-0 flex-col gap-4">
              <AlertasInicio
                gastos={g.gastos.alertas}
                pedidosLgpd={g.pedidosLgpd}
                importacoesParadas={g.paradas}
                lacunas={g.resumo.lacunas}
                agora={agora}
              />
              <SpendCard gastos={s.gastos} cotacao={g.limites.cotacao} provedor={rotuloProvedorIa()} />
            </div>
          )}
        </div>
      </main>
    </>
  )
}
