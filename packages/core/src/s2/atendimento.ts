import { renderModelo } from '../s1/modelos.ts'
import { listaDeUnidades, resolverS1 } from '../s1/resolver.ts'
import type { ContextoS1, ItemExtraido, Lacuna } from '../s1/tipos.ts'
import { perguntaSemTexto, perguntaVisivel, resolverItensS3 } from '../s3/resolver.ts'
import type { EspacoS3Core, PedidoAtivoS3 } from '../s3/tipos.ts'
import { comporTexto, resolverItensS2 } from './resolver.ts'
import type { AvisoAtivoS2, ResultadoAtendimento } from './tipos.ts'

/** Dados do S3 lidos pelo worker antes de resolver (espaços ativos e pedidos do próprio cliente). */
export type ContextoAtendimentoS3 = { espacos: readonly EspacoS3Core[]; pedidos: readonly PedidoAtivoS3[] }

/**
 * Resolve S1 + S2 + S3 da mesma mensagem numa única resposta (texto, lista de unidade, ações de aviso e de evento).
 * Sem `s3`, itens de evento são resolvidos sem espaços cadastrados nem pedidos anteriores.
 */
export function resolverAtendimento(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
  s3?: ContextoAtendimentoS3,
): ResultadoAtendimento {
  const s1 = resolverS1(itens, ctx, agora, escolhidaId)
  const s2 = resolverItensS2(itens, ctx, agora, avisos, escolhidaId)
  const ev = resolverItensS3(itens, ctx, s3?.espacos ?? [], agora, s3?.pedidos ?? [], escolhidaId)
  const aguardando = new Set<ItemExtraido>([...s1.pendente, ...s2.pendenteUnidade, ...ev.pendenteUnidade])
  const pendente = itens.filter((i) => aguardando.has(i)) // uma só lista, na ordem da mensagem
  // um dado por vez: com lista pendente nenhuma outra pergunta sai; pessoas (S2) antes do evento
  const perguntarPessoas = pendente.length ? null : s2.perguntarPessoas
  const perguntaEvento = perguntaVisivel(ev.pergunta, pendente.length > 0 || perguntarPessoas !== null)
  const pergunta = perguntarPessoas ? renderModelo('aviso_pessoas', {}, ctx.modelos) : null
  const corpo = s1.pendente.length ? 'escolher_unidade' : s2.pendenteUnidade.length ? 'escolher_unidade_aviso' : 'evento_pergunta_unidade'
  const lacunas = new Map<string, Lacuna>([...s1.lacunas, ...ev.lacunas].map((l) => [`${l.chave}|${l.unitId ?? ''}`, l]))
  return {
    ...s1,
    texto: comporTexto([s1.texto, ...s2.trechos, ...ev.trechos, pergunta, perguntaEvento?.texto ?? null]),
    // só avisos esperando a unidade: "De qual unidade você quer saber?" não faz sentido
    lista: pendente.length ? listaDeUnidades(ctx, corpo) : null,
    pendente,
    lacunas: [...lacunas.values()],
    validos: s1.validos + s2.validos + ev.validos,
    respondidos: s1.respondidos + s2.respondidos + ev.respondidos,
    acoesS2: s2.acoes,
    perguntarPessoas,
    acoesS3: ev.acoes,
    perguntarEvento: perguntaSemTexto(perguntaEvento),
    handoff: ev.handoff,
  }
}
