import { redirect } from 'next/navigation'
import { hrefDasRespostasAntigas } from '@/lib/conteudo'

/** "Respostas" virou "Conteúdo": sem aba vai para Mensagens; com aba repassa (o Conteúdo resolve as antigas). */
export default async function RespostasAntiga(props: { searchParams: Promise<{ aba?: string; sub?: string }> }) {
  redirect(hrefDasRespostasAntigas(await props.searchParams))
}
