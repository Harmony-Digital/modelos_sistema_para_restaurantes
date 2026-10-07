/** O menu (lateral ou folha Mais) pede para abrir o simulador sem depender de onde o lançador está montado. */
export const EVENTO_ABRIR_SIMULADOR = 'atd:abrir-simulador'

export function abrirSimulador() {
  window.dispatchEvent(new Event(EVENTO_ABRIR_SIMULADOR))
}
