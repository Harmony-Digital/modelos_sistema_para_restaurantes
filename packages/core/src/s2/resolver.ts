import { encontrarUnidade } from '../s1/busca.ts'
import { resolverData } from '../s1/datas.ts'
import { feriadosNacionais, mapaFeriados } from '../s1/feriados.ts'
import {
  cruzaMeiaNoite, horarioDoDia, minutosDe, temHorarioCadastrado, type AgendaUnidade, type PoliticaFeriado, type Turno,
} from '../s1/horarios.ts'
import { dasHora, ddmm, DIAS_SEMANA, formatarTurnos, renderModelo, rotuloDoDia, type ChaveModelo } from '../s1/modelos.ts'
import { unidadesOrdenadas } from '../s1/resolver.ts'
import { agoraLocal, diaDaSemana, diasEntre, somarDias, type DataIso } from '../s1/tempo.ts'
import type { ContextoS1, ItemExtraido, UnidadeS1 } from '../s1/tipos.ts'
import { normalizarHorario } from './horario.ts'
import { MAX_PESSOAS, MIN_PESSOAS } from './pessoas.ts'
import type { AcaoS2, AvisoAtivoS2, PerguntaPessoas, ResultadoS2 } from './tipos.ts'

/** Avisos só de hoje até hoje + 30 dias (fuso do restaurante). */
export const DIAS_AVISO = 30

export type ValidacaoAgenda = { ok: true } | { ok: false; motivo: 'fechada' | 'horario_fora' | 'horario_passado'; turnos?: Turno[] }

/**
 * A unidade abre na data e `hhmm` (se houver) cai num turno do dia — turno que cruza a meia-noite
 * vale até o fechamento na madrugada. Com `agora` (data e minuto no fuso do restaurante), recusa
 * também o horário de hoje que já passou. Compartilhada com o formulário do painel.
 */
export function validarAvisoNaAgenda(
  unidade: AgendaUnidade,
  data: DataIso,
  hhmm: string | null,
  politica: PoliticaFeriado,
  feriados: ReadonlyMap<DataIso, string>,
  agora?: { data: DataIso; minuto: number },
): ValidacaoAgenda {
  const dia = horarioDoDia(unidade, data, politica, feriados)
  const min = hhmm === null ? null : minutosDe(hhmm)
  // a madrugada de um turno que cruza a meia-noite ainda está por vir
  const passou = (turnos: readonly Turno[]) =>
    !!agora && min !== null && data === agora.data && min < agora.minuto
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

/** Resultado antes da composição: a pergunta de pessoas fica de fora até saber se há lista pendente. */
export type ParcialS2 = Omit<ResultadoS2, 'texto'> & { trechos: string[] }

const textoPessoas = (n: number) => (n === 1 ? '1 pessoa' : `${n} pessoas`)
const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function resolverItensS2(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
): ParcialS2 {
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
  let perguntarPessoas: PerguntaPessoas | null = null
  const trechoDaAcao = new Map<AcaoS2, number>() // registrar repetido na mesma mensagem troca o trecho junto com a ação
  let validos = 0
  let respondidos = 0

  function registrar(entrada: ItemExtraido): void {
    // "na verdade seremos 6": sem unidade nem dia e com um único aviso ativo, é atualização desse aviso
    const unico = !escolhida && !entrada.unidade && !entrada.data && ativos.length === 1 ? ativos[0]! : null
    const doUnico = unico ? (unidades.find((x) => x.id === unico.unitId) ?? null) : null
    const item = doUnico && unico
      ? { ...entrada, unidade: doUnico.nome, data: unico.data, horario: entrada.horario ?? unico.horarioAprox }
      : entrada
    let u: UnidadeS1 | null = doUnico ?? escolhida ?? encontrarUnidade(item.unidade, unidades)
    if (!u) {
      if (unidades.length === 0) {
        validos++
        trechos.push(m('lacuna'))
        return
      }
      if (unidades.length > 1) {
        pendenteUnidade.push(item) // conta quando o cliente escolher
        return
      }
      u = unidades[0]!
    }
    let data = local.data
    if (item.data) {
      const d = resolverData(item.data, local.data, listaFeriados)
      if (!d.ok) {
        validos++
        trechos.push(m('data_nao_entendida'))
        return
      }
      data = d.data
    }
    if (data < local.data || data > limite) {
      validos++
      trechos.push(m('aviso_data_fora', { limite: ddmm(limite) }))
      return
    }
    const n = item.pessoas
    if (n !== null && (!Number.isInteger(n) || n < MIN_PESSOAS || n > MAX_PESSOAS)) {
      validos++
      trechos.push(m('aviso_pessoas_invalido'))
      return
    }
    const h = normalizarHorario(item.horario)
    // agenda antes de perguntar pessoas: não pergunta para depois dizer que está fechada
    const v = validarAvisoNaAgenda(u, data, h.hhmm, ctx.politicaFeriado, feriados, local)
    if (!v.ok) {
      validos++
      trechos.push(
        v.motivo === 'fechada'
          ? m('aviso_unidade_fechada', { quando: rotulo(data), unidade: u.nome })
          : v.motivo === 'horario_passado'
            ? m('aviso_horario_passado')
            : m('aviso_horario_fora', { quando: rotulo(data), unidade: u.nome, turnos: formatarTurnos(v.turnos ?? []) }),
      )
      return
    }
    if (n === null) {
      // guarda com unidade e data resolvidas: a resposta curta ("4") reaproveita o item; conta quando responder
      // o id da unidade vai junto: a resposta curta não depende de achar a unidade pelo nome de novo
      perguntarPessoas ??= { item: { ...item, unidade: u.nome, data }, unitId: u.id }
      return
    }
    const anterior = acoes.findIndex((a) => a.tipo === 'registrar' && a.unitId === u.id && a.data === data)
    const atualiza = avisos.some((a) => a.unitId === u.id && a.data === data)
    const acao: AcaoS2 = { tipo: 'registrar', unitId: u.id, data, pessoas: n, horarioAprox: h.hhmm ?? h.livre, atualiza }
    validos++
    respondidos++
    const horario = h.hhmm ? `, por volta ${dasHora(h.hhmm)}` : h.livre ? `, ${h.livre}` : ''
    const trecho = m(atualiza ? 'aviso_atualizado' : 'aviso_registrado', {
      unidade: u.nome, quando: minuscula(rotulo(data)), pessoas: textoPessoas(n), horario,
    })
    if (anterior >= 0) {
      // "em 4; digo, em 6": só o que será gravado aparece na resposta
      const i = trechoDaAcao.get(acoes[anterior]!)!
      trechoDaAcao.delete(acoes[anterior]!)
      acoes[anterior] = acao
      trechos[i] = trecho
      trechoDaAcao.set(acao, i)
    } else {
      acoes.push(acao)
      trechoDaAcao.set(acao, trechos.push(trecho) - 1)
    }
  }

  /** Frase completa que a triagem (sem histórico) entende: "cancela o aviso de sábado na unidade Asa Sul". */
  function exemploCancelar(a: AvisoAtivoS2): string {
    const delta = diasEntre(local.data, a.data)
    const dia = delta === 0 ? 'de hoje'
      : delta === 1 ? 'de amanhã'
        : delta < 7 ? `de ${DIAS_SEMANA[diaDaSemana(a.data)]!.toLowerCase()}`
          : `do dia ${ddmm(a.data)}`
    return `cancela o aviso ${dia} na unidade ${nomeDe(a.unitId)}`
  }

  function cancelar(item: ItemExtraido): void {
    if (ativos.length === 0) {
      validos++
      trechos.push(m('aviso_nao_encontrado'))
      return
    }
    const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
    const d = item.data ? resolverData(item.data, local.data, listaFeriados) : null
    const data = d?.ok ? d.data : null
    // o cliente disse a unidade ou o dia e não reconhecemos: filtrar sem esse dado cancelaria o aviso errado
    const naoReconhecido = (!escolhida && !!item.unidade && !u) || (!!item.data && !d?.ok)
    const candidatos = naoReconhecido ? [] : ativos.filter((a) => (!u || a.unitId === u.id) && (!data || a.data === data))
    if (candidatos.length === 1) {
      const a = candidatos[0]!
      if (cancelados.has(a.id)) return // repetido na mesma mensagem
      cancelados.add(a.id)
      const texto = m('aviso_cancelado', { unidade: nomeDe(a.unitId), quando: minuscula(rotulo(a.data)) })
      acoes.push({ tipo: 'cancelar', avisoId: a.id, texto, textoSeFalhar: m('aviso_nao_encontrado') })
      validos++
      respondidos++
      trechos.push(texto)
      return
    }
    validos++
    const lista = candidatos.length ? candidatos : ativos
    const linhas = lista.map((a) => `• ${nomeDe(a.unitId)} — ${minuscula(rotulo(a.data))}, ${textoPessoas(a.pessoas)}`)
    trechos.push(m('aviso_qual_cancelar', { linhas: linhas.join('\n'), exemplo: exemploCancelar(lista[0]!) }))
  }

  for (const item of itens) {
    if (item.servico !== 'aviso_presenca') continue
    if (item.tipo === 'cancelar') cancelar(item)
    else registrar(item)
  }
  return { trechos, acoes, perguntarPessoas, pendenteUnidade, validos, respondidos }
}

/** Junta os trechos sem repetir; a pergunta de pessoas vai por último e só quando não há lista pendente. */
export function comporTexto(partes: readonly (string | null)[]): string | null {
  const unicos = [...new Set(partes.filter((p): p is string => !!p))]
  return unicos.length ? unicos.join('\n\n') : null
}

export function resolverS2(
  itens: readonly ItemExtraido[],
  ctx: ContextoS1,
  agora: Date,
  avisos: readonly AvisoAtivoS2[],
  escolhidaId?: string,
): ResultadoS2 {
  const { trechos, ...r } = resolverItensS2(itens, ctx, agora, avisos, escolhidaId)
  // um dado por vez: com lista de unidade pendente, a pergunta de pessoas espera
  const perguntarPessoas = r.pendenteUnidade.length ? null : r.perguntarPessoas
  const pergunta = perguntarPessoas ? renderModelo('aviso_pessoas', {}, ctx.modelos) : null
  return { ...r, texto: comporTexto([...trechos, pergunta]), perguntarPessoas }
}
