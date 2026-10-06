import { encontrarUnidade } from '../s1/busca.ts'
import { resolverData } from '../s1/datas.ts'
import { feriadosNacionais, mapaFeriados } from '../s1/feriados.ts'
import { ddmm, ddmmaaaa, DIAS_SEMANA, renderModelo, rotuloDoDia, type ChaveModelo } from '../s1/modelos.ts'
import { unidadesOrdenadas } from '../s1/resolver.ts'
import { agoraLocal, diaDaSemana, diasEntre, somarDias, type DataIso } from '../s1/tempo.ts'
import type { ContextoS1, ItemExtraido, Lacuna, UnidadeS1 } from '../s1/tipos.ts'
import { comporTexto, validarAvisoNaAgenda } from '../s2/resolver.ts'
import { MAX_CONVIDADOS, MIN_CONVIDADOS, normalizarTipoEvento, rotuloTipoEvento } from './tipo-evento.ts'
import type { AcaoS3, CampoPedido, EspacoS3Core, PedidoAtivoS3, PerguntaEvento, ResultadoS3 } from './tipos.ts'

/** Pedidos de evento de amanhã até hoje + 365 dias (fuso do restaurante). */
export const DIAS_EVENTO = 365
/** `item.espaco` quando o cliente disse que tanto faz ("pode ser qualquer um"); definido pela triagem v4. */
export const ESPACO_QUALQUER = '*'
/** Observação automática para a equipe: evento é privado, unidade fechada não bloqueia. */
export const OBSERVACAO_UNIDADE_FECHADA = 'Unidade fechada nesse dia pelo horário cadastrado'
export const LACUNA_ESPACOS = 'eventos:espacos'
/** Sem unidade citada, lista os espaços de todas as unidades só quando são poucas (como o S1). */
const MAX_UNIDADES_SEM_LISTA = 3

/** Pergunta com o texto que a acompanha (null quando a pergunta é o corpo da lista de unidades). */
export type PerguntaEventoComTexto = PerguntaEvento & { texto: string | null }

/** Resultado antes da composição: a pergunta fica de fora até saber se há lista pendente. */
export type ParcialS3 = Omit<ResultadoS3, 'texto' | 'perguntar'> & { trechos: string[]; pergunta: PerguntaEventoComTexto | null }

const textoConvidados = (n: number) => (n === 1 ? '1 convidado' : `${n} convidados`)
const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const comporta = (e: EspacoS3Core, n: number) => n >= e.capacidadeMin && n <= e.capacidadeMax
const PREFIXO_ESPACO = /^\s*(?:(?:o|no|na|do|da|pelo|pela)\s+)?(?:espa[cç]o|area|área)\s+/i

/** Espaço da unidade pelo nome que o cliente disse (mesma busca tolerante das unidades). */
function encontrarEspaco(texto: string, espacos: readonly EspacoS3Core[]): EspacoS3Core | null {
  const alvo = texto.replace(PREFIXO_ESPACO, '')
  const achado = encontrarUnidade(alvo, espacos.map((e) => ({ id: e.id, nome: e.nome, apelidos: [] as string[] })))
  return achado ? (espacos.find((e) => e.id === achado.id) ?? null) : null
}

export function resolverItensS3(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  espacos: readonly EspacoS3Core[],
  agora: Date,
  pedidos: readonly PedidoAtivoS3[],
  escolhidaId?: string,
): ParcialS3 {
  const local = agoraLocal(agora, ctx.timezone)
  const ano = Number(local.data.slice(0, 4))
  const listaFeriados = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1), ...feriadosNacionais(ano + 2)]
  const feriados = mapaFeriados(listaFeriados)
  const m = (chave: ChaveModelo, vars: Record<string, string> = {}) => renderModelo(chave, vars, ctx.modelos)
  const unidades = unidadesOrdenadas(ctx)
  const escolhida = escolhidaId ? (unidades.find((u) => u.id === escolhidaId) ?? null) : null
  const amanha = somarDias(local.data, 1)
  const limite = somarDias(local.data, DIAS_EVENTO)
  const rotulo = (d: DataIso) => rotuloDoDia(d, local.data, feriados.get(d) ?? null) // início de frase
  const nomeDe = (unitId: string) => unidades.find((u) => u.id === unitId)?.nome ?? 'outra unidade'
  const ordem = (unitId: string) => unidades.find((u) => u.id === unitId)?.ordem ?? Number.MAX_SAFE_INTEGER
  const porUnidadeENome = (a: EspacoS3Core, b: EspacoS3Core) =>
    ordem(a.unitId) - ordem(b.unitId) || nomeDe(a.unitId).localeCompare(nomeDe(b.unitId), 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR')
  const ativos = pedidos
    .filter((p) => p.data >= local.data)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : ordem(a.unitId) - ordem(b.unitId)))

  const trechos: string[] = []
  const acoes: AcaoS3[] = []
  const pendenteUnidade: ItemExtraido[] = []
  const lacunas = new Map<string, Lacuna>()
  const cancelados = new Set<string>()
  let pergunta: PerguntaEventoComTexto | null = null
  let handoff = false
  let validos = 0
  let respondidos = 0
  const lacuna = (chave: string, unitId: string | null) => lacunas.set(`${chave}|${unitId ?? ''}`, { chave, unitId })

  /** Um campo por vez: só a primeira pergunta da mensagem vale; conta quando o cliente responder. */
  function perguntar(campo: CampoPedido, item: ItemExtraido, unitId: string | null, texto: string | null): void {
    pergunta ??= { campo, item, unitId, texto }
  }

  function linhaEspaco(e: EspacoS3Core): string {
    const extras = [e.descricao, e.condicoes].map((s) => s?.trim()).filter(Boolean)
    return [`• ${e.nome} (${nomeDe(e.unitId)}) — ${e.capacidadeMin} a ${e.capacidadeMax} pessoas.`, ...extras].join(' ')
  }
  const listarEspacos = (lista: readonly EspacoS3Core[]) => m('evento_espacos', { linhas: [...lista].sort(porUnidadeENome).map(linhaEspaco).join('\n') })

  function pedido(item: ItemExtraido): void {
    let u: UnidadeS1 | null = escolhida ?? encontrarUnidade(item.unidade, unidades)
    if (!u) {
      if (unidades.length === 0) {
        validos++
        trechos.push(m('lacuna'))
        return
      }
      if (unidades.length > 1) {
        pendenteUnidade.push(item) // a pergunta é o corpo da lista "Ver unidades"
        perguntar('unidade', item, null, null)
        return
      }
      u = unidades[0]!
    }
    // ordem fixa: unidade → data → convidados → tipo (→ espaço, se o citado não comporta)
    const base: ItemExtraido = { ...item, tipo: 'pedido', unidade: u.nome }
    const d = item.data ? resolverData(item.data, local.data, listaFeriados) : null
    if (!d?.ok) {
      perguntar('data', { ...base, data: null }, u.id, m('evento_pergunta_data'))
      return
    }
    if (d.data < amanha || d.data > limite) {
      perguntar('data', { ...base, data: null }, u.id, m('evento_data_fora', { limite: ddmmaaaa(limite) }))
      return
    }
    const data = d.data
    // o cliente já tem pedido em andamento nesse dia e unidade ("quero o salão", pedido repetido): não duplica
    const existente = ativos.find((p) => p.unitId === u.id && p.data === data && (p.status === 'novo' || p.status === 'em_contato'))
    if (existente) {
      validos++
      respondidos++
      trechos.push(m('evento_ja_registrado', {
        tipo: rotuloTipoEvento(existente.tipo, null),
        convidados: textoConvidados(existente.convidados),
        unidade: u.nome,
        quando: minuscula(rotulo(data)),
      }))
      return
    }
    const comData: ItemExtraido = { ...base, data }
    const n = item.convidados
    if (n === null) {
      perguntar('convidados', comData, u.id, m('evento_pergunta_convidados'))
      return
    }
    if (!Number.isInteger(n) || n < MIN_CONVIDADOS || n > MAX_CONVIDADOS) {
      perguntar('convidados', { ...comData, convidados: null }, u.id, m('evento_convidados_invalido'))
      return
    }
    const tipo = normalizarTipoEvento(item.tipoEvento)
    if (!tipo) {
      perguntar('tipo', { ...comData, tipoEvento: null }, u.id, m('evento_pergunta_tipo'))
      return
    }

    const daUnidade = espacos.filter((e) => e.unitId === u.id)
    const cabem = daUnidade.filter((e) => comporta(e, n))
    let espaco: EspacoS3Core | null = null
    // não citado (ou citado e inexistente): registra sem espaço e mostra os que comportam o grupo
    let listar = item.espaco !== ESPACO_QUALQUER
    if (item.espaco && item.espaco !== ESPACO_QUALQUER) {
      const achado = encontrarEspaco(item.espaco, daUnidade)
      if (achado && !comporta(achado, n)) {
        const outros = cabem.filter((e) => e.id !== achado.id).sort(porUnidadeENome)
        const sugestoes = outros.length ? ` Para ${n} pessoas, sugiro: ${outros.map((e) => e.nome).join(', ')}.` : ''
        perguntar('espaco', { ...comData, espaco: null }, u.id, m('evento_espaco_capacidade', {
          espaco: achado.nome, min: String(achado.capacidadeMin), max: String(achado.capacidadeMax), sugestoes,
        }))
        return
      }
      if (achado) {
        espaco = achado
        listar = false
      }
    }

    if (acoes.some((a) => a.tipo === 'registrar_evento' && a.unitId === u.id && a.data === data)) return // repetido na mesma mensagem
    // evento é privado: unidade fechada no dia não bloqueia, só avisa a equipe
    const agenda = validarAvisoNaAgenda(u, data, null, ctx.politicaFeriado, feriados)
    const observacoes = !agenda.ok && agenda.motivo === 'fechada' ? OBSERVACAO_UNIDADE_FECHADA : null
    acoes.push({
      tipo: 'registrar_evento', unitId: u.id, spaceId: espaco?.id ?? null, data, convidados: n,
      tipoEvento: tipo.tipo, tipoTexto: tipo.texto, observacoes,
    })
    validos++
    respondidos++
    trechos.push(m('evento_registrado', {
      // nunca repete texto extraído pelo LLM (anti-injeção; "reserva confirmada"): `tipoTexto` fica só para a equipe
      tipo: rotuloTipoEvento(tipo.tipo, null),
      convidados: textoConvidados(n),
      unidade: u.nome,
      quando: minuscula(rotulo(data)),
      espaco: espaco ? `, no espaço ${espaco.nome}` : '',
    }))
    if (listar && cabem.length) trechos.push(listarEspacos(cabem))
  }

  /** Frase completa que a triagem entende: "cancela o pedido de evento de sábado na unidade Asa Sul". */
  function exemploCancelar(p: PedidoAtivoS3): string {
    const delta = diasEntre(local.data, p.data)
    const dia = delta === 0 ? 'de hoje'
      : delta === 1 ? 'de amanhã'
        : delta < 7 ? `de ${DIAS_SEMANA[diaDaSemana(p.data)]!.toLowerCase()}`
          : `do dia ${ddmm(p.data)}`
    return `cancela o pedido de evento ${dia} na unidade ${nomeDe(p.unitId)}`
  }

  function cancelar(item: ItemExtraido): void {
    validos++
    if (ativos.length === 0) {
      trechos.push(m('evento_nao_encontrado'))
      return
    }
    const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
    const d = item.data ? resolverData(item.data, local.data, listaFeriados) : null
    const data = d?.ok ? d.data : null
    // o cliente disse a unidade ou o dia e não reconhecemos: filtrar sem esse dado cancelaria o pedido errado
    const naoReconhecido = (!escolhida && !!item.unidade && !u) || (!!item.data && !d?.ok)
    const candidatos = naoReconhecido ? [] : ativos.filter((p) => (!u || p.unitId === u.id) && (!data || p.data === data))
    if (candidatos.length === 1) {
      const p = candidatos[0]!
      if (p.status === 'confirmado') {
        // confirmado pela equipe: a IA não desfaz; um humano assume
        handoff = true
        trechos.push(m('evento_confirmado_humano'))
        return
      }
      if (cancelados.has(p.id)) {
        validos-- // repetido na mesma mensagem
        return
      }
      cancelados.add(p.id)
      const texto = m('evento_cancelado', { unidade: nomeDe(p.unitId), quando: minuscula(rotulo(p.data)) })
      acoes.push({ tipo: 'cancelar_evento', pedidoId: p.id, texto, textoSeFalhar: m('evento_nao_encontrado') })
      respondidos++
      trechos.push(texto)
      return
    }
    const lista = candidatos.length ? candidatos : ativos
    const linhas = lista.map((p) =>
      `• ${nomeDe(p.unitId)} — ${minuscula(rotulo(p.data))}, ${textoConvidados(p.convidados)}, ${rotuloTipoEvento(p.tipo, null)}`)
    trechos.push(m('evento_qual_cancelar', { linhas: linhas.join('\n'), exemplo: exemploCancelar(lista[0]!) }))
  }

  function listarDaUnidade(item: ItemExtraido): void {
    const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
    if (!u && unidades.length > MAX_UNIDADES_SEM_LISTA) {
      pendenteUnidade.push(item) // conta quando o cliente escolher
      return
    }
    validos++
    const ids = new Set((u ? [u] : unidades).map((x) => x.id))
    const daqui = espacos.filter((e) => ids.has(e.unitId))
    if (daqui.length === 0) {
      lacuna(LACUNA_ESPACOS, u?.id ?? null)
      trechos.push(m('lacuna'))
      return
    }
    const n = item.convidados
    const cabem = n !== null && Number.isInteger(n) ? daqui.filter((e) => comporta(e, n)) : []
    respondidos++
    trechos.push(listarEspacos(cabem.length ? cabem : daqui))
  }

  for (const item of itens) {
    if (item.servico !== 'evento') continue
    if (item.tipo === 'cancelar') cancelar(item)
    else if (item.tipo === 'espacos') listarDaUnidade(item)
    else pedido(item) // 'pedido' ou sem tipo (triagens v2/v3)
  }
  return { trechos, acoes, pergunta, pendenteUnidade, handoff, lacunas: [...lacunas.values()], validos, respondidos }
}

/** A pergunta do pedido sai com a resposta, a menos que outra lista de unidade esteja pendente (um dado por vez). */
export function perguntaVisivel(pergunta: PerguntaEventoComTexto | null, haListaPendente: boolean): PerguntaEventoComTexto | null {
  if (!pergunta) return null
  if (pergunta.campo === 'unidade') return pergunta // a própria lista pergunta
  return haListaPendente ? null : pergunta
}

export const perguntaSemTexto = (p: PerguntaEventoComTexto | null): PerguntaEvento | null =>
  (p ? { campo: p.campo, item: p.item, unitId: p.unitId } : null)

export function resolverS3(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  espacos: readonly EspacoS3Core[],
  agora: Date,
  pedidos: readonly PedidoAtivoS3[],
  escolhidaId?: string,
): ResultadoS3 {
  const { trechos, pergunta, ...r } = resolverItensS3(itens, ctx, espacos, agora, pedidos, escolhidaId)
  const visivel = perguntaVisivel(pergunta, r.pendenteUnidade.length > 0)
  return { ...r, texto: comporTexto([...trechos, visivel?.texto ?? null]), perguntar: perguntaSemTexto(visivel) }
}
