import { redirect } from 'next/navigation'

/** "Respostas" virou "Conteúdo": links antigos continuam funcionando e preservam a aba. */
export default async function RespostasAntiga(props: { searchParams: Promise<{ aba?: string; sub?: string }> }) {
  const { aba, sub } = await props.searchParams
  const qs = new URLSearchParams()
  if (aba) qs.set('aba', aba)
  if (sub) qs.set('sub', sub)
  redirect(qs.size > 0 ? `/conteudo?${qs}` : '/conteudo')
}
