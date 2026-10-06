import { redirect } from 'next/navigation'

// a Previsão virou uma aba da Agenda; links antigos continuam funcionando (preservam dia, unidade e cancelados)
export default async function PrevisaoRedireciona(props: { searchParams: Promise<{ data?: string; unidade?: string; cancelados?: string }> }) {
  const q = await props.searchParams
  const p = new URLSearchParams({ aba: 'previsao' })
  for (const k of ['data', 'unidade', 'cancelados'] as const) {
    const v = q[k]
    if (typeof v === 'string' && v) p.set(k, v)
  }
  redirect(`/agenda?${p.toString()}`)
}
