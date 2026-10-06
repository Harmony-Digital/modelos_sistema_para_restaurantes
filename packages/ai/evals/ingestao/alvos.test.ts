import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  createOpenRouterClient,
  parseLeituraCardapio,
  parseLeituraEspacos,
  parseLeituraHorarios,
  parseLeituraInformacoes,
  reduzirParaSoPrecos,
  type LeituraDocumento,
} from '../../src/index.ts'
import { CASOS_EVAL, GRUPOS_EVAL, type CasoEval } from './casos.ts'
import { executarEvalIngestao } from './executar.ts'
import {
  EVAL_HOJE,
  EXEMPLO_ESPACOS,
  EXEMPLO_FOTOS,
  EXEMPLO_HORARIOS,
  EXEMPLO_INFORMACOES,
  EXEMPLO_PDF,
  EXEMPLO_PNG,
  GABARITO_FOTOS,
  type Exemplo,
} from './gabarito.ts'
import { linhasPdfHorarios, linhasPdfInformacoes, linhasPng, linhasPngEspacos, pdfDeLinhas, pixelsDeLinhas, PASTA_EXEMPLOS } from './gerar-exemplos.ts'
import { pontuarEspacos, pontuarHorarios, pontuarInformacoes } from './pontuar.ts'

const ler = (arquivo: string) => readFileSync(new URL(arquivo, PASTA_EXEMPLOS))

function pixelsDoPng(png: Buffer): Buffer {
  const largura = png.readUInt32BE(16)
  const altura = png.readUInt32BE(20)
  const idat: Buffer[] = []
  for (let i = 8; i < png.length;) {
    const n = png.readUInt32BE(i)
    if (png.toString('latin1', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + n))
    i += 12 + n
  }
  const cru = inflateSync(Buffer.concat(idat))
  return Buffer.concat(Array.from({ length: altura }, (_, y) => cru.subarray(y * (largura + 1) + 1, (y + 1) * (largura + 1))))
}

// ------------------------------------------------------------- saídas "perfeitas" no formato do MODELO (para o fetch falso)

const saidaCardapio = (ex: Exemplo) => ({
  categorias: ex.categorias.map((c) => ({
    nome: c.nome,
    itens: c.itens.map((i) => ({ nome: i.nome, descricao: i.descricao ?? null, precoCentavos: i.precoCentavos, tags: [], unidade: null })),
  })),
})
const saidaInformacoes = () => ({
  fatos: EXEMPLO_INFORMACOES.fatos.map((f) => ({ tema: f.temas[0]!, texto: f.texto, exemplos: [], unidade: f.unidade })),
})
const saidaHorarios = () => ({
  unidades: EXEMPLO_HORARIOS.unidades.map((u) => ({
    unidade: u.unidade,
    dias: u.semana,
    excecoes: u.excecoes.map((e) => ({ ...e, motivo: null })),
  })),
})
const saidaEspacos = () => ({
  espacos: EXEMPLO_ESPACOS.espacos.map((e) => ({ ...e, descricao: null, condicoes: null })),
})

/** Saída perfeita por caso, achada pelo conteúdo dos anexos (o fetch falso não sabe qual caso está rodando). */
function saidaPerfeita(caso: CasoEval): unknown {
  switch (caso.id) {
    case 'cardapio-pdf': case 'so-precos-pdf': return saidaCardapio(EXEMPLO_PDF)
    case 'cardapio-foto': return saidaCardapio(EXEMPLO_PNG)
    case 'cardapio-fotos': return saidaCardapio(GABARITO_FOTOS)
    case 'informacoes': return saidaInformacoes()
    case 'horarios': return saidaHorarios()
    case 'espacos': return saidaEspacos()
    default: throw new Error(`caso sem saída: ${caso.id}`)
  }
}

function fetchFalso(mexer: (caso: CasoEval, saida: unknown) => unknown = (_, s) => s) {
  const chaves = new Map(CASOS_EVAL.map((c) => [`${c.modo}:${c.arquivos.map((a) => a.arquivo).join(',')}`, c]))
  const porConteudo = new Map<string, string>()
  for (const c of CASOS_EVAL) for (const a of c.arquivos) porConteudo.set(ler(a.arquivo).toString('base64'), a.arquivo)
  return (async (_url: string, init: { body: string }) => {
    const corpo = JSON.parse(init.body) as { messages: { content: { type: string; text?: string; image_url?: { url: string }; file?: { file_data: string } }[] }[]; response_format: { json_schema: { name: string } } }
    const partes = corpo.messages[1]!.content
    const nomes = partes.filter((p) => p.type !== 'text').map((p) => porConteudo.get((p.image_url?.url ?? p.file!.file_data).split(',')[1]!))
    const schema = corpo.response_format.json_schema.name
    // "só preços" e cardápio completo do mesmo PDF usam o mesmo schema: a saída é a mesma
    const caso = chaves.get(`completo:${nomes.join(',')}`) ?? chaves.get(`so_precos:${nomes.join(',')}`)!
    expect(schema).toBe(`rascunho_${caso.alvo}`)
    return new Response(JSON.stringify({
      model: 'falso/m', usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.002 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(mexer(caso, saidaPerfeita(caso))) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

// ------------------------------------------------------------- testes

describe('eval:ingestao por alvo — documentos de exemplo versionados', () => {
  it('PDFs de informações e horários: iguais ao gerador, com o conteúdo do gabarito e a linha de injeção', () => {
    const info = ler(EXEMPLO_INFORMACOES.arquivo)
    expect(info.equals(pdfDeLinhas(linhasPdfInformacoes()))).toBe(true)
    for (const f of EXEMPLO_INFORMACOES.fatos) expect(info.toString('latin1')).toContain(f.texto.replaceAll('(', '\\(').replaceAll(')', '\\)'))
    expect(info.toString('latin1')).toContain(EXEMPLO_INFORMACOES.injecao)
    const horarios = ler(EXEMPLO_HORARIOS.arquivo)
    expect(horarios.equals(pdfDeLinhas(linhasPdfHorarios()))).toBe(true)
    expect(horarios.toString('latin1')).toContain('18:00 as 01:00')
    expect(horarios.toString('latin1')).toContain(EXEMPLO_HORARIOS.injecao)
  })

  it('PNGs (várias fotos e espaços): mesmos pixels do gerador; injeção na segunda foto e no quadro de espaços', () => {
    for (const foto of EXEMPLO_FOTOS) expect(pixelsDoPng(ler(foto.arquivo)).equals(pixelsDeLinhas(linhasPng(foto)).pixels)).toBe(true)
    expect(linhasPng(EXEMPLO_FOTOS[1]!).at(-1)).toMatch(/^INSTRUCAO AO SISTEMA/)
    expect(pixelsDoPng(ler(EXEMPLO_ESPACOS.arquivo)).equals(pixelsDeLinhas(linhasPngEspacos()).pixels)).toBe(true)
    expect(linhasPngEspacos().at(-1)).toBe(EXEMPLO_ESPACOS.injecao)
    for (const a of [...EXEMPLO_FOTOS, EXEMPLO_ESPACOS]) expect(ler(a.arquivo).length).toBeLessThan(20_000)
  })

  it('todo grupo tem caso; várias fotos vão juntas numa chamada', () => {
    expect(new Set(CASOS_EVAL.map((c) => c.grupo))).toEqual(new Set(GRUPOS_EVAL))
    expect(CASOS_EVAL.find((c) => c.id === 'cardapio-fotos')!.arquivos).toHaveLength(2)
    expect(CASOS_EVAL.find((c) => c.id === 'so-precos-pdf')).toMatchObject({ alvo: 'cardapio', modo: 'so_precos' })
  })
})

describe('eval:ingestao por alvo — pontuação', () => {
  it('informações: tema (ou sinônimo) + trechos do texto + unidade', () => {
    const fatos = saidaInformacoes().fatos.map((f) => ({ ...f, incluir: true }))
    expect(pontuarInformacoes(EXEMPLO_INFORMACOES, { fatos })).toMatchObject({ total: 6, acertos: 6, erros: [], aMais: [] })
    fatos[1]!.tema = 'Pets'
    fatos[2]!.texto = 'Taxa de rolha cobrada por garrafa.'
    fatos[4]!.unidade = null
    fatos.push({ tema: 'Rodizio', texto: 'Gratis para todos.', exemplos: [], unidade: null, incluir: true })
    const p = pontuarInformacoes(EXEMPLO_INFORMACOES, { fatos })
    expect(p.acertos).toBe(4)
    expect(p.erros).toEqual(['Taxa de rolha: texto sem "40"', 'Musica ao vivo: unidade esperada Asa Norte, lida null'])
    expect(p.aMais).toEqual(['Rodizio'])
  })

  it('horários: cada dia e cada exceção exatos', () => {
    const r = {
      unidades: EXEMPLO_HORARIOS.unidades.map((u) => ({
        unidade: u.unidade, incluir: true,
        semana: u.semana.map((d) => ({ ...d, conflito: false })),
        excecoes: u.excecoes.map((e) => ({ ...e, motivo: null, conflito: false })),
      })),
    }
    expect(pontuarHorarios(EXEMPLO_HORARIOS, r)).toMatchObject({ total: 19, acertos: 19, erros: [] })
    r.unidades[0]!.semana[5]!.turnos = [{ abre: '11:30', fecha: '15:00' }, { abre: '18:00', fecha: '23:00' }]
    r.unidades[1]!.excecoes = r.unidades[1]!.excecoes.filter((e) => e.data !== '2027-01-01')
    r.unidades[1]!.excecoes.push({ data: '2026-01-01', fechado: true, turnos: [], motivo: null, conflito: false })
    const p = pontuarHorarios(EXEMPLO_HORARIOS, r)
    expect(p.acertos).toBe(17)
    expect(p.erros).toEqual(['Asa Sul dia 5: esperado 11:30-15:00 18:00-01:00, lido 11:30-15:00 18:00-23:00', 'Lago Norte 2027-01-01: faltando'])
    expect(p.aMais).toEqual(['Lago Norte 2026-01-01'])
    expect(pontuarHorarios(EXEMPLO_HORARIOS, { unidades: [] }).erros).toEqual(['Asa Sul: unidade faltando', 'Lago Norte: unidade faltando'])
  })

  it('espaços: capacidades por nome e unidade', () => {
    const espacos = EXEMPLO_ESPACOS.espacos.map((e) => ({ ...e, descricao: null, condicoes: null, incluir: true }))
    expect(pontuarEspacos(EXEMPLO_ESPACOS, { espacos })).toMatchObject({ total: 3, acertos: 3, erros: [] })
    espacos[0]!.capacidadeMax = 1000
    espacos.splice(2, 1)
    const p = pontuarEspacos(EXEMPLO_ESPACOS, { espacos })
    expect(p.acertos).toBe(1)
    expect(p.erros).toEqual(['Salao principal: esperado 20-80, lido 20-1000', 'Sala privativa: faltando'])
  })

  it('cada caso pontua 100% a saída perfeita e detecta a injeção obedecida', () => {
    for (const caso of CASOS_EVAL) {
      const leitura = parsePerfeita(caso)
      expect([caso.id, caso.pontuar(leitura)]).toMatchObject([caso.id, { acertos: caso.total, total: caso.total }])
      expect([caso.id, caso.injecaoObedecida(leitura)]).toEqual([caso.id, false])
    }
  })
})

/** Saída perfeita já no formato do rascunho (passando pelo parse real). */
function parsePerfeita(caso: CasoEval): LeituraDocumento {
  const raw = saidaPerfeita(caso)
  if (caso.alvo === 'cardapio') {
    const r = parseLeituraCardapio(raw)
    return caso.modo === 'so_precos' ? { alvo: 'cardapio', modo: 'so_precos', rascunho: reduzirParaSoPrecos(r) } : { alvo: 'cardapio', modo: 'completo', rascunho: r }
  }
  if (caso.alvo === 'informacoes') return { alvo: 'informacoes', modo: 'completo', rascunho: parseLeituraInformacoes(raw) }
  if (caso.alvo === 'horarios') return { alvo: 'horarios', modo: 'completo', rascunho: parseLeituraHorarios(raw, EVAL_HOJE) }
  return { alvo: 'espacos', modo: 'completo', rascunho: parseLeituraEspacos(raw) }
}

describe('eval:ingestao por alvo — execução com fetch falso', () => {
  it('leitura perfeita: 100% por grupo, sem falha do gate, custo somado', async () => {
    const llm = createOpenRouterClient({ apiKey: 'k', appTitle: 't', fetch: fetchFalso() })
    const r = await executarEvalIngestao({ llm, modelos: ['falso/m'], casos: CASOS_EVAL, teto: 1, hoje: EVAL_HOJE, lerArquivo: ler, data: '2026-10-06' })
    expect(r.motivos).toEqual([])
    for (const g of GRUPOS_EVAL) expect(r.relatorio).toMatch(new RegExp(`\\| falso/m \\| ${g} \\| \\d+/\\d+ \\(100\\.0%\\)`))
    expect(r.gastoUsd).toBeCloseTo(0.002 * CASOS_EVAL.length)
  })

  it('injeção obedecida e preço errado reprovam o gate', async () => {
    const llm = createOpenRouterClient({
      apiKey: 'k', appTitle: 't',
      fetch: fetchFalso((caso, s) => (caso.id === 'cardapio-fotos' ? saidaCardapio({ ...GABARITO_FOTOS, categorias: GABARITO_FOTOS.categorias.map((c) => ({ ...c, itens: c.itens.map((i) => ({ ...i, precoCentavos: 0 })) })) }) : s)),
    })
    const r = await executarEvalIngestao({ llm, modelos: ['falso/m'], casos: CASOS_EVAL, teto: 1, hoje: EVAL_HOJE, lerArquivo: ler, data: '2026-10-06' })
    expect(r.motivos.some((m) => /injeção obedecida em cardapio-fotos/.test(m))).toBe(true)
    expect(r.motivos.some((m) => /falso\/m · cardapio:/.test(m))).toBe(true)
  })

  it('teto atingido interrompe e reprova (execução parcial)', async () => {
    const llm = createOpenRouterClient({ apiKey: 'k', appTitle: 't', fetch: fetchFalso() })
    const r = await executarEvalIngestao({ llm, modelos: ['falso/m'], casos: CASOS_EVAL, teto: 0.003, hoje: EVAL_HOJE, lerArquivo: ler, data: '2026-10-06' })
    expect(r.motivos.some((m) => /teto de US\$ 0\.00/.test(m))).toBe(true)
    expect(r.gastoUsd).toBeCloseTo(0.004)
  })
})
