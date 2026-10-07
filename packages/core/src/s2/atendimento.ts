import { renderModelo } from '../s1/modelos.ts'
import { agoraLocal } from '../s1/tempo.ts'
import { listaDeUnidades, resolverS1 } from '../s1/resolver.ts'
import type { ContextoS1, ItemExtraido, Lacuna } from '../s1/tipos.ts'
import { perguntaSemTexto, perguntaVisivel, resolverItensS3 } from '../s3/resolver.ts'
import type { EspacoS3Core, PedidoAtivoS3, PerguntaEventoAdiada } from '../s3/tipos.ts'
import { resolverItensS4, type AchadosCardapio } from '../s4/resolver.ts'
import type { ResumoCardapio } from '../s4/tipos.ts'
import {
  comporTexto, ehGrupoDeEvento, perguntaReservaSemTexto, perguntaReservaVisivel, reservaComoEvento, resolverItensS2,
} from './resolver.ts'
import type { AvisoAtivoS2, ContextoReserva, ResultadoAtendimento } from './tipos.ts'

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
 * Resolve S1–S4 da mesma mensagem numa única resposta (texto, lista de unidade, ações de reserva, de evento e de cardápio).
 * Sem `s3`, itens de evento são resolvidos sem espaços cadastrados nem pedidos anteriores.
 * Sem `s4`, itens de cardápio recebem o "em breve" do S1 (worker antigo).
 * `reserva`: lotação do dia, regras e a pergunta pendente da reserva (o worker sempre passa; sem ela, sem lotação
 * conhecida e sem regras). O grupo de mais de 60 pessoas segue como pedido de evento.
 * Um dado por vez: lista de unidade > pergunta da reserva > pergunta do evento.
 */
/** A única reserva ativa (de hoje em diante), com a unidade pelo nome do banco; nenhuma ou várias ⇒ null. */
function unicaReserva(ctx: ContextoS1, agora: Date, avisos: readonly AvisoAtivoS2[]): { unidade: string; data: string } | null {
  const hoje = agoraLocal(agora, ctx.timezone).data
  const ativas = avisos.filter((a) => a.data >= hoje)
  const u = ativas.length === 1 ? ctx.unidades.find((x) => x.id === ativas[0]!.unitId) : undefined
  return u ? { unidade: u.nome, data: ativas[0]!.data } : null
}

export function resolverAtendimento(
  itensRecebidos: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
  s3?: ContextoAtendimentoS3,
  s4?: ContextoAtendimentoS4,
  reserva?: ContextoReserva,
): ResultadoAtendimento {
  const grupoGrande = itensRecebidos.some(ehGrupoDeEvento)
  const unica = grupoGrande ? unicaReserva(ctx, agora, avisos) : null
  const itens = grupoGrande ? itensRecebidos.map((i) => (ehGrupoDeEvento(i) ? reservaComoEvento(i, unica) : i)) : itensRecebidos
  // com o S4, o S1 não vê os itens de cardápio (sem "em breve"); a identidade dos itens se mantém para o pendente
  const s1 = resolverS1(s4 ? itens.filter((i) => i.servico !== 'cardapio') : itens, ctx, agora, escolhidaId)
  const s2 = resolverItensS2(itens, ctx, agora, avisos, escolhidaId, reserva)
  const ev = resolverItensS3(itens, ctx, s3?.espacos ?? [], agora, s3?.pedidos ?? [], escolhidaId)
  const card = s4
    ? resolverItensS4(itens, ctx, s4.achados, s4.resumo, s4.temArquivo, escolhidaId)
    : { trechos: [], acoes: [], lacunas: [], pendenteUnidade: [], validos: 0, respondidos: 0 }
  const aguardando = new Set<ItemExtraido>([...s1.pendente, ...s2.pendenteUnidade, ...ev.pendenteUnidade, ...card.pendenteUnidade])
  const pendente = itens.filter((i) => aguardando.has(i)) // uma só lista, na ordem da mensagem
  // um dado por vez: com lista pendente nenhuma outra pergunta sai; a da reserva (S2) antes da do evento
  const perguntaReserva = perguntaReservaVisivel(s2.pergunta, pendente.length > 0)
  const perguntaEvento = perguntaVisivel(ev.pergunta, pendente.length > 0 || perguntaReserva !== null)
  // escondida por outra pergunta (reserva ou lista de outro item): fica guardada para depois, nunca se perde
  const ep = ev.pergunta
  const perguntaEventoAdiada: PerguntaEventoAdiada | null = ep && !perguntaEvento && ep.campo !== 'unidade' && ep.texto
    ? { campo: ep.campo, item: ep.item, unitId: ep.unitId, texto: ep.texto }
    : null
  const corpo = s1.pendente.length || card.pendenteUnidade.length ? 'escolher_unidade'
    : s2.pendenteUnidade.length ? 'escolher_unidade_reserva' : 'evento_pergunta_unidade'
  const lacunas = new Map<string, Lacuna>([...s1.lacunas, ...ev.lacunas, ...card.lacunas].map((l) => [`${l.chave}|${l.unitId ?? ''}`, l]))
  const avisoGrupo = grupoGrande ? renderModelo('reserva_grupo_grande', {}, ctx.modelos) : null
  return {
    ...s1,
    texto: comporTexto([
      s1.texto, avisoGrupo, ...s2.trechos, ...ev.trechos, ...card.trechos, perguntaReserva?.texto ?? null, perguntaEvento?.texto ?? null,
    ]),
    // só reservas esperando a unidade: "De qual unidade você quer saber?" não faz sentido
    lista: pendente.length ? listaDeUnidades(ctx, corpo) : null,
    pendente,
    lacunas: [...lacunas.values()],
    validos: s1.validos + s2.validos + ev.validos + card.validos,
    respondidos: s1.respondidos + s2.respondidos + ev.respondidos + card.respondidos,
    acoesS2: s2.acoes,
    perguntarReserva: perguntaReservaSemTexto(perguntaReserva),
    acoesS3: ev.acoes,
    perguntarEvento: perguntaSemTexto(perguntaEvento),
    ...(perguntaEventoAdiada ? { perguntaEventoAdiada } : {}),
    handoff: ev.handoff,
    acoesS4: card.acoes,
  }
}

/**
 * Respondida a pergunta que veio antes (reserva, lista), faz a pergunta do evento que ficou adiada — se a nova resposta
 * não tiver outra pergunta (um dado por vez) nem passar para a equipe. Sem adiada, devolve o mesmo resultado.
 */
export function retomarPerguntaEvento(r: ResultadoAtendimento, adiada: PerguntaEventoAdiada | null | undefined): ResultadoAtendimento {
  if (!adiada || r.lista || r.perguntarReserva || r.perguntarEvento || r.handoff) return r
  return {
    ...r,
    texto: comporTexto([r.texto, adiada.texto]),
    perguntarEvento: { campo: adiada.campo, item: adiada.item, unitId: adiada.unitId },
  }
}
