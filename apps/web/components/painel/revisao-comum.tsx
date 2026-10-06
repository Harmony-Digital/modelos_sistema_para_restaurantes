'use client'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { descartarImportacaoAction } from '@/app/(painel)/conteudo/importar-actions'
import { aplicarImportacaoAction } from '@/app/(painel)/conteudo/importar-alvo-actions'
import { Confirmar } from '@/components/painel/confirmar'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { formatarCentavos } from '@/lib/dinheiro'
import { urlImportarAlvo, type AlvoImportacaoTela, type ModoImportacaoTela } from '@/lib/importacao'

/** Partes comuns da revisão por alvo (Etapa 07): confirmar uma vez só, descartar e o resultado da aplicação. */

export type ContagemAplicada = { criados: number; atualizados: number; ignorados: number }

const TITULO: Record<AlvoImportacaoTela, string> = {
  cardapio: 'Cardápio atualizado',
  informacoes: 'Informações atualizadas',
  horarios: 'Horários atualizados',
  espacos: 'Espaços atualizados',
}
const DESTINO: Record<AlvoImportacaoTela, { href: string; rotulo: string }> = {
  cardapio: { href: '/conteudo?aba=cardapio&sub=itens', rotulo: 'Ver os itens do cardápio' },
  informacoes: { href: '/conteudo?aba=informacoes', rotulo: 'Ver as informações' },
  horarios: { href: '/unidades', rotulo: 'Ver as unidades' },
  espacos: { href: '/unidades', rotulo: 'Ver as unidades' },
}

export function textoResultado(alvo: AlvoImportacaoTela, modo: ModoImportacaoTela, r: ContagemAplicada): string {
  const ignorados = r.ignorados > 0 ? `, ${r.ignorados} ${r.ignorados === 1 ? 'ignorado' : 'ignorados'}` : ''
  if (modo === 'so_precos') return `Preços atualizados: ${r.atualizados} ${r.atualizados === 1 ? 'item' : 'itens'}${ignorados}`
  return `${TITULO[alvo]}: ${r.criados} novos, ${r.atualizados} atualizados${ignorados}`
}

/** Envia o rascunho editado a `aplicarImportacaoAction`; guarda síncrona contra clique duplo. */
export function useConfirmarImportacao(p: { id: string; alvo: AlvoImportacaoTela; modo: ModoImportacaoTela }) {
  const emAndamento = useRef(false)
  const [aplicando, setAplicando] = useState(false)
  const [erroGeral, setErroGeral] = useState<string | undefined>()
  const [resultado, setResultado] = useState<ContagemAplicada | null>(null)

  const confirmar = async (rascunho: () => unknown | null) => {
    if (emAndamento.current) return
    setErroGeral(undefined)
    const r0 = rascunho()
    // null: a tela já mostrou o que corrigir
    if (r0 === null) return
    emAndamento.current = true
    setAplicando(true)
    try {
      const r = await chamarAcao(() => aplicarImportacaoAction(p.id, { alvo: p.alvo, modo: p.modo, rascunho: r0 }))
      if (!r.ok) return setErroGeral(r.formError ?? 'Não foi possível aplicar agora. Tente de novo.')
      if (!r.data) return
      toast.success(textoResultado(p.alvo, p.modo, r.data))
      setResultado(r.data)
    } finally {
      emAndamento.current = false
      setAplicando(false)
    }
  }
  return { aplicando, erroGeral, setErroGeral, resultado, confirmar }
}

export function ResultadoImportacao(props: { alvo: AlvoImportacaoTela; modo: ModoImportacaoTela; r: ContagemAplicada; children?: React.ReactNode }) {
  const destino = DESTINO[props.alvo]
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p role="status" className="flex items-center gap-2 font-semibold text-foreground">
        <CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />
        {textoResultado(props.alvo, props.modo, props.r)}
      </p>
      {props.children}
      <div className="flex flex-wrap gap-4">
        <Link href={destino.href} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
          {destino.rotulo}
        </Link>
        <Link href={urlImportarAlvo(props.alvo)} className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">
          Nova importação
        </Link>
      </div>
    </div>
  )
}

/** Descartar com confirmação (rascunho, erro ou a importação ainda recebendo arquivos) e volta às importações do alvo. */
export function DescartarImportacao(props: { alvo: AlvoImportacaoTela; id: string; disabled?: boolean }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)

  const executarDescarte = async () => {
    const r = await chamarAcao(() => descartarImportacaoAction(props.id))
    if (!r.ok) {
      toast.error(r.formError ?? 'Não foi possível descartar agora.')
      return
    }
    setAberto(false)
    toast.success('Importação descartada')
    router.push(urlImportarAlvo(props.alvo))
  }

  return (
    <>
      <Button variant="outline" disabled={props.disabled} onClick={() => setAberto(true)}>Descartar</Button>
      <Confirmar
        aberto={aberto}
        onAbertoChange={setAberto}
        titulo="Descartar importação?"
        descricao="Nada do que foi enviado ou lido entra no cadastro. Você pode importar de novo depois."
        rotuloConfirmar="Descartar importação"
        rotuloAndamento="Descartando…"
        onConfirmar={executarDescarte}
      />
    </>
  )
}

/** Erro geral, aviso de permissão, Confirmar (só quem pode aplicar) e Descartar (com confirmação). */
export function AcoesRevisao(props: {
  alvo: AlvoImportacaoTela
  id: string
  podeAplicar: boolean
  aplicando: boolean
  erroGeral: string | undefined
  /** nada marcado para incluir */
  semIncluidos: boolean
  onConfirmar: () => void
}) {
  return (
    <>
      {props.erroGeral && <p role="alert" className="text-sm text-destructive">{props.erroGeral}</p>}
      {!props.podeAplicar && (
        <p className="text-sm text-muted-foreground">
          Só o dono, ou gerente com acesso a todas as unidades, confirma a importação. Você pode revisar ou descartá-la.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {props.podeAplicar && (
          <Button aria-busy={props.aplicando || undefined} disabled={props.aplicando || props.semIncluidos} onClick={props.onConfirmar}>
            {props.aplicando ? 'Aplicando…' : 'Confirmar importação'}
          </Button>
        )}
        <DescartarImportacao alvo={props.alvo} id={props.id} disabled={props.aplicando} />
      </div>
    </>
  )
}

/** Opções de unidade para os seletores: nomes das unidades ativas. */
export type UnidadeOpcao = { id: string; nome: string }

/** "R$ 1,00, R$ 2,00 e R$ 3,00" */
export const listaPrecos = (ps: number[]) =>
  ps.length <= 1 ? ps.map(formatarCentavos).join('') : `${ps.slice(0, -1).map(formatarCentavos).join(', ')} e ${formatarCentavos(ps.at(-1)!)}`

/** Aviso de preços diferentes lidos para o mesmo item (fotos/páginas diferentes). */
export function AvisoConflitoPreco({ precos }: { precos: number[] }) {
  if (precos.length < 2) return null
  return (
    <p className="flex items-start gap-2 rounded-md border border-border bg-secondary p-3 text-sm text-foreground">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>Preços diferentes nos arquivos: {listaPrecos(precos)}. Confira o preço.</span>
    </p>
  )
}

/** Linha de resumo no topo da revisão ("2 novos, 1 para atualizar"). */
export function Resumo({ partes }: { partes: [number, string, string][] }) {
  const texto = partes.filter(([n]) => n > 0).map(([n, um, varios]) => `${n} ${n === 1 ? um : varios}`).join(', ')
  return texto ? <p className="text-sm font-medium text-foreground">{texto}</p> : null
}
