import { ColunaUnidades } from '../../coluna-lista'

export const dynamic = 'force-dynamic'

/** Com o importador aberto, a lista continua ao lado (≥ lg); < lg some e fica só o importador. */
export default async function ListaComImportadorPage() {
  return <ColunaUnidades detalheAberto />
}
