import { redirect } from 'next/navigation'
import { hrefDaAgendaAntiga } from '@/lib/agenda'

// a Previsão virou parte da Agenda única por dia; links antigos continuam funcionando (preservam dia, unidade e cancelados)
export default async function PrevisaoRedireciona(props: { searchParams: Promise<{ data?: string; unidade?: string; cancelados?: string }> }) {
  const q = await props.searchParams
  redirect(hrefDaAgendaAntiga({ aba: 'previsao', ...q }) ?? '/agenda')
}
