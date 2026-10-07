/**
 * Aviso de presença antigo (Etapa 03), usado só quando o worker não passa o `ContextoReserva` (worker anterior à
 * reserva). Sai quando o worker passar para a reserva (reservas-logo, Task 4).
 */
import { encontrarUnidade } from '../s1/busca.ts'
import { resolverData } from '../s1/datas.ts'
import { feriadosNacionais, mapaFeriados } from '../s1/feriados.ts'
import { dasHora, ddmm, DIAS_SEMANA, formatarTurnos, renderModelo, rotuloDoDia, type ChaveModelo } from '../s1/modelos.ts'
import { unidadesOrdenadas } from '../s1/resolver.ts'
import { agoraLocal, diaDaSemana, diasEntre, somarDias, type DataIso } from '../s1/tempo.ts'
import type { ContextoS1, ItemExtraido, UnidadeS1 } from '../s1/tipos.ts'
import { normalizarHorario } from './horario.ts'
import { MAX_PESSOAS, MIN_PESSOAS } from './pessoas.ts'
import {
  DIAS_AVISO, minuscula, textoPessoas, TOLERANCIA_PASSADO_IA_MIN, validarAvisoNaAgenda, type ParcialS2, type PerguntaReservaComTexto,
} from './resolver.ts'
import type { AcaoS2, AvisoAtivoS2 } from './tipos.ts'

export function resolverItensAvisoLegado(
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
  let pergunta: PerguntaReservaComTexto | null = null
  const trechoDaAcao = new Map<AcaoS2, number>() // registrar repetido na mesma mensagem troca o trecho junto com a ação
  let validos = 0
  let respondidos = 0

  function registrar(entrada: ItemExtraido): void {
    // "na verdade seremos 6": sem unidade nem dia e com um único aviso ativo, é atualização desse aviso
    const unico = !escolhida && !entrada.unidade && !entrada.data && ativos.length === 1 ? ativos[0]! : null
    const doUnico = unico ? (unidades.find((x) => x.id === unico.unitId) ?? null) : null
    // horário herdado do aviso já foi aceito antes: não é recusado agora por "já passou"
    const herdado = !!doUnico && !entrada.horario && !!unico?.horarioAprox
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
    const v = validarAvisoNaAgenda(u, data, h.hhmm, ctx.politicaFeriado, feriados, herdado ? undefined : local, TOLERANCIA_PASSADO_IA_MIN)
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
      pergunta ??= { campo: 'pessoas', item: { ...item, unidade: u.nome, data }, unitId: u.id, tentativasNumero: 0, texto: m('reserva_pergunta_pessoas') }
      return
    }
    const anterior = acoes.findIndex((a) => a.tipo === 'registrar_aviso' && a.unitId === u.id && a.data === data)
    const atualiza = avisos.some((a) => a.unitId === u.id && a.data === data)
    const acao: AcaoS2 = { tipo: 'registrar_aviso', unitId: u.id, data, pessoas: n, horarioAprox: h.hhmm ?? h.livre, atualiza }
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
  return { trechos, acoes, pergunta, pendenteUnidade, validos, respondidos }
}
