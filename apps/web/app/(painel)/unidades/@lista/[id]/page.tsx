import { ColunaUnidades } from '../../coluna-lista'

export const dynamic = 'force-dynamic'

/** Com uma unidade aberta, a lista continua ao lado (≥ lg) com ela marcada; < lg some e fica só a unidade. */
export default async function ListaComUnidadePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  return <ColunaUnidades abertaId={id} />
}
