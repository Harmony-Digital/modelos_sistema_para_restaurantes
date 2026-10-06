import Link from 'next/link'
import { z } from 'zod'
import {
  carregarUnidadesPainel, lerImportacao, listarCardapio, listarFatos, listarImportacoes, listarLacunas, listarModelos,
  podeEditarCardapioGeral, withUserContext,
} from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { ArquivosCardapio } from '@/components/painel/arquivos-cardapio'
import { Cardapio } from '@/components/painel/cardapio'
import { ExcecoesItem } from '@/components/painel/excecoes-item'
import { AcompanharImportacao, Importar } from '@/components/painel/importar'
import { Informacoes } from '@/components/painel/informacoes'
import { Modelos } from '@/components/painel/modelos'
import { RevisaoRascunho } from '@/components/painel/revisao-rascunho'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { URL_IMPORTAR } from '@/lib/importacao'
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
  { chave: 'importar', rotulo: 'Importar' },
] as const

export default async function ConteudoPage(props: { searchParams: Promise<{ aba?: string; sub?: string; imp?: string }> }) {
  const s = await requireStaff()
  const { aba: pedida, sub: subPedida, imp } = await props.searchParams
  const aba: Aba = ABAS.find((a) => a.chave === pedida)?.chave ?? 'sem-resposta'
  // Importar é só de dono/gerente (RLS de knowledge_documents)
  const subabas = SUBABAS.filter((a) => a.chave !== 'importar' || s.role !== 'atendente')
  const sub = subabas.find((a) => a.chave === subPedida)?.chave ?? 'itens'
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
            <Abas rotulo="Partes do cardápio" itens={subabas.map((a) => ({ href: `/conteudo?aba=cardapio&sub=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === sub }))} />
            <SecaoCardapio sub={sub} imp={imp} s={s} unidades={unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))} />
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
  imp: string | undefined
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
  if (props.sub === 'importar') {
    return <SecaoImportar imp={props.imp} s={s} cardapio={cardapio} geral={geral} unidades={props.unidades} />
  }
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

const linkClasse = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline'

/** Lista e formulários de importação; com `imp`, a importação escolhida no estado em que está. */
async function SecaoImportar(props: {
  imp: string | undefined
  s: Awaited<ReturnType<typeof requireStaff>>
  cardapio: Awaited<ReturnType<typeof listarCardapio>>
  geral: boolean
  unidades: { id: string; nome: string }[]
}) {
  const { s, cardapio } = props
  const db = getDb()
  const id = props.imp !== undefined && z.uuid().safeParse(props.imp).success ? props.imp : null
  const imp = id === null ? null : await lerImportacao(db, s.claims, id)
  if (!imp) {
    const lista = await listarImportacoes(db, s.claims)
    return (
      <>
        {props.imp !== undefined && <p role="alert" className="text-sm text-destructive">Não encontramos essa importação.</p>}
        <Importar
          importacoes={lista.map((i) => ({ id: i.id, origem: i.origem, mime: i.mime, status: i.status, criadoEm: i.criadoEm.toISOString() }))}
        />
      </>
    )
  }
  if (imp.status === 'enviado' || imp.status === 'processando' || imp.status === 'erro') {
    return <AcompanharImportacao id={imp.id} status={imp.status} erro={imp.erro} desde={imp.criadoEm.toISOString()} />
  }
  if (imp.status === 'rascunho' && imp.draft) {
    const nomeCategoria = new Map(cardapio.categorias.map((c) => [c.id, c.nome]))
    return (
      <RevisaoRascunho
        key={imp.id}
        id={imp.id}
        origem={imp.origem}
        rascunho={imp.draft}
        categoriasExistentes={cardapio.categorias.map((c) => ({ nome: c.nome, ativo: c.ativo }))}
        itensExistentes={cardapio.itens.map((i) => ({ categoria: nomeCategoria.get(i.categoryId) ?? '', nome: i.nome }))}
        unidades={props.unidades}
        podeAplicar={props.geral}
      />
    )
  }
  const texto = imp.status === 'aprovado'
    ? 'Esta importação já foi aplicada ao cardápio.'
    : imp.status === 'rejeitado'
      ? 'Esta importação foi descartada.'
      : 'Não foi possível abrir o rascunho desta importação. Envie o arquivo de novo.'
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p className="text-foreground">{texto}</p>
      <div className="flex flex-wrap gap-4">
        {imp.status === 'aprovado' && <Link href="/conteudo?aba=cardapio&sub=itens" className={linkClasse}>Ver os itens do cardápio</Link>}
        <Link href={URL_IMPORTAR} className={linkClasse}>Voltar às importações</Link>
      </div>
    </div>
  )
}
