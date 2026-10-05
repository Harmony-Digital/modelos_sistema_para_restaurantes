import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { carregarUnidadesPainel } from '@atd/db'
import { salvarDadosUnidadeAction, salvarHorariosAction } from '@/app/(painel)/unidades/actions'
import { Abas } from '@/components/painel/abas'
import { DadosUnidadeForm } from '@/components/painel/dados-unidade-form'
import { ExcecoesUnidade } from '@/components/painel/excecoes-unidade'
import { HorariosForm } from '@/components/painel/horarios-form'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { excecoesCadastradas, feriadosComComportamento } from '@/lib/feriados-unidade'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'
import { valoresDadosUnidade } from '@/lib/unidade-form'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'dados', rotulo: 'Dados' },
  { chave: 'horarios', rotulo: 'Horários' },
  { chave: 'excecoes', rotulo: 'Exceções' },
] as const
type Aba = (typeof ABAS)[number]['chave']

export default async function UnidadePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const s = await requireStaff()
  const { id } = await props.params
  const pedida = (await props.searchParams).aba
  const aba: Aba = ABAS.some((a) => a.chave === pedida) ? (pedida as Aba) : 'dados'
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  const u = unidades.find((x) => x.id === id)
  if (!u) notFound() // inexistente ou fora das unidades permitidas (RLS)
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar
        title={u.nome}
        subtitle="Dados, horários e exceções"
        action={
          <Link href="/unidades" aria-label="Voltar para unidades" className="flex size-11 items-center justify-center rounded-full text-foreground">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <SeloUnidade selo={seloDaUnidade(u, restaurante.politicaFeriado, restaurante.timezone, new Date())} />
        <Abas rotulo="Seções da unidade" itens={ABAS.map((a) => ({ href: `/unidades/${u.id}?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'dados' && (
          <DadosUnidadeForm inicial={valoresDadosUnidade(u)} acao={salvarDadosUnidadeAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        )}
        {aba === 'horarios' && (
          <HorariosForm unitId={u.id} inicial={{ semanal: u.semanal }} acao={salvarHorariosAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        )}
        {aba === 'excecoes' && (
          <ExcecoesUnidade
            unitId={u.id}
            somenteLeitura={somenteLeitura}
            feriados={feriadosComComportamento(u, restaurante.politicaFeriado, restaurante.timezone, new Date())}
            excecoes={excecoesCadastradas(u, restaurante.timezone, new Date(), restaurante.politicaFeriado).map((e) => {
              const x = u.excecoes[e.data]!
              return { ...e, inicial: { data: e.dataBr, fechado: x.fechado, turnos: x.turnos, motivo: x.motivo ?? '' } }
            })}
          />
        )}
      </main>
    </>
  )
}
