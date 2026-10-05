import {
  agoraLocal, encontrarFato, encontrarUnidade, feriadosNacionais, minutosDe, resolverData,
  type ContextoS1, type ItemExtraido,
} from '@atd/core'

/**
 * Chave semântica de um item: dois itens com a mesma chave levam à MESMA resposta.
 * Por isso compara unidade/data/fato resolvidos, não o texto cru (ex.: "amanhã" = "amanha";
 * feriado sem data ≈ horario_dia na data do próximo feriado).
 */
export function chaveItem(i: ItemExtraido, ctx: ContextoS1, agora: Date): string {
  if (i.servico !== 'horario_unidades') return i.servico
  const tipo = i.tipo ?? 'info'
  if (tipo === 'lista_unidades') return 'horario_unidades|lista_unidades'
  if (tipo === 'info') {
    const u = encontrarUnidade(i.unidade, ctx.unidades)
    return `horario_unidades|info|${encontrarFato(i.tema, ctx.fatos, u?.id ?? null)?.id ?? '?'}`
  }
  const unidade = encontrarUnidade(i.unidade, ctx.unidades)?.id ?? '-'
  if (tipo === 'endereco' || tipo === 'como_chegar') return `horario_unidades|${tipo}|${unidade}`
  if (tipo === 'horario_semana') return `horario_unidades|horario_semana|${unidade}`
  const hoje = agoraLocal(agora, ctx.timezone).data
  const ano = Number(hoje.slice(0, 4))
  const feriados = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  let data = hoje
  if (tipo === 'feriado' && !i.data) data = feriados.find((f) => f.data >= hoje)?.data ?? '?'
  else if (i.data) {
    const d = resolverData(i.data, hoje, feriados)
    data = d.ok ? d.data : '?'
  }
  const efetivo = tipo === 'aberto_agora' && data === hoje ? 'aberto_agora' : 'horario_dia'
  return `horario_unidades|${efetivo}|${unidade}|${data}`
}

export function extracaoCorreta(esperado: readonly ItemExtraido[], obtido: readonly ItemExtraido[], ctx: ContextoS1, agora: Date): boolean {
  const k = (lista: readonly ItemExtraido[]) => lista.map((i) => chaveItem(i, ctx, agora)).sort()
  return JSON.stringify(k(esperado)) === JSON.stringify(k(obtido))
}

const HORA_NO_TEXTO = /\b(\d{1,2})h(\d{2})?\b|meia-noite/g
const paraHHMM = (m: RegExpExecArray) =>
  m[0] === 'meia-noite' ? '00:00' : `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}`

/** Horas citadas na resposta que não existem em nenhum horário, exceção ou fato do contexto (meta: nenhuma). */
export function horasInventadas(texto: string, ctx: ContextoS1): string[] {
  const permitidas = new Set<string>()
  for (const u of ctx.unidades) {
    for (const t of [...u.semanal.flat(), ...Object.values(u.excecoes).flatMap((e) => e.turnos)]) {
      permitidas.add(t.abre)
      permitidas.add(t.fecha)
    }
  }
  for (const f of ctx.fatos) for (const m of f.texto.matchAll(HORA_NO_TEXTO)) permitidas.add(paraHHMM(m))
  const citadas = [...texto.matchAll(HORA_NO_TEXTO)].map(paraHHMM)
  return citadas.filter((h) => {
    try {
      minutosDe(h)
    } catch {
      return true
    }
    return !permitidas.has(h)
  })
}
