import { ListaDetalhe } from '@/components/shell/lista-detalhe'

/** Lista + detalhe (decisão 3): a lista vem do slot `@lista`; `children` é a unidade aberta (ou o estado vazio). */
export default function UnidadesLayout(props: { children: React.ReactNode; lista: React.ReactNode }) {
  return (
    <ListaDetalhe titulo="Unidades" subtitulo="Endereços, horários e exceções" lista={props.lista}>
      {props.children}
    </ListaDetalhe>
  )
}
