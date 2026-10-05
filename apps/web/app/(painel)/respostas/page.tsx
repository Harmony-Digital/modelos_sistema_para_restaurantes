import { carregarUnidadesPainel, listarFatos, listarLacunas, listarModelos } from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { Informacoes } from '@/components/painel/informacoes'
import { Modelos } from '@/components/painel/modelos'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'sem-resposta', rotulo: 'Sem resposta' },
  { chave: 'informacoes', rotulo: 'Informações' },
  { chave: 'mensagens', rotulo: 'Mensagens' },
] as const
type Aba = (typeof ABAS)[number]['chave']

export default async function RespostasPage(props: { searchParams: Promise<{ aba?: string }> }) {
  const s = await requireStaff()
  const pedida = (await props.searchParams).aba
  const aba: Aba = ABAS.find((a) => a.chave === pedida)?.chave ?? 'sem-resposta'
  const db = getDb()
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  const opcoes = unidades.map((u) => ({ id: u.id, nome: u.nome }))
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar title="Respostas" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Abas rotulo="Seções de respostas" itens={ABAS.map((a) => ({ href: `/respostas?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'sem-resposta' && (
          <SemResposta
            somenteLeitura={somenteLeitura}
            unidades={opcoes}
            lacunas={(await listarLacunas(db, s.claims)).map((l) => ({ ...l, ultimaVez: l.ultimaVez.toISOString() }))}
          />
        )}
        {aba === 'informacoes' && <Informacoes somenteLeitura={somenteLeitura} unidades={opcoes} fatos={await listarFatos(db, s.claims)} />}
        {aba === 'mensagens' && (
          <Modelos
            somenteLeitura={somenteLeitura}
            personalizados={await listarModelos(db, s.claims)}
            unidade={unidades.find((u) => u.ativo) ?? null}
          />
        )}
      </main>
    </>
  )
}
