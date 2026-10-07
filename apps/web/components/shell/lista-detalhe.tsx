import { TopBar } from './top-bar'

/**
 * Layout de segmento da lista + detalhe (Conversas, Unidades). ≥ lg: a tela inteira é uma coluna flex de altura fixa
 * (barra com o título da seção, faixa de alertas quando houver e, no resto, a lista e o detalhe lado a lado, cada
 * coluna com rolagem própria): a faixa não empurra o compositor para fora da tela nem cria uma segunda rolagem (as classes das colunas vêm de
 * `colunaLista`/`colunaDetalhe`, aplicadas pelas páginas, que sabem se há item aberto). < lg: cada página mostra a
 * própria barra e só uma das colunas aparece.
 */
export function ListaDetalhe(props: { titulo: string; subtitulo?: string; lista: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="lg:flex lg:h-dvh lg:flex-col">
      <TopBar title={props.titulo} {...(props.subtitulo && { subtitle: props.subtitulo })} className="hidden shrink-0 lg:block" />
      <div className="lg:flex lg:min-h-0 lg:flex-1">
        {props.lista}
        {props.children}
      </div>
    </div>
  )
}
