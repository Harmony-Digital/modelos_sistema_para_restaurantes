import { redirect } from 'next/navigation'
import {
  carregarUnidadesPainel, listarCardapio, listarFatos, listarLacunas, listarModelos, listarRespostasRapidas, podeEditarCardapioGeral,
  withUserContext,
} from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { ArquivosCardapio } from '@/components/painel/arquivos-cardapio'
import { Cardapio } from '@/components/painel/cardapio'
import { ExcecoesItem } from '@/components/painel/excecoes-item'
import { Informacoes } from '@/components/painel/informacoes'
import { Modelos } from '@/components/painel/modelos'
import { RespostasRapidas } from '@/components/painel/respostas-rapidas'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { ABAS_CONTEUDO, abaDoConteudo, hrefDoConteudoAntigo } from '@/lib/conteudo'
import { getDb } from '@/lib/server/db'
import { BotaoImportar, CabecalhoImportar, SecaoImportar } from '@/components/painel/secao-importar'

export const dynamic = 'force-dynamic'

const SUBABAS = [
  { chave: 'itens', rotulo: 'Itens' },
  { chave: 'unidade', rotulo: 'Por unidade' },
  { chave: 'arquivos', rotulo: 'Arquivos' },
] as const
type SubAba = (typeof SUBABAS)[number]['chave']

type Staff = Awaited<ReturnType<typeof requireStaff>>

type Busca = { aba?: string; sub?: string; imp?: string; alvo?: string; importar?: string }

/** Conteúdo em três abas (Cardápio · Informações · Mensagens), cada uma com o seu "Importar" quando cabe. */
export default async function ConteudoPage(props: { searchParams: Promise<Busca> }) {
  const s = await requireStaff()
  const q = await props.searchParams
  const antigo = hrefDoConteudoAntigo(q)
  if (antigo) redirect(antigo)
  const db = getDb()
  const aba = abaDoConteudo(q.aba)
  // Importar: dono e gerente. Informações (e horários/espaços, em Unidades) só com acesso a todas as unidades; o gerente
  // restrito a unidades envia, lê e revisa o cardápio (PDF, fotos e planilha), como na Etapa 05 (o banco confere)
  const importa = s.role !== 'atendente'
  const geral = importa && (await withUserContext(db, s.claims, (tx) => podeEditarCardapioGeral(tx)))
  const importando = importa && q.importar === '1' && aba !== 'mensagens'
  const sub: SubAba = SUBABAS.find((c) => c.chave === q.sub)?.chave ?? 'itens'
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  const opcoes = unidades.map((u) => ({ id: u.id, nome: u.nome }))
  const ativas = unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))
  const somenteLeitura = s.role === 'atendente'
  const importador = (alvo: 'cardapio' | 'informacoes', titulo: string) => (
    <>
      <CabecalhoImportar titulo={titulo} fechar={`/conteudo?aba=${alvo}`} />
      <SecaoImportar imp={q.imp} alvo={alvo} geral={geral} s={s} unidades={ativas} />
    </>
  )
  return (
    <>
      <TopBar title="Conteúdo" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto flex max-w-xl lg:mx-0 lg:max-w-6xl lg:px-8 flex-col gap-4 px-4 py-6">
        <Abas
          rotulo="Seções de conteúdo"
          itens={ABAS_CONTEUDO.map((a) => ({ href: `/conteudo?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))}
        />
        {aba === 'cardapio' && (importando ? importador('cardapio', 'Importar cardápio') : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <Abas
                  rotulo="Partes do cardápio"
                  itens={SUBABAS.map((a) => ({ href: `/conteudo?aba=cardapio&sub=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === sub }))}
                />
              </div>
              {importa && <BotaoImportar alvo="cardapio" />}
            </div>
            {await SecaoCardapio({ sub, s, unidades: ativas })}
          </>
        ))}
        {aba === 'informacoes' && (importando ? importador('informacoes', 'Importar informações') : (
          <>
            {geral && <div className="flex justify-end"><BotaoImportar alvo="informacoes" /></div>}
            {await SecaoSemResposta({ somenteLeitura, unidades: opcoes, s })}
            <section aria-labelledby="titulo-informacoes" className="flex flex-col gap-3">
              <h2 id="titulo-informacoes" className="text-lg font-semibold tracking-tight text-foreground">Informações cadastradas</h2>
              <Informacoes somenteLeitura={somenteLeitura} unidades={opcoes} fatos={await listarFatos(db, s.claims)} />
            </section>
          </>
        ))}
        {aba === 'mensagens' && (
          <>
            <Modelos
              somenteLeitura={somenteLeitura}
              personalizados={await listarModelos(db, s.claims)}
              unidade={unidades.find((u) => u.ativo) ?? null}
            />
            <RespostasRapidas
              somenteLeitura={somenteLeitura}
              respostas={(await listarRespostasRapidas(db, s.claims)).map(({ id, titulo, texto, ativo }) => ({ id, titulo, texto, ativo }))}
            />
          </>
        )}
      </main>
    </>
  )
}

/** Pendências de Informações: perguntas que a IA não soube responder, com a ação "Responder" (cria a informação). */
async function SecaoSemResposta(props: { somenteLeitura: boolean; unidades: { id: string; nome: string }[]; s: Staff }) {
  const lacunas = await listarLacunas(getDb(), props.s.claims)
  return (
    <section aria-labelledby="titulo-sem-resposta" className="flex flex-col gap-3">
      <h2 id="titulo-sem-resposta" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
        Sem resposta
        {lacunas.length > 0 && (
          <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-foreground">{lacunas.length}</span>
        )}
      </h2>
      {lacunas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma pergunta sem resposta agora. Quando a IA não souber algo, a pergunta aparece aqui.</p>
      ) : (
        <SemResposta
          somenteLeitura={props.somenteLeitura}
          unidades={props.unidades}
          lacunas={lacunas.map((l) => ({ ...l, ultimaVez: l.ultimaVez.toISOString() }))}
        />
      )}
    </section>
  )
}

async function SecaoCardapio(props: { sub: SubAba; s: Staff; unidades: { id: string; nome: string }[] }) {
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
