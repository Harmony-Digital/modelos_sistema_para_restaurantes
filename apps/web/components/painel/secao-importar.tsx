import { FileUp, X } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { arquivosImportacao, lerImportacao, listarCardapio, listarFatos, listarImportacoes, revisaoImportacao } from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { AcompanharImportacao } from '@/components/painel/importar'
import { ArquivosImportacao, ImportarAlvo } from '@/components/painel/importar-alvo'
import { RevisaoEspacos, RevisaoHorarios, RevisaoInformacoes, RevisaoSoPrecos } from '@/components/painel/revisao-alvos'
import { RevisaoRascunho } from '@/components/painel/revisao-rascunho'
import { buttonVariants } from '@/components/ui/button'
import type { requireStaff } from '@/lib/dal'
import { ALVOS_IMPORTACAO_TELA, alvosDaTela, urlImportacao, urlImportarAlvo, type AlvoImportacaoTela } from '@/lib/importacao'
import { getDb } from '@/lib/server/db'
import { cn } from '@/lib/utils'

type Staff = Awaited<ReturnType<typeof requireStaff>>

const linkClasse = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline'

const NOME_ALVO: Record<AlvoImportacaoTela, string> = { cardapio: 'o cardápio', informacoes: 'as informações', horarios: 'os horários', espacos: 'os espaços' }
const DESTINO: Record<AlvoImportacaoTela, { href: string; rotulo: string }> = {
  cardapio: { href: '/conteudo?aba=cardapio&sub=itens', rotulo: 'Ver os itens do cardápio' },
  informacoes: { href: '/conteudo?aba=informacoes', rotulo: 'Ver as informações' },
  horarios: { href: '/unidades', rotulo: 'Ver as unidades' },
  espacos: { href: '/unidades', rotulo: 'Ver as unidades' },
}

/** Botão "Importar" de cada tela (Cardápio, Informações, Unidades): abre o importador já no alvo da tela. */
export function BotaoImportar(props: { alvo: AlvoImportacaoTela; rotulo?: string }) {
  return (
    <Link href={urlImportarAlvo(props.alvo)} className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 shrink-0')}>
      <FileUp aria-hidden="true" className="size-4" />
      {props.rotulo ?? 'Importar'}
    </Link>
  )
}

/** Cabeçalho do importador aberto dentro de uma tela, com o "Fechar" que volta para ela. */
export function CabecalhoImportar(props: { titulo: string; fechar: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground">{props.titulo}</h2>
      <Link
        href={props.fechar}
        aria-label="Fechar importação"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground"
      >
        <X aria-hidden="true" className="size-5" />
      </Link>
    </div>
  )
}

/**
 * Importador (Etapa 07) aberto numa tela: nova importação (vários arquivos), planilha CSV do cardápio e histórico do
 * alvo; com `imp`, a importação no estado em que está (recebendo arquivos, lendo, revisão por alvo ou já resolvida).
 * Uma importação de outro alvo é levada à tela dela. Unidades importa horários e espaços (seletor entre os dois).
 */
export async function SecaoImportar(props: {
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
  const daTela = alvosDaTela(props.alvo)
  // importação de outro alvo: abre na tela certa (links antigos e o Início não sabem o alvo)
  if (imp && !daTela.includes(imp.alvo)) redirect(urlImportacao(imp.id, imp.alvo))
  const alvo = imp?.alvo ?? props.alvo
  if (!props.geral && alvo !== 'cardapio') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <p className="text-foreground">
          {imp ? 'Esta importação é do dono ou de gerente com acesso a todas as unidades.' : `Importar ${NOME_ALVO[alvo]} é do dono ou de gerente com acesso a todas as unidades.`}
        </p>
        <Link href={urlImportarAlvo('cardapio')} className={linkClasse}>Importar o cardápio</Link>
      </div>
    )
  }
  const seletor = daTela.length > 1 ? (
    <Abas
      rotulo="O que importar"
      itens={ALVOS_IMPORTACAO_TELA.filter((a) => daTela.includes(a.chave)).map((a) => ({ href: urlImportarAlvo(a.chave), rotulo: a.rotulo, ativo: a.chave === alvo }))}
    />
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
