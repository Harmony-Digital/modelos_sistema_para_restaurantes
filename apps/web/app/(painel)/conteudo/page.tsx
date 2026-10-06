import { carregarUnidadesPainel, listarCardapio, listarFatos, listarLacunas, listarModelos, podeEditarCardapioGeral, withUserContext } from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { ArquivosCardapio } from '@/components/painel/arquivos-cardapio'
import { Cardapio } from '@/components/painel/cardapio'
import { ExcecoesItem } from '@/components/painel/excecoes-item'
import { Informacoes } from '@/components/painel/informacoes'
import { Modelos } from '@/components/painel/modelos'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'cardapio', rotulo: 'Cardápio' },
  { chave: 'sem-resposta', rotulo: 'Sem resposta' },
  { chave: 'informacoes', rotulo: 'Informações' },
  { chave: 'mensagens', rotulo: 'Mensagens' },
] as const
type Aba = (typeof ABAS)[number]['chave']

const SUBABAS = [
  { chave: 'itens', rotulo: 'Itens' },
  { chave: 'unidade', rotulo: 'Por unidade' },
  { chave: 'arquivos', rotulo: 'Arquivos' },
] as const

export default async function ConteudoPage(props: { searchParams: Promise<{ aba?: string; sub?: string }> }) {
  const s = await requireStaff()
  const { aba: pedida, sub: subPedida } = await props.searchParams
  const aba: Aba = ABAS.find((a) => a.chave === pedida)?.chave ?? 'sem-resposta'
  const sub = SUBABAS.find((a) => a.chave === subPedida)?.chave ?? 'itens'
  const db = getDb()
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  const opcoes = unidades.map((u) => ({ id: u.id, nome: u.nome }))
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar title="Conteúdo" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Abas rotulo="Seções de conteúdo" itens={ABAS.map((a) => ({ href: `/conteudo?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'cardapio' && (
          <>
            <Abas rotulo="Partes do cardápio" itens={SUBABAS.map((a) => ({ href: `/conteudo?aba=cardapio&sub=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === sub }))} />
            <SecaoCardapio sub={sub} s={s} unidades={unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))} />
          </>
        )}
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

async function SecaoCardapio(props: {
  sub: (typeof SUBABAS)[number]['chave']
  s: Awaited<ReturnType<typeof requireStaff>>
  unidades: { id: string; nome: string }[]
}) {
  const { s } = props
  const db = getDb()
  const [cardapio, geral] = await Promise.all([
    listarCardapio(db, s.claims),
    withUserContext(db, s.claims, (tx) => podeEditarCardapioGeral(tx)),
  ])
  const gestao = s.role !== 'atendente'
  if (props.sub === 'unidade') {
    return (
      <ExcecoesItem
        unidades={props.unidades}
        categorias={cardapio.categorias}
        itens={cardapio.itens}
        excecoes={cardapio.excecoes}
        podeEditar={gestao}
      />
    )
  }
  if (props.sub === 'arquivos') {
    return (
      <ArquivosCardapio
        unidades={props.unidades}
        podeEnviar={gestao}
        podeGeral={geral}
        arquivos={cardapio.arquivos.map(({ storagePath: _caminho, criadoEm, ...a }) => ({ ...a, criadoEm: criadoEm.toISOString() }))}
      />
    )
  }
  return (
    <Cardapio
      categorias={cardapio.categorias}
      itens={cardapio.itens}
      podeEditar={geral}
      avisoSemEdicao={
        gestao && !geral
          ? 'Categorias e itens são alterados pelo dono ou por gerente com acesso a todas as unidades. Você ajusta disponibilidade e preço da sua unidade em "Por unidade".'
          : undefined
      }
    />
  )
}
