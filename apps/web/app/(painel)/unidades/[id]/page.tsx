import { ArrowLeft, X } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { carregarUnidadesPainel, listarEspacos } from '@atd/db'
import { salvarDadosUnidadeAction, salvarHorariosAction } from '@/app/(painel)/unidades/actions'
import { DadosUnidadeForm } from '@/components/painel/dados-unidade-form'
import { Espacos } from '@/components/painel/espacos'
import { ExcecoesUnidade } from '@/components/painel/excecoes-unidade'
import { HorariosForm } from '@/components/painel/horarios-form'
import { RolarParaSecao } from '@/components/painel/rolar-para-secao'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { excecoesCadastradas, feriadosComComportamento } from '@/lib/feriados-unidade'
import { colunaDetalhe } from '@/lib/lista-detalhe'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'
import { valoresDadosUnidade } from '@/lib/unidade-form'

export const dynamic = 'force-dynamic'

const SECOES = [
  { id: 'dados', rotulo: 'Dados' },
  { id: 'horarios', rotulo: 'Horários' },
  { id: 'excecoes', rotulo: 'Exceções' },
  { id: 'espacos', rotulo: 'Espaços' },
] as const

function Secao(props: { id: string; titulo: string; children: React.ReactNode }) {
  // scroll-mt: a âncora para abaixo da barra e da navegação de seções, que ficam presas no topo
  return (
    <section id={props.id} aria-labelledby={`secao-${props.id}`} className="flex scroll-mt-32 flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 id={`secao-${props.id}`} className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.titulo}</h2>
      {props.children}
    </section>
  )
}

/** Unidade aberta: dados, horários, exceções e espaços numa página só, com âncoras (`?aba=` antigo rola até a seção). */
export default async function UnidadePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const s = await requireStaff()
  const { id } = await props.params
  const pedida = (await props.searchParams).aba
  const secao = SECOES.find((x) => x.id === pedida)?.id
  const db = getDb()
  const { restaurante, unidades } = await carregarUnidadesPainel(db, s.claims)
  const u = unidades.find((x) => x.id === id)
  if (!u) notFound() // inexistente ou fora das unidades permitidas (RLS)
  const espacos = await listarEspacos(db, s.claims, u.id)
  const somenteLeitura = s.role === 'atendente'
  const agora = new Date()
  return (
    <section aria-label={`Unidade ${u.nome}`} className={colunaDetalhe(true)}>
      <TopBar
        title={u.nome}
        subtitle="Dados, horários, exceções e espaços"
        className="lg:hidden" semFaixa
        action={
          <Link href="/unidades" aria-label="Voltar para unidades" className="flex size-11 items-center justify-center rounded-full text-foreground">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <div className="sticky top-[calc(4rem+1px+env(safe-area-inset-top))] z-20 border-b border-border bg-background/95 backdrop-blur lg:top-0">
        {/* ≥ lg: cabeçalho da coluna (a barra da tela é a do layout, "Unidades") */}
        <div className="hidden items-center gap-3 px-6 pt-3 lg:flex">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-foreground">{u.nome}</h2>
          <Link
            href="/unidades"
            scroll={false}
            aria-label="Fechar unidade"
            className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </Link>
        </div>
        <nav aria-label="Seções da unidade" className="overflow-x-auto px-4 lg:px-6">
          <ul className="flex gap-1">
            {SECOES.map((x) => (
              <li key={x.id}>
                <a
                  href={`#${x.id}`}
                  className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
                >
                  {x.rotulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-6 lg:max-w-3xl lg:px-6">
        <SeloUnidade selo={seloDaUnidade(u, restaurante.politicaFeriado, restaurante.timezone, agora)} />
        <Secao id="dados" titulo="Dados">
          {/* ids próprios: a folha "Nova unidade" (na lista ao lado) e a de espaço também têm um campo "nome" */}
          <DadosUnidadeForm idPrefixo="unidade-" inicial={valoresDadosUnidade(u)} acao={salvarDadosUnidadeAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        </Secao>
        <Secao id="horarios" titulo="Horários">
          <HorariosForm unitId={u.id} inicial={{ semanal: u.semanal }} acao={salvarHorariosAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        </Secao>
        <Secao id="excecoes" titulo="Exceções">
          <ExcecoesUnidade
            unitId={u.id}
            somenteLeitura={somenteLeitura}
            feriados={feriadosComComportamento(u, restaurante.politicaFeriado, restaurante.timezone, agora)}
            excecoes={excecoesCadastradas(u, restaurante.timezone, agora, restaurante.politicaFeriado).map((e) => {
              const x = u.excecoes[e.data]!
              return { ...e, inicial: { data: e.dataBr, fechado: x.fechado, turnos: x.turnos, motivo: x.motivo ?? '' } }
            })}
          />
        </Secao>
        <Secao id="espacos" titulo="Espaços">
          <Espacos unitId={u.id} somenteLeitura={somenteLeitura} espacos={espacos} />
        </Secao>
      </div>
      {secao && <RolarParaSecao id={secao} />}
    </section>
  )
}
