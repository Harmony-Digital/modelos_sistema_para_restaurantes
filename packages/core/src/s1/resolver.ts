import { chaveLacuna, encontrarFato, encontrarUnidade } from './busca.ts'
import { resolverData } from './datas.ts'
import { feriadosNacionais, mapaFeriados } from './feriados.ts'
import { estadoAgora, horarioDoDia, minutosDe, temHorarioCadastrado, type Turno } from './horarios.ts'
import {
  asHora, DIAS_SEMANA, formatarEndereco, formatarTurnos, quandoAbre, renderModelo, rotuloDoDia, type ChaveModelo,
} from './modelos.ts'
import { agoraLocal, type DataIso } from './tempo.ts'
import {
  TIPOS_S1, type ContextoS1, type ItemExtraido, type Lacuna, type ListaUnidades, type Localizacao, type ResultadoS1, type Servico,
  type TipoS1, type UnidadeS1,
} from './tipos.ts'

// aviso_presenca é resolvido pelo S2 (@atd/core/s2) e evento pelo S3 (@atd/core/s3): aqui são ignorados
const NOME_SERVICO: Partial<Record<Servico, string>> = {
  cardapio: 'o cardápio',
}
const SEGUNDA_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0] as const
const MAX_OPCOES = 10 // limite da Meta para linhas de lista
const BOTAO_LISTA = 'Ver unidades'

type Parcial = { trecho: string; respondido: boolean }

const ordenar = (ts: readonly Turno[]) => [...ts].sort((a, b) => minutosDe(a.abre) - minutosDe(b.abre))
const ehTipoS1 = (t: ItemExtraido['tipo']): t is TipoS1 => (TIPOS_S1 as readonly string[]).includes(t ?? '')

/** Unidades ativas na ordem de exibição (ordem do painel, depois nome). */
export function unidadesOrdenadas(ctx: ContextoS1): UnidadeS1[] {
  return [...ctx.unidades].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Lista interativa "Ver unidades" (as mesmas opções para pendentes do S1, S2 e S3; muda só o texto). */
export function listaDeUnidades(
  ctx: ContextoS1,
  corpo: 'escolher_unidade' | 'escolher_unidade_aviso' | 'escolher_unidade_reserva' | 'evento_pergunta_unidade' = 'escolher_unidade',
): ListaUnidades {
  return {
    corpo: renderModelo(corpo, {}, ctx.modelos),
    botao: BOTAO_LISTA,
    opcoes: unidadesOrdenadas(ctx).slice(0, MAX_OPCOES).map((u) => ({
      id: u.id,
      titulo: u.nome.slice(0, 24),
      descricao: [u.bairro, u.cidade].filter(Boolean).join(' · ').slice(0, 72),
    })),
  }
}

export function resolverS1(itens: readonly ItemExtraido[], ctx: ContextoS1, agora: Date, escolhidaId?: string): ResultadoS1 {
  const local = agoraLocal(agora, ctx.timezone)
  const ano = Number(local.data.slice(0, 4))
  const listaFeriados = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  const feriados = mapaFeriados(listaFeriados)
  const m = (chave: ChaveModelo, vars: Record<string, string> = {}) => renderModelo(chave, vars, ctx.modelos)
  const unidades = unidadesOrdenadas(ctx)
  const escolhida = escolhidaId ? (unidades.find((u) => u.id === escolhidaId) ?? null) : null

  const trechos: string[] = []
  const localizacoes: Localizacao[] = []
  const pendente: ItemExtraido[] = []
  const lacunas = new Map<string, Lacuna>()
  let validos = 0
  let respondidos = 0
  const lacuna = (chave: string, unitId: string | null) => lacunas.set(`${chave}|${unitId ?? ''}`, { chave, unitId })

  function abertoAgora(alvo: UnidadeS1[]): Parcial {
    let respondido = true
    const estados = alvo.map((u) => {
      if (!temHorarioCadastrado(u)) {
        lacuna('horario', u.id)
        respondido = false
        return { u, e: null }
      }
      return { u, e: estadoAgora(u, ctx.politicaFeriado, feriados, local) }
    })
    if (estados.length === 1) {
      const { u, e } = estados[0]!
      if (!e) return { trecho: m('lacuna'), respondido: false }
      if (e.aberta) return { trecho: m('aberto_sim', { unidade: u.nome, fecha: asHora(e.fecha.hora) }), respondido }
      if (e.abre) {
        return { trecho: m('aberto_nao', { unidade: u.nome, quando: quandoAbre(e.abre.data, local.data), abre: asHora(e.abre.hora) }), respondido }
      }
      return { trecho: m('aberto_sem_previsao', { unidade: u.nome }), respondido }
    }
    const linhas = estados.map(({ u, e }) => {
      if (!e) return `• ${u.nome}: horário ainda não cadastrado`
      if (e.aberta) return `• ${u.nome}: aberta, fecha ${asHora(e.fecha.hora)}`
      if (e.abre) return `• ${u.nome}: fechada, abre ${quandoAbre(e.abre.data, local.data)} ${asHora(e.abre.hora)}`
      return `• ${u.nome}: fechada`
    })
    return { trecho: m('aberto_varias', { linhas: linhas.join('\n') }), respondido }
  }

  function horarioDia(alvo: UnidadeS1[], data: DataIso): Parcial {
    let respondido = true
    const dias = alvo.map((u) => {
      const h = horarioDoDia(u, data, ctx.politicaFeriado, feriados)
      const semCadastro = h.origem === 'semanal' && !temHorarioCadastrado(u)
      if (semCadastro) {
        lacuna('horario', u.id)
        respondido = false
      }
      return { u, h, semCadastro }
    })
    const quando = rotuloDoDia(data, local.data, feriados.get(data) ?? null)
    if (dias.length === 1) {
      const { u, h, semCadastro } = dias[0]!
      if (semCadastro) return { trecho: m('lacuna'), respondido: false }
      return {
        trecho: h.turnos.length
          ? m('horario_dia', { quando, unidade: u.nome, turnos: formatarTurnos(h.turnos) })
          : m('horario_dia_fechado', { quando, unidade: u.nome }),
        respondido,
      }
    }
    const linhas = dias.map(({ u, h, semCadastro }) =>
      semCadastro ? `• ${u.nome}: horário ainda não cadastrado` : `• ${u.nome}: ${h.turnos.length ? formatarTurnos(h.turnos) : 'fechada'}`)
    return { trecho: m('horario_varias', { quando, linhas: linhas.join('\n') }), respondido }
  }

  function semana(alvo: UnidadeS1[]): Parcial {
    let respondido = true
    const blocos = alvo.map((u) => {
      if (!temHorarioCadastrado(u)) {
        lacuna('horario', u.id)
        respondido = false
        return alvo.length === 1 ? m('lacuna') : `Horários da unidade ${u.nome}: ainda não cadastrados`
      }
      const linhas = SEGUNDA_A_DOMINGO.map((d) => {
        const ts = ordenar(u.semanal[d] ?? [])
        return `${DIAS_SEMANA[d]}: ${ts.length ? formatarTurnos(ts) : 'fechada'}`
      })
      return m('horario_semana', { unidade: u.nome, linhas: linhas.join('\n') })
    })
    return { trecho: blocos.join('\n\n'), respondido }
  }

  function endereco(tipo: TipoS1, alvo: UnidadeS1[]): Parcial {
    let respondido = true
    const partes = alvo.map((u) => {
      const end = formatarEndereco(u)
      if (!end) {
        lacuna('endereco', u.id)
        respondido = false
        return { u, end: null }
      }
      if (u.lat !== null && u.lng !== null) localizacoes.push({ lat: u.lat, lng: u.lng, nome: u.nome, endereco: end })
      return { u, end }
    })
    if (partes.length === 1) {
      const { u, end } = partes[0]!
      if (!end) return { trecho: m('lacuna'), respondido: false }
      return {
        trecho: tipo === 'como_chegar' && u.mapsUrl
          ? m('como_chegar', { unidade: u.nome, endereco: end, mapa: u.mapsUrl })
          : m('endereco', { unidade: u.nome, endereco: end }),
        respondido,
      }
    }
    const linhas = partes.map(({ u, end }) => `• ${u.nome}: ${end ?? 'endereço ainda não cadastrado'}`)
    return { trecho: m('endereco_varias', { linhas: linhas.join('\n') }), respondido }
  }

  function comUnidade(tipo: TipoS1, item: ItemExtraido, alvo: UnidadeS1[]): Parcial {
    if (tipo === 'endereco' || tipo === 'como_chegar') return endereco(tipo, alvo)
    if (tipo === 'horario_semana') return semana(alvo)
    let data = local.data
    if (tipo === 'feriado' && !item.data) {
      const proximo = listaFeriados.find((f) => f.data >= local.data)
      if (!proximo) return { trecho: m('data_nao_entendida'), respondido: false }
      data = proximo.data
    } else if (item.data) {
      const d = resolverData(item.data, local.data, listaFeriados)
      if (!d.ok) return { trecho: m('data_nao_entendida'), respondido: false }
      data = d.data
    }
    if (tipo === 'aberto_agora' && data === local.data) return abertoAgora(alvo)
    return horarioDia(alvo, data)
  }

  for (const item of itens) {
    if (item.servico !== 'horario_unidades') {
      const nome = NOME_SERVICO[item.servico]
      if (nome) trechos.push(m('em_breve', { servico: nome }))
      continue // humano/lgpd: tratados pelo worker antes daqui; aviso_presenca: S2; evento: S3
    }
    const tipo: TipoS1 = ehTipoS1(item.tipo) ? item.tipo : 'info'

    if (tipo === 'lista_unidades') {
      validos++
      if (unidades.length === 0) {
        lacuna(chaveLacuna('unidades'), null)
        trechos.push(m('lacuna'))
        continue
      }
      trechos.push(m('lista_unidades', { linhas: unidades.map((u) => `• ${u.nome}`).join('\n') }))
      respondidos++
      continue
    }

    if (tipo === 'info') {
      validos++
      const u = escolhida ?? encontrarUnidade(item.unidade, unidades)
      const fato = encontrarFato(item.tema, ctx.fatos, u?.id ?? null)
      if (fato) {
        const dona = fato.unitId && !u ? unidades.find((x) => x.id === fato.unitId) : undefined
        trechos.push(dona ? `Na unidade ${dona.nome}: ${fato.texto}` : fato.texto)
        respondidos++
      } else {
        lacuna(chaveLacuna('info', item.tema), u?.id ?? null)
        trechos.push(m('lacuna'))
      }
      continue
    }

    const achada = escolhida ?? encontrarUnidade(item.unidade, unidades)
    let alvo: UnidadeS1[]
    if (achada) alvo = [achada]
    else if (unidades.length === 0) {
      validos++
      lacuna(chaveLacuna(tipo === 'endereco' || tipo === 'como_chegar' ? 'endereco' : 'horario'), null)
      trechos.push(m('lacuna'))
      continue
    } else if (unidades.length <= 3) alvo = unidades
    else {
      pendente.push(item) // conta quando o cliente escolher
      continue
    }
    validos++
    const r = comUnidade(tipo, item, alvo)
    trechos.push(r.trecho)
    if (r.respondido) respondidos++
  }

  const lista: ListaUnidades | null = pendente.length ? listaDeUnidades(ctx) : null
  const vistos = new Set<string>()
  const locs = localizacoes.filter((l) => {
    const k = `${l.nome}|${l.lat}|${l.lng}`
    return vistos.has(k) ? false : (vistos.add(k), true)
  })
  const unicos = [...new Set(trechos)]
  return {
    texto: unicos.length ? unicos.join('\n\n') : null,
    localizacoes: locs,
    lista,
    pendente,
    lacunas: [...lacunas.values()],
    validos,
    respondidos,
  }
}
