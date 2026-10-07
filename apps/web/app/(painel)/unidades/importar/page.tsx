import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { carregarUnidadesPainel, podeEditarCardapioGeral, withUserContext } from '@atd/db'
import { CabecalhoImportar, SecaoImportar } from '@/app/(painel)/conteudo/secao-importar'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { colunaDetalhe } from '@/lib/lista-detalhe'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const TITULO = 'Importar horários e espaços'

/**
 * Importar de Unidades (Etapa 07): o fluxo atual de importação, ao lado da lista, já em horários ou espaços. Quem não é
 * dono nem gerente com acesso a todas as unidades vê a explicação do importador (como antes, na aba Importar).
 */
export default async function ImportarUnidadesPage(props: { searchParams: Promise<{ alvo?: string; imp?: string }> }) {
  const s = await requireStaff()
  if (s.role === 'atendente') redirect('/unidades')
  const q = await props.searchParams
  const alvo = q.alvo === 'espacos' ? 'espacos' : 'horarios'
  const db = getDb()
  const geral = await withUserContext(db, s.claims, (tx) => podeEditarCardapioGeral(tx))
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  return (
    <section aria-label={TITULO} className={colunaDetalhe(true)}>
      <TopBar
        title={TITULO}
        subtitle="Horários de funcionamento e espaços para eventos"
        className="lg:hidden" semFaixa
        action={
          <Link href="/unidades" aria-label="Voltar para unidades" className="flex size-11 items-center justify-center rounded-full text-foreground">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 lg:max-w-3xl lg:px-6 lg:py-4">
        <div className="hidden lg:block">
          <CabecalhoImportar titulo={TITULO} fechar="/unidades" />
        </div>
        <SecaoImportar
          imp={q.imp}
          alvo={alvo}
          geral={geral}
          s={s}
          unidades={unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))}
        />
      </div>
    </section>
  )
}
