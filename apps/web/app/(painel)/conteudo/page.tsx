import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  arquivosImportacao, carregarUnidadesPainel, lerImportacao, listarCardapio, listarFatos, listarImportacoes, listarLacunas, listarModelos,
  listarRespostasRapidas, podeEditarCardapioGeral, revisaoImportacao, withUserContext,
} from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { ArquivosCardapio } from '@/components/painel/arquivos-cardapio'
import { Cardapio } from '@/components/painel/cardapio'
import { ExcecoesItem } from '@/components/painel/excecoes-item'
import { AcompanharImportacao } from '@/components/painel/importar'
import { ArquivosImportacao, ImportarAlvo } from '@/components/painel/importar-alvo'
import { Informacoes } from '@/components/painel/informacoes'
import { Modelos } from '@/components/painel/modelos'
import { RespostasRapidas } from '@/components/painel/respostas-rapidas'
import { RevisaoEspacos, RevisaoHorarios, RevisaoInformacoes, RevisaoSoPrecos } from '@/components/painel/revisao-alvos'
import { RevisaoRascunho } from '@/components/painel/revisao-rascunho'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { ALVOS_IMPORTACAO_TELA, urlImportacao, urlImportarAlvo, type AlvoImportacaoTela } from '@/lib/importacao'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'cardapio', rotulo: 'Cardápio' },
  { chave: 'sem-resposta', rotulo: 'Sem resposta' },
  { chave: 'informacoes', rotulo: 'Informações' },
  { chave: 'mensagens', rotulo: 'Mensagens' },
  { chave: 'importar', rotulo: 'Importar' },
] as const
type Aba = (typeof ABAS)[number]['chave']

const SUBABAS = [
  { chave: 'itens', rotulo: 'Itens' },
  { chave: 'unidade', rotulo: 'Por unidade' },
  { chave: 'arquivos', rotulo: 'Arquivos' },
  { chave: 'importar', rotulo: 'Importar' },
] as const
/** Importar não é uma sub-aba de verdade: o link leva à aba Importar */
type SubAba = Exclude<(typeof SUBABAS)[number]['chave'], 'importar'>

type Staff = Awaited<ReturnType<typeof requireStaff>>

export default async function ConteudoPage(props: { searchParams: Promise<{ aba?: string; sub?: string; imp?: string; alvo?: string }> }) {
  const s = await requireStaff()
  const { aba: pedida, sub: subPedida, imp, alvo: alvoPedido } = await props.searchParams
  const db = getDb()
  // Importar: dono e gerente. Os outros alvos e a confirmação só com acesso a todas as unidades; o gerente restrito a
  // unidades envia, lê e revisa o cardápio (PDF, fotos e planilha), como na Etapa 05 (o banco confere em cada ação)
  const importa = s.role !== 'atendente'
  const geral = importa && (await withUserContext(db, s.claims, (tx) => podeEditarCardapioGeral(tx)))
  // endereço antigo (Cardápio → Importar, Etapa 05): leva à aba Importar
  if (importa && pedida === 'cardapio' && subPedida === 'importar') {
    redirect(imp !== undefined && z.uuid().safeParse(imp).success ? urlImportacao(imp) : urlImportarAlvo('cardapio'))
  }
  const abas = ABAS.filter((a) => a.chave !== 'importar' || importa)
  const aba: Aba = abas.find((a) => a.chave === pedida)?.chave ?? 'sem-resposta'
  const subabas = SUBABAS.filter((a) => a.chave !== 'importar' || importa)
  const sub: SubAba = (['itens', 'unidade', 'arquivos'] as const).find((c) => c === subPedida) ?? 'itens'
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  const opcoes = unidades.map((u) => ({ id: u.id, nome: u.nome }))
  const ativas = unidades.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }))
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar title="Conteúdo" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Abas rotulo="Seções de conteúdo" itens={abas.map((a) => ({ href: `/conteudo?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'cardapio' && (
          <>
            <Abas
              rotulo="Partes do cardápio"
              itens={subabas.map((a) => ({
                // Importar leva à aba Importar, já no cardápio
                href: a.chave === 'importar' ? urlImportarAlvo('cardapio') : `/conteudo?aba=cardapio&sub=${a.chave}`,
                rotulo: a.rotulo,
                ativo: a.chave === sub,
              }))}
            />
            <SecaoCardapio sub={sub} s={s} unidades={ativas} />
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
        {aba === 'importar' && (
          <SecaoImportar
            imp={imp}
            alvo={geral ? (ALVOS_IMPORTACAO_TELA.find((a) => a.chave === alvoPedido)?.chave ?? 'cardapio') : 'cardapio'}
            geral={geral}
            s={s}
            unidades={ativas}
          />
        )}
      </main>
    </>
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

const linkClasse = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline'

const NOME_ALVO: Record<AlvoImportacaoTela, string> = { cardapio: 'o cardápio', informacoes: 'as informações', horarios: 'os horários', espacos: 'os espaços' }
const DESTINO: Record<AlvoImportacaoTela, { href: string; rotulo: string }> = {
  cardapio: { href: '/conteudo?aba=cardapio&sub=itens', rotulo: 'Ver os itens do cardápio' },
  informacoes: { href: '/conteudo?aba=informacoes', rotulo: 'Ver as informações' },
  horarios: { href: '/unidades', rotulo: 'Ver as unidades' },
  espacos: { href: '/unidades', rotulo: 'Ver as unidades' },
}

/**
 * Aba Importar: seletor de alvo, nova importação (vários arquivos), planilha CSV do cardápio e histórico do alvo; com
 * `imp`, a importação no estado em que está (recebendo arquivos, lendo, revisão por alvo ou já resolvida).
 */
async function SecaoImportar(props: {
  imp: string | undefined
  alvo: AlvoImportacaoTela
  /** dono ou gerente com acesso a todas as unidades; senão (gerente restrito) só o cardápio, sem confirmar */
  geral: boolean
  s: Staff
  unidades: { id: string; nome: string }[]
}) {
  const { s } = props
  const db = getDb()
  const id = props.imp !== undefined && z.uuid().safeParse(props.imp).success ? props.imp : null
  const imp = id === null ? null : await lerImportacao(db, s.claims, id)
  const alvo = imp?.alvo ?? props.alvo
  const seletor = props.geral ? (
    <Abas rotulo="O que importar" itens={ALVOS_IMPORTACAO_TELA.map((a) => ({ href: urlImportarAlvo(a.chave), rotulo: a.rotulo, ativo: a.chave === alvo }))} />
  ) : null
  if (!imp) {
    const lista = await listarImportacoes(db, s.claims, { alvo })
    return (
      <>
        {seletor}
        {props.imp !== undefined && <p role="alert" className="text-sm text-destructive">Não encontramos essa importação.</p>}
        <ImportarAlvo
          alvo={alvo}
          restrito={!props.geral}
          importacoes={lista.map((i) => ({
            id: i.id, origem: i.origem, modo: i.modo, mime: i.mime, arquivos: i.arquivos, status: i.status, recebendo: i.recebendo,
            criadoEm: i.criadoEm.toISOString(),
          }))}
        />
      </>
    )
  }
  // Etapa 05: CSV ou um arquivo só (com caminho na linha) seguem a revisão e a aplicação do cardápio de antes
  const legado = imp.alvo === 'cardapio' && imp.modo === 'completo' && (imp.origem === 'csv' || imp.storagePath !== null)
  if (!props.geral && imp.alvo !== 'cardapio') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-foreground">Esta importação é do dono ou de gerente com acesso a todas as unidades.</p>
        <Link href={urlImportarAlvo('cardapio')} className={linkClasse}>Voltar às importações</Link>
      </div>
    )
  }
  if (imp.recebendo) {
    return (
      <>
        {seletor}
        <ArquivosImportacao id={imp.id} alvo={imp.alvo} modo={imp.modo} arquivos={await arquivosImportacao(db, s.claims, imp.id)} />
      </>
    )
  }
  if (imp.status === 'enviado' || imp.status === 'processando' || imp.status === 'erro') {
    return (
      <>
        {seletor}
        <AcompanharImportacao
          id={imp.id}
          status={imp.status}
          erro={imp.erro}
          desde={imp.criadoEm.toISOString()}
          titulo={imp.alvo === 'cardapio' ? 'Lendo o cardápio…' : 'Lendo os arquivos…'}
          lotes={legado ? undefined : { atual: imp.loteAtual, total: imp.lotesTotal }}
          voltar={urlImportarAlvo(imp.alvo)}
        />
      </>
    )
  }
  if (imp.status === 'rascunho') {
    const revisao = await revisaoDaImportacao(imp, legado, props.geral, s, props.unidades)
    if (revisao) return <>{seletor}{revisao}</>
  }
  const texto = imp.status === 'aprovado'
    ? 'Esta importação já foi aplicada.'
    : imp.status === 'rejeitado'
      ? 'Esta importação foi descartada.'
      : `Não foi possível abrir o rascunho desta importação. Envie os arquivos de novo para importar ${NOME_ALVO[imp.alvo]}.`
  return (
    <>
      {seletor}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-foreground">{texto}</p>
        <div className="flex flex-wrap gap-4">
          {imp.status === 'aprovado' && <Link href={DESTINO[imp.alvo].href} className={linkClasse}>{DESTINO[imp.alvo].rotulo}</Link>}
          <Link href={urlImportarAlvo(imp.alvo)} className={linkClasse}>Voltar às importações</Link>
        </div>
      </div>
    </>
  )
}

/** Tela de revisão do alvo; null se o rascunho não abre (formato inválido). */
async function revisaoDaImportacao(
  imp: NonNullable<Awaited<ReturnType<typeof lerImportacao>>>,
  legado: boolean,
  /** pode confirmar (dono ou gerente com acesso a todas as unidades) */
  geral: boolean,
  s: Staff,
  unidades: { id: string; nome: string }[],
): Promise<React.ReactNode | null> {
  const db = getDb()
  if (imp.alvo === 'cardapio' && imp.modo === 'completo') {
    if (!imp.draft) return null
    const cardapio = await listarCardapio(db, s.claims)
    const nomeCategoria = new Map(cardapio.categorias.map((c) => [c.id, c.nome]))
    // vários arquivos: o rascunho com os conflitos de preço vem da revisão por alvo
    const porAlvo = legado ? null : await revisaoImportacao(db, s.claims, imp.id)
    const rascunho = porAlvo?.alvo === 'cardapio' && porAlvo.modo === 'completo' && porAlvo.draft ? porAlvo.draft : imp.draft
    // vários arquivos: um deles pode virar o cardápio de envio (só quem confirma escolhe)
    const arquivosDeEnvio = legado || !geral ? [] : (await arquivosImportacao(db, s.claims, imp.id)).map(({ ordem, mime }) => ({ ordem, mime }))
    return (
      <RevisaoRascunho
        key={imp.id}
        id={imp.id}
        origem={imp.origem}
        porAlvo={!legado}
        arquivosDeEnvio={arquivosDeEnvio}
        rascunho={rascunho}
        categoriasExistentes={cardapio.categorias.map((c) => ({ nome: c.nome, ativo: c.ativo }))}
        itensExistentes={cardapio.itens.map((i) => ({
          categoria: nomeCategoria.get(i.categoryId) ?? '', nome: i.nome, precoCentavos: i.precoCentavos, descricao: i.descricao,
          tags: i.tags, outrosNomes: i.outrosNomes,
        }))}
        unidades={unidades}
        podeAplicar={geral}
      />
    )
  }
  const r = await revisaoImportacao(db, s.claims, imp.id)
  if (!r || r.draft === null) return null
  if (r.alvo === 'cardapio' && r.modo === 'so_precos') {
    return <RevisaoSoPrecos key={r.id} id={r.id} podeAplicar={geral} rascunho={r.draft} mudancas={r.mudancas} ignorados={r.ignorados} />
  }
  if (r.alvo === 'informacoes') {
    const fatos = await listarFatos(db, s.claims)
    return (
      <RevisaoInformacoes
        key={r.id}
        id={r.id}
        podeAplicar={geral}
        rascunho={r.draft}
        rotulos={r.fatos}
        unidades={unidades}
        fatosExistentes={fatos.map((f) => ({ tema: f.tema, unitId: f.unitId }))}
      />
    )
  }
  if (r.alvo === 'horarios') {
    return (
      <RevisaoHorarios key={r.id} id={r.id} podeAplicar={geral} rascunho={r.draft} rotulos={r.unidades} unidades={unidades} unidadesComHorario={r.unidadesComHorario} />
    )
  }
  if (r.alvo === 'espacos') {
    return (
      <RevisaoEspacos key={r.id} id={r.id} podeAplicar={geral} rascunho={r.draft} rotulos={r.espacos} unidades={unidades} espacosExistentes={r.espacosExistentes} />
    )
  }
  return null
}
