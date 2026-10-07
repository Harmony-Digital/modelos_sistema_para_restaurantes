const CAMPOS_SEM_TEXTO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Foco num lugar onde a tecla é digitação (campo, área de texto, seleção, conteúdo editável). */
export function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof Element)) return false
  if (alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLSelectElement) return true
  if (alvo instanceof HTMLInputElement) return !CAMPOS_SEM_TEXTO.has(alvo.type)
  return alvo instanceof HTMLElement && (alvo.isContentEditable || alvo.getAttribute('contenteditable') === 'true' || alvo.getAttribute('contenteditable') === '')
}

/** Diálogos, menus, listas de opção e combobox abertos: o Esc e o typeahead são deles. */
const DONOS_DA_TECLA = [
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[role="combobox"]',
  '[data-radix-popper-content-wrapper]',
].join(', ')

/**
 * Atalhos de uma tecla só valem fora de campos de texto, fora de diálogos, menus e listas de opção abertos
 * (confirmação, folha, simulador, Select/Dropdown: o Esc e o typeahead são deles) e sem Ctrl/Cmd/Alt (atalhos do navegador e a busca rápida).
 */
export function ignorarAtalho(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return true
  if (ehCampoDeTexto(e.target)) return true
  return e.target instanceof Element && e.target.closest(DONOS_DA_TECLA) !== null
}
