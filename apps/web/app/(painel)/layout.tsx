import { acessoInbox, contarAguardando, getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { Avisos } from '@/components/conversas/avisos'
import { FaixaAlertaGastos } from '@/components/painel/alerta-gastos'
import { BuscaRapida } from '@/components/shell/busca-rapida'
import { AppShell } from '@/components/shell/app-shell'
import { topicosInbox } from '@/lib/conversas'
import { SimulatorLauncher } from '@/components/simulator/launcher'
import { requireStaff } from '@/lib/dal'
import { MENU_COOKIE, parseMenu } from '@/lib/menu'
import { PAPEIS_SIMULADOR } from '@/lib/navegacao'
import { getDb } from '@/lib/server/db'
import { resumoGastosDoRequest } from '@/lib/server/gastos'
import { parseTema, THEME_COOKIE } from '@/lib/theme'
import {
  abrirSimuladorAction, buscarSimuladorAction, detalhesSimuladorAction, enviarSimuladorAction, novoClienteSimuladorAction,
  relogioSimuladorAction,
} from './simulador-actions'
import { buscarNoPainelAction } from './busca-actions'

const acoes = {
  abrir: abrirSimuladorAction,
  buscar: buscarSimuladorAction,
  enviar: enviarSimuladorAction,
  novoCliente: novoClienteSimuladorAction,
  relogio: relogioSimuladorAction,
  detalhes: detalhesSimuladorAction,
}

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff()
  const db = getDb()
  const [r] = await db.select({ nome: schema.restaurants.nome, timezone: schema.restaurants.timezone }).from(schema.restaurants)
    .where(eq(schema.restaurants.id, await getSingleRestaurantId(db)))
  // simulador gasta IA real: mesma regra do item Simulador do menu
  const simulador = !PAPEIS_SIMULADOR.includes(session.role)
    ? null
    : <SimulatorLauncher restaurante={r?.nome ?? 'Restaurante'} timezone={r?.timezone ?? 'America/Sao_Paulo'} acoes={acoes} />
  // contador de Aguardando (barra e título) e tópicos privados do Realtime que a pessoa pode escutar
  const [aguardando, acesso, gastos] = await Promise.all([
    contarAguardando(db, session.claims),
    acessoInbox(db, session.claims),
    // alertas de gasto do período corrente: só dono e gerente
    session.role === 'atendente' ? null : resumoGastosDoRequest(session.claims),
  ])
  const avisos = <Avisos aguardando={aguardando} topicos={acesso ? topicosInbox(acesso) : []} />
  // só com alerta: o AppShell reserva a altura da faixa para o simulador flutuante
  const faixa = gastos && gastos.alertas.length > 0 ? <FaixaAlertaGastos alertas={gastos.alertas} /> : null
  // menu recolhido/aberto e tema lidos no servidor: a página já nasce no estado certo, sem piscar
  const jar = await cookies()
  return (
    <AppShell
      papel={session.role}
      restaurante={r?.nome ?? 'Restaurante'}
      tema={parseTema(jar.get(THEME_COOKIE)?.value)}
      menu={parseMenu(jar.get(MENU_COOKIE)?.value)}
      floating={simulador}
      busca={<BuscaRapida papel={session.role} buscar={buscarNoPainelAction} />}
      avisos={avisos}
      aguardando={aguardando}
      faixa={faixa}
    >
      {children}
    </AppShell>
  )
}
