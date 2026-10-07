import { ColunaConversas, type BuscaConversas } from '../coluna-lista'

export const dynamic = 'force-dynamic'

export default async function ListaConversasPage(props: { searchParams: Promise<BuscaConversas> }) {
  return <ColunaConversas sp={await props.searchParams} />
}
