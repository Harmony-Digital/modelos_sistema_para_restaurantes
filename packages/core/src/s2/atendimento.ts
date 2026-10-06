import { renderModelo } from '../s1/modelos.ts'
import { listaDeUnidades, resolverS1 } from '../s1/resolver.ts'
import type { ContextoS1, ItemExtraido, Lacuna } from '../s1/tipos.ts'
import { perguntaSemTexto, perguntaVisivel, resolverItensS3 } from '../s3/resolver.ts'
import type { EspacoS3Core, PedidoAtivoS3 } from '../s3/tipos.ts'
import { resolverItensS4, type AchadosCardapio } from '../s4/resolver.ts'
import type { ResumoCardapio } from '../s4/tipos.ts'
import { comporTexto, resolverItensS2 } from './resolver.ts'
import type { AvisoAtivoS2, ResultadoAtendimento } from './tipos.ts'

/** Dados do S3 lidos pelo worker antes de resolver (espaços ativos e pedidos do próprio cliente). */
export type ContextoAtendimentoS3 = { espacos: readonly EspacoS3Core[]; pedidos: readonly PedidoAtivoS3[] }

/**
 * Dados do S4 lidos pelo worker antes de resolver: `achados` por índice do item em `itens` (resultado da busca),
 * o resumo do cardápio (sem arquivo) e se há arquivo ativo para a unidade (ou geral).
 */
export type ContextoAtendimentoS4 = {
  achados: AchadosCardapio
  resumo: ResumoCardapio
  temArquivo: (unitId: string | null) => boolean
}

/**
 * Resolve S1–S4 da mesma mensagem numa única resposta (texto, lista de unidade, ações de aviso, de evento e de cardápio).
 * Sem `s3`, itens de evento são resolvidos sem espaços cadastrados nem pedidos anteriores.
 * Sem `s4`, itens de cardápio recebem o "em breve" do S1 (worker antigo).
 */
export function resolverAtendimento(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
  s3?: ContextoAtendimentoS3,
  s4?: ContextoAtendimentoS4,
): ResultadoAtendimento {
  // com o S4, o S1 não vê os itens de cardápio (sem "em breve"); a identidade dos itens se mantém para o pendente
  const s1 = resolverS1(s4 ? itens.filter((i) => i.servico !== 'cardapio') : itens, ctx, agora, escolhidaId)
  const s2 = resolverItensS2(itens, ctx, agora, avisos, escolhidaId)
  const ev = resolverItensS3(itens, ctx, s3?.espacos ?? [], agora, s3?.pedidos ?? [], escolhidaId)
  const card = s4
    ? resolverItensS4(itens, ctx, s4.achados, s4.resumo, s4.temArquivo, escolhidaId)
    : { trechos: [], acoes: [], lacunas: [], pendenteUnidade: [], validos: 0, respondidos: 0 }
  const aguardando = new Set<ItemExtraido>([...s1.pendente, ...s2.pendenteUnidade, ...ev.pendenteUnidade, ...card.pendenteUnidade])
  const pendente = itens.filter((i) => aguardando.has(i)) // uma só lista, na ordem da mensagem
  // um dado por vez: com lista pendente nenhuma outra pergunta sai; pessoas (S2) antes do evento
  const perguntarPessoas = pendente.length ? null : s2.perguntarPessoas
  const perguntaEvento = perguntaVisivel(ev.pergunta, pendente.length > 0 || perguntarPessoas !== null)
  const pergunta = perguntarPessoas ? renderModelo('aviso_pessoas', {}, ctx.modelos) : null
  const corpo = s1.pendente.length || card.pendenteUnidade.length ? 'escolher_unidade'
    : s2.pendenteUnidade.length ? 'escolher_unidade_aviso' : 'evento_pergunta_unidade'
  const lacunas = new Map<string, Lacuna>([...s1.lacunas, ...ev.lacunas, ...card.lacunas].map((l) => [`${l.chave}|${l.unitId ?? ''}`, l]))
  return {
    ...s1,
    texto: comporTexto([s1.texto, ...s2.trechos, ...ev.trechos, ...card.trechos, pergunta, perguntaEvento?.texto ?? null]),
    // só avisos esperando a unidade: "De qual unidade você quer saber?" não faz sentido
    lista: pendente.length ? listaDeUnidades(ctx, corpo) : null,
    pendente,
    lacunas: [...lacunas.values()],
    validos: s1.validos + s2.validos + ev.validos + card.validos,
    respondidos: s1.respondidos + s2.respondidos + ev.respondidos + card.respondidos,
    acoesS2: s2.acoes,
    perguntarPessoas,
    acoesS3: ev.acoes,
    perguntarEvento: perguntaSemTexto(perguntaEvento),
    handoff: ev.handoff,
    acoesS4: card.acoes,
  }
}
