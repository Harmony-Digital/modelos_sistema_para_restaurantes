import { ditaComoMudanca } from '../mudanca.ts'
import { encontrarUnidade } from '../s1/busca.ts'
import { resolverData } from '../s1/datas.ts'
import { feriadosNacionais, mapaFeriados } from '../s1/feriados.ts'
import {
  cruzaMeiaNoite, horarioDoDia, minutosDe, temHorarioCadastrado, type AgendaUnidade, type PoliticaFeriado, type Turno,
} from '../s1/horarios.ts'
import { asHora, ddmm, DIAS_SEMANA, formatarTurnos, quandoAbre, renderModelo, rotuloDoDia, type ChaveModelo } from '../s1/modelos.ts'
import { unidadesOrdenadas } from '../s1/resolver.ts'
import { agoraLocal, diaDaSemana, diasEntre, somarDias, type DataIso } from '../s1/tempo.ts'
import type { ContextoS1, ItemExtraido, UnidadeS1 } from '../s1/tipos.ts'
import { normalizarHorario } from './horario.ts'
import { MAX_PESSOAS, MIN_PESSOAS } from './pessoas.ts'
import type {
  AcaoS2, AvisoAtivoS2, CampoReserva, ContatoReserva, ContextoReserva, PerguntaReserva, ResultadoS2,
} from './tipos.ts'

/** Avisos só de hoje até hoje + 30 dias (fuso do restaurante). */
export const DIAS_AVISO = 30
/** No WhatsApp, "umas 20h" mandado às 20h05 (ou respondido depois na lista/pessoas) ainda vale. */
export const TOLERANCIA_PASSADO_IA_MIN = 60

export type ValidacaoAgenda = { ok: true } | { ok: false; motivo: 'fechada' | 'horario_fora' | 'horario_passado'; turnos?: Turno[] }

/**
 * A unidade abre na data e `hhmm` (se houver) cai num turno do dia — turno que cruza a meia-noite
 * vale até o fechamento na madrugada. Com `agora` (data e minuto no fuso do restaurante), recusa
 * também o horário de hoje que passou há mais de `toleranciaMin` minutos (IA: 60; painel: 0).
 * Compartilhada com o formulário do painel.
 */
export function validarAvisoNaAgenda(
  unidade: AgendaUnidade,
  data: DataIso,
  hhmm: string | null,
  politica: PoliticaFeriado,
  feriados: ReadonlyMap<DataIso, string>,
  agora?: { data: DataIso; minuto: number },
  toleranciaMin = 0,
): ValidacaoAgenda {
  const dia = horarioDoDia(unidade, data, politica, feriados)
  const min = hhmm === null ? null : minutosDe(hhmm)
  // a madrugada de um turno que cruza a meia-noite ainda está por vir
  const passou = (turnos: readonly Turno[]) =>
    !!agora && min !== null && data === agora.data && min < agora.minuto - toleranciaMin
    && !turnos.some((t) => cruzaMeiaNoite(t) && min < minutosDe(t.fecha))
  const PASSOU = { ok: false, motivo: 'horario_passado' } as const
  // sem horário cadastrado não dá para afirmar que está fechada: não bloqueia
  if (dia.origem === 'semanal' && !temHorarioCadastrado(unidade)) return passou([]) ? PASSOU : { ok: true }
  if (dia.turnos.length === 0) return { ok: false, motivo: 'fechada' }
  if (min === null) return { ok: true }
  const dentro = dia.turnos.some((t) => {
    const abre = minutosDe(t.abre)
    const fecha = minutosDe(t.fecha)
    return cruzaMeiaNoite(t) ? min >= abre || min < fecha : min >= abre && min < fecha
  })
  if (!dentro) return { ok: false, motivo: 'horario_fora', turnos: dia.turnos }
  return passou(dia.turnos) ? PASSOU : { ok: true }
}

/** Pergunta com o texto que a acompanha (null quando a pergunta é o corpo da lista de unidades). */
export type PerguntaReservaComTexto = PerguntaReserva & { texto: string | null }

/** Resultado antes da composição: a pergunta fica de fora até saber se há lista pendente. */
export type ParcialS2 = Omit<ResultadoS2, 'texto' | 'perguntarReserva'> & { trechos: string[]; pergunta: PerguntaReservaComTexto | null }

export const textoPessoas = (n: number) => (n === 1 ? '1 pessoa' : `${n} pessoas`)
export const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** Limite do nome da reserva (o mesmo da triage-v7). */
export const MAX_NOME_RESERVA = 80
/** Ofertas de outras unidades quando a pedida está lotada. */
const MAX_OUTRAS_UNIDADES = 3

/**
 * Nome da reserva como vai para o banco e para o resumo: só letras, espaços, apóstrofo, hífen e ponto (o texto vem do
 * LLM e volta para o cliente), até 80 caracteres. Sem letra ou com marcador de PII (`[TELEFONE]`) ⇒ null.
 */
export function limparNome(nome: string | null | undefined): string | null {
  if (!nome || /\[[A-Z]+\]/.test(nome)) return null
  const limpo = nome.normalize('NFC').replace(/[^\p{L}\p{M}' .-]/gu, ' ').replace(/\s+/g, ' ').trim()
  const cortado = limpo.slice(0, MAX_NOME_RESERVA).trim()
  return /\p{L}/u.test(cortado) ? cortado : null
}

const juntarNomes = (nomes: readonly string[]) =>
  (nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`)

/** Reserva com mais de 60 pessoas: segue como pedido de evento (S3), com o que o cliente já disse. */
export const ehGrupoDeEvento = (i: ItemExtraido): boolean =>
  i.servico === 'aviso_presenca' && i.tipo !== 'cancelar' && i.pessoas !== null && Number.isInteger(i.pessoas) && i.pessoas > MAX_PESSOAS

/** `unica`: a única reserva ativa, quando o cliente não disse unidade nem dia ("seremos 80"): o evento herda as duas. */
export const reservaComoEvento = (i: ItemExtraido, unica?: { unidade: string; data: DataIso } | null): ItemExtraido => ({
  ...i, servico: 'evento', tipo: 'pedido', convidados: i.pessoas, pessoas: null, horario: null, nome: null, contato_ok: null,
  ...(unica && !i.unidade && !i.data ? unica : {}),
})

/**
 * Resposta à pergunta pendente da reserva: o que o cliente disse agora vale, o resto vem do item guardado. `contato_ok`
 * só muda respondendo à pergunta de contato (na do número, um null da triagem mantém o "não" guardado). Cancelar ou
 * outro serviço não é continuação: volta o item recebido.
 */
export function continuarReserva(pergunta: PerguntaReserva, novo: ItemExtraido): ItemExtraido {
  if (novo.servico !== 'aviso_presenca' || novo.tipo === 'cancelar') return novo
  const g = pergunta.item
  const contato = pergunta.campo === 'contato' ? (novo.contato_ok ?? null)
    : pergunta.campo === 'contato_numero' ? (novo.contato_ok ?? g.contato_ok ?? null)
      : (g.contato_ok ?? null)
  return {
    ...g,
    tipo: 'registrar',
    unidade: novo.unidade ?? g.unidade,
    data: novo.data ?? g.data,
    pessoas: novo.pessoas ?? g.pessoas,
    horario: novo.horario ?? g.horario,
    nome: novo.nome ?? g.nome ?? null,
    contato_ok: contato,
  }
}

/**
 * Dias cuja ocupação o worker precisa ler antes de resolver (o `ContextoReserva.vagas`): o dia de cada reserva da
 * mensagem, ou o da única reserva ativa quando o cliente muda sem dizer unidade nem dia ("na verdade seremos 6").
 */
export function diasDaReserva(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
): DataIso[] {
  const local = agoraLocal(agora, ctx.timezone)
  const ano = Number(local.data.slice(0, 4))
  const feriados = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  const limite = somarDias(local.data, DIAS_AVISO)
  const ativos = avisos.filter((a) => a.data >= local.data)
  const dias = new Set<DataIso>()
  for (const i of itens) {
    if (i.servico !== 'aviso_presenca' || i.tipo === 'cancelar') continue
    if (!i.data) {
      // mudança sem dia ("troca para a Asa Norte"): o dia da única reserva
      if ((!i.unidade || ditaComoMudanca(i.tema)) && ativos.length === 1) dias.add(ativos[0]!.data)
      continue
    }
    const d = resolverData(i.data, local.data, feriados)
    if (d.ok && d.data >= local.data && d.data <= limite) dias.add(d.data)
  }
  return [...dias].sort()
}

/** Sem o contexto da reserva (evals e testes): sem lotação conhecida e sem regras. O worker sempre passa o seu. */
export const RESERVA_SEM_LOTACAO: ContextoReserva = { vagas: new Map(), regras: '' }

export function resolverItensS2(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
  reserva: ContextoReserva = RESERVA_SEM_LOTACAO,
): ParcialS2 {
  const rc = reserva
  const local = agoraLocal(agora, ctx.timezone)
  const ano = Number(local.data.slice(0, 4))
  const listaFeriados = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  const feriados = mapaFeriados(listaFeriados)
  const m = (chave: ChaveModelo, vars: Record<string, string> = {}) => renderModelo(chave, vars, ctx.modelos)
  const unidades = unidadesOrdenadas(ctx)
  const escolhida = escolhidaId ? (unidades.find((u) => u.id === escolhidaId) ?? null) : null
  const limite = somarDias(local.data, DIAS_AVISO)
  const rotulo = (d: DataIso) => rotuloDoDia(d, local.data, feriados.get(d) ?? null) // início de frase
  const nomeDe = (unitId: string) => unidades.find((u) => u.id === unitId)?.nome ?? 'outra unidade'
  const ordem = (unitId: string) => unidades.find((u) => u.id === unitId)?.ordem ?? Number.MAX_SAFE_INTEGER
  const ativos = avisos
    .filter((a) => a.data >= local.data)
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : ordem(a.unitId) - ordem(b.unitId)))

  const trechos: string[] = []
  const acoes: AcaoS2[] = []
  const pendenteUnidade: ItemExtraido[] = []
  const cancelados = new Set<string>()
  const trechoDaAcao = new Map<AcaoS2, number>() // reserva repetida na mesma mensagem troca o trecho junto com a ação
  let pergunta: PerguntaReservaComTexto | null = null
  let validos = 0
  let respondidos = 0

  /** Um campo por vez: só a primeira pergunta da mensagem vale; conta quando o cliente responder. */
  function perguntar(campo: CampoReserva, item: ItemExtraido, unitId: string | null, texto: string | null, tentativasNumero = 0): void {
    pergunta ??= { campo, item, unitId, tentativasNumero, texto }
  }

  /** Vagas livres para esta reserva (a própria, numa mudança, não conta); null = sem limite. */
  function livresPara(unitId: string, data: DataIso, propria: number): number | null {
    const v = rc.vagas.get(data)?.get(unitId)
    if (!v || v.capacidade === null) return null
    return Math.max(0, v.capacidade - (v.ocupadas - propria))
  }

  /** Lotado: (a) até 3 outras unidades abertas e com vaga no dia, (b) outro dia, (c) grupo menor se ainda cabe alguém. */
  function textoLotado(u: UnidadeS1, data: DataIso, n: number, livres: number | null): string {
    const partes = [m('reserva_lotada', { unidade: u.nome, quando: quandoAbre(data, local.data), pessoas: textoPessoas(n) })]
    const outras = unidades
      .filter((x) => x.id !== u.id && validarAvisoNaAgenda(x, data, null, ctx.politicaFeriado, feriados).ok)
      .filter((x) => {
        const l = livresPara(x.id, data, 0)
        return l === null || l >= n
      })
      .slice(0, MAX_OUTRAS_UNIDADES)
    if (outras.length) {
      partes.push(m('reserva_lotada_outras_unidades', { pessoas: textoPessoas(n), unidades: juntarNomes(outras.map((x) => x.nome)) }))
    }
    partes.push(m('reserva_lotada_outro_dia'))
    if (livres !== null && livres > 0) partes.push(m('reserva_lotada_grupo_menor', { unidade: u.nome, vagas: textoPessoas(livres) }))
    return partes.join(' ')
  }

  // contato_ok só da resposta à pergunta de contato; fora dela, o já guardado no pendente (defesa: o LLM pode inventar)
  const campoPendente = rc.pergunta?.campo ?? null
  const respondeContato = campoPendente === 'contato' || campoPendente === 'contato_numero'
  const contatoGuardado = rc.pergunta?.item.contato_ok ?? null
  const numero = campoPendente === 'contato_numero' ? rc.numero : undefined

  /** Mudança de dia ou unidade ("muda para domingo") com várias reservas: lista e explica (não adivinha qual). */
  function qualMudar(): void {
    validos++
    const linhas = ativos.map((a) => `• ${nomeDe(a.unitId)} — ${minuscula(rotulo(a.data))}, ${textoPessoas(a.pessoas)}`)
    trechos.push(m('reserva_qual_mudar', { linhas: linhas.join('\n'), exemplo: exemploCancelar(ativos[0]!) }))
  }

  /**
   * "muda minha reserva para domingo", "troca para a Asa Norte" (tema "mudanca" com unidade ou dia): com uma única
   * reserva ativa, é ela que muda (o que o cliente não disse vem dela); com várias, só quando o lugar dito é o de uma
   * delas e há algo a mudar. `undefined` = não é mudança de lugar; `null` = ambígua (já respondida com a lista).
   */
  function reservaQueMuda(entrada: ItemExtraido, mudaAlgo: boolean): AvisoAtivoS2 | null | undefined {
    if (!ditaComoMudanca(entrada.tema) || (!entrada.unidade && !entrada.data && !escolhida) || ativos.length === 0) return undefined
    if (ativos.length === 1) return ativos[0]!
    const u = escolhida ?? encontrarUnidade(entrada.unidade, unidades)
    const d = entrada.data ? resolverData(entrada.data, local.data, listaFeriados) : null
    const doLugar = ativos.filter((a) => (!u || a.unitId === u.id) && (!d?.ok || a.data === d.data))
    if (mudaAlgo && doLugar.length === 1 && (u || !entrada.unidade) && (d?.ok || !entrada.data)) return doLugar[0]!
    qualMudar()
    return null
  }

  function reservar(entrada: ItemExtraido): void {
    // "na verdade seremos 6": sem unidade nem dia, com uma única reserva e algo a mudar (pessoas, horário ou nome), é
    // mudança dessa reserva; sem nada a mudar ("quero fazer uma reserva"), é reserva nova e a coleta pergunta o que falta
    const mudaAlgo = entrada.pessoas !== null || !!normalizarHorario(entrada.horario).hhmm || !!limparNome(entrada.nome)
    const origem = reservaQueMuda(entrada, mudaAlgo)
    if (origem === null) return
    const unico = !escolhida && !entrada.unidade && !entrada.data && mudaAlgo && ativos.length === 1 ? ativos[0]! : null
    const doUnico = unico ? (unidades.find((x) => x.id === unico.unitId) ?? null) : null
    const daOrigem = origem ? (unidades.find((x) => x.id === origem.unitId) ?? null) : null
    // a mudança completa o lugar que o cliente não disse com o da reserva que muda
    const item = doUnico && unico ? { ...entrada, unidade: doUnico.nome, data: unico.data }
      : origem ? { ...entrada, unidade: entrada.unidade ?? (escolhida ? null : (daOrigem?.nome ?? null)), data: entrada.data ?? origem.data }
        : entrada
    let u: UnidadeS1 | null = doUnico ?? escolhida ?? encontrarUnidade(item.unidade, unidades)
    if (!u) {
      if (unidades.length === 0) {
        validos++
        trechos.push(m('lacuna'))
        return
      }
      if (unidades.length > 1) {
        pendenteUnidade.push(item) // a pergunta é o corpo da lista "Ver unidades"; conta quando o cliente escolher
        perguntar('unidade', item, null, null)
        return
      }
      u = unidades[0]!
    }
    // ordem fixa: unidade → data → pessoas → horário → nome → contato
    const base: ItemExtraido = { ...item, tipo: 'registrar', unidade: u.nome }
    const perguntaData = m('reserva_pergunta_data', { limite: ddmm(limite) })
    const d = item.data ? resolverData(item.data, local.data, listaFeriados) : null
    if (!d?.ok || d.data < local.data || d.data > limite) {
      perguntar('data', { ...base, data: null }, u.id, perguntaData)
      return
    }
    const data = d.data
    // fechada no dia: diz e pergunta outro dia (antes de pedir o resto)
    if (!validarAvisoNaAgenda(u, data, null, ctx.politicaFeriado, feriados).ok) {
      const fechada = m('horario_dia_fechado', { quando: rotulo(data), unidade: u.nome })
      perguntar('data', { ...base, data: null }, u.id, `${fechada} ${perguntaData}`)
      return
    }
    // mudança: a reserva do cliente nessa unidade e dia (ou a que muda de lugar) completa o que ele não repetiu
    const existente = avisos.find((a) => a.unitId === u.id && a.data === data) ?? origem ?? null
    // a vaga da própria reserva só conta no mesmo lugar; noutro dia ou unidade ela ocupa uma vaga nova
    const mesmaVaga = !!existente && existente.unitId === u.id && existente.data === data
    const comData: ItemExtraido = { ...base, data }

    const n = item.pessoas ?? existente?.pessoas ?? null
    if (n === null || !Number.isInteger(n) || n < MIN_PESSOAS) {
      perguntar('pessoas', { ...comData, pessoas: null }, u.id, m('reserva_pergunta_pessoas'))
      return
    }
    if (n > MAX_PESSOAS) {
      // o atendimento já leva o grupo grande para o evento; sozinho, o S2 só explica o limite
      validos++
      trechos.push(m('reserva_grupo_grande'))
      return
    }
    // lotação antes do resto: não pergunta horário, nome e contato para depois dizer que está cheio.
    // Diminuir nunca bloqueia; aumentar desconta a própria reserva.
    const livres = livresPara(u.id, data, mesmaVaga ? existente.pessoas : 0)
    if ((!mesmaVaga || n > existente.pessoas) && livres !== null && n > livres) {
      validos++
      respondidos++
      trechos.push(textoLotado(u, data, n, livres)) // nada é gravado
      // fica guardada com o que já foi dito e sem unidade fixa: a resposta às ofertas continua daqui (sem texto extra)
      const hhmm = normalizarHorario(item.horario ?? existente?.horario ?? null).hhmm
      const nome = limparNome(item.nome) ?? limparNome(existente?.nome)
      perguntar('lotado', { ...comData, pessoas: n, horario: hhmm, nome, contato_ok: null }, null, null)
      return
    }
    const comPessoas: ItemExtraido = { ...comData, pessoas: n }

    // horário herdado da reserva já foi aceito antes: não é recusado agora por "já passou" (no mesmo lugar e dia)
    const herdado = !item.horario && !!existente?.horario && mesmaVaga
    const h = normalizarHorario(item.horario ?? existente?.horario ?? null)
    const turnos = horarioDoDia(u, data, ctx.politicaFeriado, feriados).turnos
    const horarioFora = () => m('reserva_horario_fora', { quando: rotulo(data), unidade: u.nome, turnos: formatarTurnos(turnos) })
    if (!h.hhmm) {
      // "à noite" (ou nada): o horário do dia, se cadastrado, e a pergunta de novo
      const texto = h.livre && temHorarioCadastrado(u) && turnos.length ? horarioFora() : m('reserva_pergunta_horario')
      perguntar('horario', { ...comPessoas, horario: null }, u.id, texto)
      return
    }
    const v = validarAvisoNaAgenda(u, data, h.hhmm, ctx.politicaFeriado, feriados, herdado ? undefined : local, TOLERANCIA_PASSADO_IA_MIN)
    if (!v.ok) {
      perguntar('horario', { ...comPessoas, horario: null }, u.id, v.motivo === 'horario_passado' ? m('reserva_horario_passado') : horarioFora())
      return
    }
    const hhmm = h.hhmm
    const comHorario: ItemExtraido = { ...comPessoas, horario: hhmm }

    const nome = limparNome(item.nome) ?? limparNome(existente?.nome)
    if (!nome) {
      perguntar('nome', { ...comHorario, nome: null }, u.id, m('reserva_pergunta_nome'))
      return
    }
    const comNome: ItemExtraido = { ...comHorario, nome }

    // contato: a reserva existente mantém o seu; nova pergunta se pode usar o WhatsApp e, se não, pede o número
    let contato: ContatoReserva
    let avisoContato: string | null = null
    // na pergunta do número o "não" já foi dito: um null da triagem (só o número, mascarado) não volta à pergunta de contato
    const contatoOk = !respondeContato ? contatoGuardado : (item.contato_ok ?? (campoPendente === 'contato_numero' ? false : null))
    if (existente) contato = 'manter'
    else if (contatoOk === true) contato = 'whatsapp'
    else if (contatoOk === false) {
      const resposta = numero
      if (resposta?.valor) contato = { numero: resposta.valor }
      else if (resposta && resposta.tentativas >= 1) {
        // segunda falha: segue com o WhatsApp e avisa
        contato = 'whatsapp'
        avisoContato = m('reserva_contato_invalido_whatsapp')
      } else {
        const texto = resposta ? m('reserva_contato_invalido') : m('reserva_pergunta_contato_numero')
        perguntar('contato_numero', { ...comNome, contato_ok: false }, u.id, texto, resposta ? resposta.tentativas + 1 : 0)
        return
      }
    } else {
      perguntar('contato', { ...comNome, contato_ok: null }, u.id, m('reserva_pergunta_contato'))
      return
    }

    validos++
    respondidos++
    if (avisoContato) trechos.push(avisoContato)
    // mudança: "Reserva alterada" sem repetir as regras (já foram na reserva feita)
    const resumo = { unidade: u.nome, quando: minuscula(rotulo(data)), horario: asHora(hhmm), pessoas: textoPessoas(n), nome }
    const texto = existente ? m('reserva_alterada', resumo) : m('reserva_confirmada', { ...resumo, regras: rc.regras }).trim()
    const acao: AcaoS2 = {
      tipo: 'registrar', unitId: u.id, data, pessoas: n, horario: hhmm, nome, contato, atualiza: existente !== null,
      ...(existente ? { reservaId: existente.id } : {}),
      // corrida nas últimas vagas: o banco recusa e a resposta vira a de lotado (sem a oferta de grupo menor: as vagas mudaram)
      texto, textoSeLotado: textoLotado(u, data, n, null),
    }
    const anterior = acoes.findIndex((a) => a.tipo === 'registrar' && a.unitId === u.id && a.data === data)
    if (anterior >= 0) {
      // "em 4; digo, em 6": só o que será gravado aparece na resposta
      const i = trechoDaAcao.get(acoes[anterior]!)!
      trechoDaAcao.delete(acoes[anterior]!)
      acoes[anterior] = acao
      trechos[i] = texto
      trechoDaAcao.set(acao, i)
      respondidos--
      validos--
    } else {
      acoes.push(acao)
      trechoDaAcao.set(acao, trechos.push(texto) - 1)
    }
  }

  /** Frase completa que a triagem (sem histórico) entende: "cancela a reserva de sábado na unidade Asa Sul". */
  function exemploCancelar(a: AvisoAtivoS2): string {
    const delta = diasEntre(local.data, a.data)
    const dia = delta === 0 ? 'de hoje'
      : delta === 1 ? 'de amanhã'
        : delta < 7 ? `de ${DIAS_SEMANA[diaDaSemana(a.data)]!.toLowerCase()}`
          : `do dia ${ddmm(a.data)}`
    return `cancela a reserva ${dia} na unidade ${nomeDe(a.unitId)}`
  }

  function cancelar(item: ItemExtraido): void {
    validos++
    if (ativos.length === 0) {
      trechos.push(m('reserva_nao_encontrada'))
      return
    }
    const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
    const d = item.data ? resolverData(item.data, local.data, listaFeriados) : null
    const data = d?.ok ? d.data : null
    // o cliente disse a unidade ou o dia e não reconhecemos: filtrar sem esse dado cancelaria a reserva errada
    const naoReconhecido = (!escolhida && !!item.unidade && !u) || (!!item.data && !d?.ok)
    const candidatos = naoReconhecido ? [] : ativos.filter((a) => (!u || a.unitId === u.id) && (!data || a.data === data))
    if (candidatos.length === 1) {
      const a = candidatos[0]!
      if (cancelados.has(a.id)) {
        validos-- // repetido na mesma mensagem
        return
      }
      cancelados.add(a.id)
      const texto = m('reserva_cancelada', { unidade: nomeDe(a.unitId), quando: minuscula(rotulo(a.data)) })
      acoes.push({ tipo: 'cancelar', avisoId: a.id, texto, textoSeFalhar: m('reserva_nao_encontrada') })
      respondidos++
      trechos.push(texto)
      return
    }
    const lista = candidatos.length ? candidatos : ativos
    const linhas = lista.map((a) => `• ${nomeDe(a.unitId)} — ${minuscula(rotulo(a.data))}, ${textoPessoas(a.pessoas)}`)
    trechos.push(m('reserva_qual_cancelar', { linhas: linhas.join('\n'), exemplo: exemploCancelar(lista[0]!) }))
  }

  for (const item of itens) {
    if (item.servico !== 'aviso_presenca') continue
    if (item.tipo === 'cancelar') cancelar(item)
    else reservar(item)
  }
  return { trechos, acoes, pergunta, pendenteUnidade, validos, respondidos }
}

/** Junta os trechos sem repetir; a pergunta vai por último. */
export function comporTexto(partes: readonly (string | null)[]): string | null {
  const unicos = [...new Set(partes.filter((p): p is string => !!p))]
  return unicos.length ? unicos.join('\n\n') : null
}

/** A pergunta da reserva sai com a resposta, a menos que uma lista de unidade esteja pendente (um dado por vez). */
export function perguntaReservaVisivel(pergunta: PerguntaReservaComTexto | null, haListaPendente: boolean): PerguntaReservaComTexto | null {
  if (!pergunta) return null
  if (pergunta.campo === 'unidade') return pergunta // a própria lista pergunta
  return haListaPendente ? null : pergunta
}

export const perguntaReservaSemTexto = (p: PerguntaReservaComTexto | null): PerguntaReserva | null =>
  (p ? { campo: p.campo, item: p.item, unitId: p.unitId, tentativasNumero: p.tentativasNumero } : null)

export function resolverS2(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
  reserva?: ContextoReserva,
): ResultadoS2 {
  const { trechos, pergunta, ...r } = resolverItensS2(itens, ctx, agora, avisos, escolhidaId, reserva)
  const visivel = perguntaReservaVisivel(pergunta, r.pendenteUnidade.length > 0)
  return { ...r, texto: comporTexto([...trechos, visivel?.texto ?? null]), perguntarReserva: perguntaReservaSemTexto(visivel) }
}
