import { ListaDetalhe } from '@/components/shell/lista-detalhe'

/** Lista + detalhe (decisão 3): a lista vem do slot `@lista`; `children` é a conversa aberta (ou o estado vazio). */
export default function ConversasLayout(props: { children: React.ReactNode; lista: React.ReactNode }) {
  return (
    <ListaDetalhe titulo="Conversas" subtitulo="Atendimento da equipe pelo WhatsApp" lista={props.lista}>
      {props.children}
    </ListaDetalhe>
  )
}
