/** O botão da barra superior pede a paleta de busca rápida sem depender de onde ela está montada. */
export const EVENTO_ABRIR_BUSCA = 'atd:abrir-busca'

export function abrirBusca() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_BUSCA))
}
