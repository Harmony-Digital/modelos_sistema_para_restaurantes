import { acessoInbox, contarAguardando, getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { Avisos } from '@/components/conversas/avisos'
import { AppShell } from '@/components/shell/app-shell'
import { topicosInbox } from '@/lib/conversas'
import { SimulatorLauncher } from '@/components/simulator/launcher'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'
import {
  abrirSimuladorAction, buscarSimuladorAction, detalhesSimuladorAction, enviarSimuladorAction, novoClienteSimuladorAction,
  relogioSimuladorAction,
} from './simulador-actions'

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
  // simulador gasta IA real: só dono e gerente
  const simulador = session.role === 'atendente'
    ? null
    : <SimulatorLauncher restaurante={r?.nome ?? 'Restaurante'} timezone={r?.timezone ?? 'America/Sao_Paulo'} acoes={acoes} />
  // contador de Aguardando (barra e título) e tópicos privados do Realtime que a pessoa pode escutar
  const [aguardando, acesso] = await Promise.all([contarAguardando(db, session.claims), acessoInbox(db, session.claims)])
  const avisos = <Avisos aguardando={aguardando} topicos={acesso ? topicosInbox(acesso) : []} />
  return <AppShell floating={simulador} avisos={avisos} aguardando={aguardando}>{children}</AppShell>
}
