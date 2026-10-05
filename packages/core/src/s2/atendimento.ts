import { renderModelo } from '../s1/modelos.ts'
import { listaDeUnidades, resolverS1 } from '../s1/resolver.ts'
import type { ContextoS1, ItemExtraido } from '../s1/tipos.ts'
import { comporTexto, resolverItensS2 } from './resolver.ts'
import type { AvisoAtivoS2, ResultadoAtendimento } from './tipos.ts'

/** Resolve S1 + S2 da mesma mensagem numa única resposta (texto, lista de unidade, ações de aviso). */
export function resolverAtendimento(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
): ResultadoAtendimento {
  const s1 = resolverS1(itens, ctx, agora, escolhidaId)
  const s2 = resolverItensS2(itens, ctx, agora, avisos, escolhidaId)
  const aguardando = new Set<ItemExtraido>([...s1.pendente, ...s2.pendenteUnidade])
  const pendente = itens.filter((i) => aguardando.has(i)) // uma só lista, na ordem da mensagem
  const perguntarPessoas = pendente.length ? null : s2.perguntarPessoas
  const pergunta = perguntarPessoas ? renderModelo('aviso_pessoas', {}, ctx.modelos) : null
  return {
    ...s1,
    texto: comporTexto([s1.texto, ...s2.trechos, pergunta]),
    lista: pendente.length ? listaDeUnidades(ctx) : null,
    pendente,
    validos: s1.validos + s2.validos,
    respondidos: s1.respondidos + s2.respondidos,
    acoesS2: s2.acoes,
    perguntarPessoas,
  }
}
