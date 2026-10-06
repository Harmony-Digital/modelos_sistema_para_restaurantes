import { INGESTAO_BUDGET_ESTIMATE_USD, lerDocumentoPorIa, type ConteudoUsuario, type LlmClient, type LlmUsage } from '../../src/index.ts'
import { GRUPOS_EVAL, type CasoEval, type GrupoEval } from './casos.ts'

/** Meta por modelo e grupo: ≥ 90% dos pontos (nome + preço, tema + texto, turnos e exceções, capacidades). */
export const META_INGESTAO = 90

const custo = (u: LlmUsage | null) => {
  const real = u?.costUsd == null ? Number.NaN : Number(u.costUsd)
  return Number.isFinite(real) && real >= 0 ? real : Number(INGESTAO_BUDGET_ESTIMATE_USD)
}

function partes(caso: CasoEval, lerArquivo: (nome: string) => Buffer): ConteudoUsuario[] {
  return caso.arquivos.map((a): ConteudoUsuario => {
    const base64 = lerArquivo(a.arquivo).toString('base64')
    return a.mime === 'application/pdf' ? { type: 'pdf', filename: a.arquivo, base64 } : { type: 'image', mime: a.mime, base64 }
  })
}

/**
 * Roda os casos para cada modelo (uma chamada por caso, todas as partes juntas) até o teto de gasto e monta o
 * relatório. `motivos` não vazio = gate reprovado (abaixo da meta, execução parcial ou injeção obedecida).
 * Só o placar e os nomes do gabarito vão para o relatório: nada do documento lido além disso.
 */
export async function executarEvalIngestao(o: {
  llm: LlmClient
  modelos: string[]
  casos: CasoEval[]
  teto: number
  hoje: string
  lerArquivo: (nome: string) => Buffer
  /** data do relatório (AAAA-MM-DD) */
  data: string
}): Promise<{ relatorio: string; motivos: string[]; gastoUsd: number }> {
  let gastoTotal = 0
  const motivos: string[] = []
  const linhas: string[] = []
  const detalhes: string[] = []
  const grupos = GRUPOS_EVAL.filter((g) => o.casos.some((c) => c.grupo === g))

  for (const modelo of o.modelos) {
    const placar = new Map<GrupoEval, { acertos: number; total: number; feitos: number; casos: number; gasto: number }>(
      grupos.map((g) => [g, { acertos: 0, total: 0, feitos: 0, casos: o.casos.filter((c) => c.grupo === g).length, gasto: 0 }]),
    )
    const notas: string[] = []
    for (const caso of o.casos) {
      if (gastoTotal >= o.teto) {
        motivos.push(`teto de US$ ${o.teto.toFixed(2)} atingido durante ${modelo}`)
        break
      }
      const r = await lerDocumentoPorIa(o.llm, { alvo: caso.alvo, modo: caso.modo, partes: partes(caso, o.lerArquivo), modelos: [modelo], hoje: o.hoje })
      const usd = custo(r.usage)
      gastoTotal += usd
      const g = placar.get(caso.grupo)!
      g.gasto += usd
      g.feitos++
      g.total += caso.total
      if (!r.ok) {
        notas.push(`- ${caso.id}: falha da chamada (${r.error}) em ${r.latencyMs} ms`)
        continue
      }
      const p = caso.pontuar(r.data)
      g.acertos += p.acertos
      if (caso.injecaoObedecida(r.data)) motivos.push(`${modelo}: injeção obedecida em ${caso.id}`)
      notas.push(`- ${caso.id}: ${p.acertos}/${p.total} em ${r.latencyMs} ms`
        + `${p.erros.length ? ` · erros: ${p.erros.join('; ')}` : ''}`
        + `${p.aMais.length ? ` · a mais: ${p.aMais.join(', ')}` : ''}`)
    }
    for (const [grupo, g] of placar) {
      const pct = g.total ? (100 * g.acertos) / g.total : 0
      if (g.feitos < g.casos || pct < META_INGESTAO) motivos.push(`${modelo} · ${grupo}: ${g.acertos}/${g.total} abaixo da meta de ${META_INGESTAO}% ou execução parcial`)
      linhas.push(`| ${modelo} | ${grupo} | ${g.acertos}/${g.total} (${pct.toFixed(1)}%) | US$ ${g.gasto.toFixed(4)} |`)
    }
    detalhes.push(`### ${modelo}\n\n${notas.join('\n')}\n`)
  }

  const arquivos = [...new Set(o.casos.flatMap((c) => c.arquivos.map((a) => a.arquivo)))]
  const relatorio = [
    `# Eval de leitura por IA (${o.data})`,
    '',
    `Grupos: ${grupos.join(', ')} · arquivos: ${arquivos.join(', ')} · hoje: ${o.hoje} · teto: US$ ${o.teto.toFixed(2)} · gasto: US$ ${gastoTotal.toFixed(4)}${motivos.length ? ' (REPROVADO/PARCIAL)' : ''}`,
    ...(motivos.length ? ['', ...motivos.map((m) => `**Falha do gate:** ${m}`)] : []),
    '',
    '| Modelo | Grupo | Pontos | Custo |',
    '|---|---|---|---|',
    ...linhas,
    '',
    '## Detalhes por modelo',
    '',
    ...detalhes,
  ].join('\n')
  return { relatorio, motivos, gastoUsd: gastoTotal }
}
