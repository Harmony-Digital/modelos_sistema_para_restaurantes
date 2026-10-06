import Link from 'next/link'
import { carregarUnidadesPainel, listarEquipe } from '@atd/db'
import { Equipe, type IntegranteTela } from '@/components/painel/equipe'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

/** Dono convida, reenvia e desativa; gerente só vê a lista; atendente não acessa. */
export default async function EquipePage() {
  const s = await requireStaff(['dono', 'gerente'])
  const db = getDb()
  const [lista, { unidades }] = await Promise.all([listarEquipe(db, s.claims), carregarUnidadesPainel(db, s.claims)])
  const integrantes: IntegranteTela[] = lista.map((i) =>
    i.tipo === 'membro'
      ? { tipo: 'membro', id: i.id, nome: i.nome, email: i.email, papel: i.papel, unidades: i.unidades, ativo: i.ativo, convitePendente: i.convitePendente, conviteId: i.conviteId, contaExistente: i.contaExistente }
      : { tipo: 'convite', id: i.id, nome: i.nome, email: i.email, papel: i.papel, unidades: i.unidades, ativo: false, statusConvite: i.status },
  )
  return (
    <>
      <TopBar title="Equipe" subtitle="Quem acessa o painel" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Link href="/mais" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">Voltar para Mais</Link>
        <Equipe
          integrantes={integrantes}
          unidades={unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))}
          meuId={s.userId}
          somenteLeitura={s.role !== 'dono'}
        />
      </main>
    </>
  )
}
