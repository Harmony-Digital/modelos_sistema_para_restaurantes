import { TopBar } from './top-bar'

/**
 * Layout de segmento da lista + detalhe (Conversas, Unidades). ≥ lg: uma barra com o título da seção e, abaixo, a
 * lista e o detalhe lado a lado na altura da tela, cada coluna com rolagem própria (as classes das colunas vêm de
 * `colunaLista`/`colunaDetalhe`, aplicadas pelas páginas, que sabem se há item aberto). < lg: cada página mostra a
 * própria barra e só uma das colunas aparece.
 */
export function ListaDetalhe(props: { titulo: string; subtitulo?: string; lista: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <TopBar title={props.titulo} {...(props.subtitulo && { subtitle: props.subtitulo })} className="hidden lg:block" />
      <div className="lg:flex lg:h-[calc(100dvh-3.5rem-1px)]">
        {props.lista}
        {props.children}
      </div>
    </>
  )
}
