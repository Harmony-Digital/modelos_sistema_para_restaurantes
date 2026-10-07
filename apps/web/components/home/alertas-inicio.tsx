import { CircleCheck, FileWarning } from 'lucide-react'
import Link from 'next/link'
import type { AlertaPainel, PedidoTitular } from '@atd/db'
import { CartaoAlertasGastos } from '@/components/painel/alerta-gastos'
import { ALVOS_IMPORTACAO_TELA, urlImportacao, type AlvoImportacaoTela } from '@/lib/importacao'
import { contarPrazoLgpd } from '@/lib/privacidade'
import { CartaoPrazoLgpd } from './cartao-prazo-lgpd'
import { PerguntasSemResposta } from './perguntas-sem-resposta'

const LINK = 'inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 [@media(hover:hover)]:hover:underline'
const rotuloAlvo = (alvo: string) => ALVOS_IMPORTACAO_TELA.find((a) => a.chave === alvo)?.rotulo ?? 'Importação'
/** a importação abre na tela do alvo; alvo desconhecido cai no cardápio (a tela confere e leva ao certo) */
const alvoDaTela = (alvo: string): AlvoImportacaoTela => ALVOS_IMPORTACAO_TELA.find((a) => a.chave === alvo)?.chave ?? 'cardapio'

/** Importações cuja leitura parou: cada uma abre a tela de leitura dela, que oferece "Tentar de novo". */
function CartaoImportacoesParadas(props: { importacoes: readonly { id: string; alvo: AlvoImportacaoTela | string }[] }) {
  if (props.importacoes.length === 0) return null
  return (
    <section aria-labelledby="titulo-importacoes-paradas" className="flex flex-col gap-1 rounded-lg border border-warning bg-card p-4">
      <h2 id="titulo-importacoes-paradas" className="flex items-center gap-2 font-semibold text-foreground">
        <FileWarning aria-hidden="true" className="size-4 text-warning" /> Importação parada
      </h2>
      <p className="text-sm text-muted-foreground">A leitura não anda há mais de 10 minutos. Abra para tentar de novo.</p>
      <ul className="flex flex-col">
        {props.importacoes.map((i) => (
          <li key={i.id}>
            <Link href={urlImportacao(i.id, alvoDaTela(i.alvo))} className={LINK}>{rotuloAlvo(i.alvo)}: continuar a leitura</Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Coluna "Alertas" do Início (dono/gerente): gasto, prazo LGPD, importação parada e perguntas sem resposta, com os
 * cartões de sempre. Sem nada pendente, diz que está tudo em dia.
 */
export function AlertasInicio(props: {
  gastos: AlertaPainel[]
  pedidosLgpd: readonly Pick<PedidoTitular, 'prazo' | 'status'>[]
  importacoesParadas: readonly { id: string; alvo: AlvoImportacaoTela | string }[]
  lacunas: { id: string; chave: string; unidade: string | null; ocorrencias: number }[]
  agora: Date
}) {
  const lgpd = contarPrazoLgpd(props.pedidosLgpd, props.agora)
  const nenhum = props.gastos.length === 0 && lgpd.perto === 0 && lgpd.vencidos === 0
    && props.importacoesParadas.length === 0 && props.lacunas.length === 0
  return (
    <section aria-labelledby="titulo-alertas" className="flex min-w-0 flex-col gap-3">
      <h2 id="titulo-alertas" className="text-base font-semibold">Alertas</h2>
      {nenhum && (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 text-success" /> Nenhum alerta agora
        </p>
      )}
      <CartaoAlertasGastos alertas={props.gastos} />
      <CartaoPrazoLgpd pedidos={props.pedidosLgpd} agora={props.agora} />
      <CartaoImportacoesParadas importacoes={props.importacoesParadas} />
      {props.lacunas.length > 0 && <PerguntasSemResposta lacunas={props.lacunas} />}
    </section>
  )
}
