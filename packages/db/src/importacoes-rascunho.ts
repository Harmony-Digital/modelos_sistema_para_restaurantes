import {
  rascunhoCardapioImportacaoSchema, rascunhoEspacosSchema, rascunhoHorariosSchema, rascunhoInformacoesSchema, rascunhoSoPrecosSchema,
  type RascunhoCardapioImportacao, type RascunhoEspacos, type RascunhoHorarios, type RascunhoInformacoes, type RascunhoSoPrecos,
} from '@atd/core/importacao'
import type { ALVOS_IMPORTACAO, MODOS_IMPORTACAO } from './schema/s4.ts'

export type AlvoImportacao = (typeof ALVOS_IMPORTACAO)[number]
export type ModoImportacao = (typeof MODOS_IMPORTACAO)[number]

export type RascunhoDoAlvo =
  | { alvo: 'cardapio'; modo: 'completo'; draft: RascunhoCardapioImportacao }
  | { alvo: 'cardapio'; modo: 'so_precos'; draft: RascunhoSoPrecos }
  | { alvo: 'informacoes'; modo: 'completo'; draft: RascunhoInformacoes }
  | { alvo: 'horarios'; modo: 'completo'; draft: RascunhoHorarios }
  | { alvo: 'espacos'; modo: 'completo'; draft: RascunhoEspacos }

/** Mensagem do painel quando a leitura é válida mas não traz nada do alvo (nunca vira rascunho vazio). */
export const ERRO_VAZIO_POR_ALVO = {
  cardapio: 'Não encontrei itens de cardápio nesse arquivo.',
  so_precos: 'Não encontrei preços de itens nesse arquivo.',
  informacoes: 'Não encontrei informações nesse arquivo.',
  horarios: 'Não encontrei horários nesse arquivo.',
  espacos: 'Não encontrei espaços de evento nesse arquivo.',
} as const

/** Valida o rascunho pelo schema do alvo (e modo). Fora do formato ⇒ null. */
export function validarRascunho(alvo: AlvoImportacao, modo: ModoImportacao, draft: unknown): RascunhoDoAlvo | null {
  switch (alvo) {
    case 'cardapio': {
      if (modo === 'so_precos') {
        const d = rascunhoSoPrecosSchema.safeParse(draft)
        return d.success ? { alvo, modo, draft: d.data } : null
      }
      const d = rascunhoCardapioImportacaoSchema.safeParse(draft)
      return d.success ? { alvo, modo: 'completo', draft: d.data } : null
    }
    case 'informacoes': {
      const d = rascunhoInformacoesSchema.safeParse(draft)
      return d.success ? { alvo, modo: 'completo', draft: d.data } : null
    }
    case 'horarios': {
      const d = rascunhoHorariosSchema.safeParse(draft)
      return d.success ? { alvo, modo: 'completo', draft: d.data } : null
    }
    case 'espacos': {
      const d = rascunhoEspacosSchema.safeParse(draft)
      return d.success ? { alvo, modo: 'completo', draft: d.data } : null
    }
  }
}

/** Rascunho sem nada aproveitável do alvo. */
export function rascunhoVazio(r: RascunhoDoAlvo): boolean {
  switch (r.alvo) {
    case 'cardapio':
      return r.modo === 'so_precos' ? r.draft.itens.length === 0 : r.draft.categorias.every((c) => c.itens.length === 0)
    case 'informacoes':
      return r.draft.fatos.length === 0
    case 'horarios':
      return r.draft.unidades.every((u) => u.semana.length === 0 && u.excecoes.length === 0)
    case 'espacos':
      return r.draft.espacos.length === 0
  }
}

export const mensagemVazio = (alvo: AlvoImportacao, modo: ModoImportacao) =>
  alvo === 'cardapio' && modo === 'so_precos' ? ERRO_VAZIO_POR_ALVO.so_precos : ERRO_VAZIO_POR_ALVO[alvo]
