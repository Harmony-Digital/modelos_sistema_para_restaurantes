import { ColunaConversas, type BuscaConversas } from '../../coluna-lista'

export const dynamic = 'force-dynamic'

/** Com uma conversa aberta, a lista continua ao lado (≥ lg) com ela marcada; < lg some e fica só a conversa. */
export default async function ListaComConversaPage(props: { params: Promise<{ id: string }>; searchParams: Promise<BuscaConversas> }) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  return <ColunaConversas sp={sp} abertaId={id} />
}
