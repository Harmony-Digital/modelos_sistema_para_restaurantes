import { themes, type ThemeTokens } from './tokens.ts'

/** Variantes da etiqueta de status (texto mono caixa-alta). Cores só dos tokens existentes. */
export const VARIANTES_ETIQUETA = [
  'aguarda', 'ia', 'humano', 'novo', 'em_contato', 'confirmado', 'recusado', 'cancelado', 'encerrada', 'simulacao', 'erro', 'ok',
] as const
export type VarianteEtiqueta = (typeof VARIANTES_ETIQUETA)[number]
export type TomEtiqueta = 'aviso' | 'sucesso' | 'info' | 'destrutivo' | 'neutro'

export const TOM_DA_VARIANTE: Record<VarianteEtiqueta, TomEtiqueta> = {
  aguarda: 'aviso', novo: 'aviso',
  ia: 'sucesso', confirmado: 'sucesso', ok: 'sucesso',
  humano: 'info', em_contato: 'info',
  erro: 'destrutivo',
  recusado: 'neutro', cancelado: 'neutro', encerrada: 'neutro', simulacao: 'neutro',
}

/** Opacidade do fundo tingido por tema; medida em `etiquetas.test.ts` (texto ≥ 4,5:1 sobre cartão e fundo). */
export const ALFA_FUNDO: Record<'escuro' | 'claro', Record<TomEtiqueta, number>> = {
  claro: { aviso: 0.08, sucesso: 0.08, info: 0.08, destrutivo: 0.08, neutro: 0.08 },
  escuro: { aviso: 0.12, sucesso: 0.12, info: 0.12, destrutivo: 0.12, neutro: 0.08 },
}

/** Classes literais (o Tailwind precisa enxergá-las); o alfa bate com `ALFA_FUNDO` (conferido no teste). */
export const CLASSE_TOM: Record<TomEtiqueta, string> = {
  aviso: 'border-warning/40 bg-warning/8 text-warning dark:bg-warning/12',
  sucesso: 'border-success/40 bg-success/8 text-success dark:bg-success/12',
  info: 'border-info/40 bg-info/8 text-info dark:bg-info/12',
  destrutivo: 'border-destructive/40 bg-destructive/8 text-destructive dark:bg-destructive/12',
  neutro: 'border-border bg-muted-foreground/8 text-muted-foreground dark:bg-muted-foreground/8',
}

const TOKEN_DO_TOM: Record<TomEtiqueta, keyof ThemeTokens> = {
  aviso: 'warning', sucesso: 'success', info: 'info', destrutivo: 'destructive', neutro: 'mutedForeground',
}

/** Cor `cor` com opacidade `alfa` sobre `fundo` (#RRGGBB). */
export function misturar(cor: string, fundo: string, alfa: number): string {
  const canal = (hex: string, i: number) => parseInt(hex.replace('#', '').slice(i, i + 2), 16)
  return '#' + [0, 2, 4].map((i) => Math.round(canal(cor, i) * alfa + canal(fundo, i) * (1 - alfa)).toString(16).padStart(2, '0')).join('')
}

export function paresEtiqueta(tema: 'escuro' | 'claro') {
  const t = themes[tema]
  return (Object.keys(TOKEN_DO_TOM) as TomEtiqueta[]).flatMap((tom) => {
    const cor = t[TOKEN_DO_TOM[tom]]
    return (['card', 'background'] as const).map((sup) => ({
      nome: `etiqueta ${tom}/${sup === 'card' ? 'cartão' : 'fundo'}`,
      texto: cor,
      fundo: misturar(cor, t[sup], ALFA_FUNDO[tema][tom]),
    }))
  })
}
