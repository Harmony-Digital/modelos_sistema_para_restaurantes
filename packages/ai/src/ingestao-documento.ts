import { z } from 'zod'
import type { RascunhoCardapio } from '@atd/core'
import {
  dataIsoValida,
  LIMITES_IMPORTACAO as L,
  rascunhoEspacosSchema,
  rascunhoHorariosSchema,
  rascunhoInformacoesSchema,
  rascunhoSoPrecosSchema,
  type RascunhoCardapioImportacao,
  type RascunhoEspacos,
  type RascunhoHorarios,
  type RascunhoInformacoes,
  type RascunhoSoPrecos,
  type TurnoImportacao,
} from '@atd/core/importacao'
import {
  INGESTAO_MAX_TOKENS,
  INGESTAO_PROMPT_VERSION,
  INGESTAO_TIMEOUT_MS,
  MIMES_IMAGEM_INGESTAO,
  nomeSeguro,
  parseLeituraCardapio,
} from './ingestao.ts'
import type { ConteudoUsuario, JsonCallResult, LlmClient } from './openrouter.ts'
import { ingestaoJsonSchema, ingestaoSystemPrompt } from './prompts/ingestao-cardapio-v1.ts'
import { INGESTAO_ESPACOS_PROMPT_VERSION, ingestaoEspacosJsonSchema, ingestaoEspacosSystemPrompt } from './prompts/ingestao-espacos-v1.ts'
import { INGESTAO_HORARIOS_PROMPT_VERSION, ingestaoHorariosJsonSchema, ingestaoHorariosSystemPrompt } from './prompts/ingestao-horarios-v1.ts'
import {
  INGESTAO_INFORMACOES_PROMPT_VERSION,
  ingestaoInformacoesJsonSchema,
  ingestaoInformacoesSystemPrompt,
} from './prompts/ingestao-informacoes-v1.ts'

export { INGESTAO_ESPACOS_PROMPT_VERSION, INGESTAO_HORARIOS_PROMPT_VERSION, INGESTAO_INFORMACOES_PROMPT_VERSION }

// ------------------------------------------------------------- tipos de saída
// Os rascunhos são os de `@atd/core/importacao` (spec Etapa 07 §4): o parse corta a saída do modelo nos limites e
// valida no schema do domínio antes de devolver.

export type AlvoLeitura = 'cardapio' | 'informacoes' | 'horarios' | 'espacos'
export type ModoLeitura = 'completo' | 'so_precos'

export type LeituraDocumento =
  | { alvo: 'cardapio'; modo: 'completo'; rascunho: RascunhoCardapioImportacao }
  | { alvo: 'cardapio'; modo: 'so_precos'; rascunho: RascunhoSoPrecos }
  | { alvo: 'informacoes'; modo: 'completo'; rascunho: RascunhoInformacoes }
  | { alvo: 'horarios'; modo: 'completo'; rascunho: RascunhoHorarios }
  | { alvo: 'espacos'; modo: 'completo'; rascunho: RascunhoEspacos }

/** Partes por chamada (um lote tem até 3 imagens ou 1 PDF; 10 = arquivos por importação). */
export const INGESTAO_MAX_PARTES = 10

// ------------------------------------------------------------- utilitários

const cortar = (s: string | null | undefined, max: number): string | null => {
  const t = s?.trim().slice(0, max).trim()
  return t ? t : null
}

/** "9:00", "09:00" ou "11h30" ⇒ "HH:mm"; "24:00" ⇒ "00:00"; inválido ⇒ null. */
function hora(s: string): string | null {
  const m = /^(\d{1,2})[:hH](\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null
  return `${String(h % 24).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Turnos válidos (abre ≠ fecha), ordenados pela abertura, no máximo 6. Mais de 6 lidos ⇒ `conflito` (a revisão pede
 * conferência). Sobreposição entre turnos fica para a junção.
 */
function turnos(lidos: readonly { abre: string; fecha: string }[]): { turnos: TurnoImportacao[]; conflito: boolean } {
  const ok: TurnoImportacao[] = []
  for (const t of lidos) {
    const abre = hora(t.abre)
    const fecha = hora(t.fecha)
    if (abre && fecha && abre !== fecha) ok.push({ abre, fecha })
  }
  ok.sort((a, b) => a.abre.localeCompare(b.abre))
  return { turnos: ok.slice(0, L.turnos), conflito: ok.length > L.turnos }
}

// ------------------------------------------------------------- parse por alvo (tipos conferidos, tamanhos cortados)

const informacoesLidas = z.object({
  fatos: z.array(z.object({ tema: z.string(), texto: z.string(), exemplos: z.array(z.string()), unidade: z.string().nullable() })),
})

export function parseLeituraInformacoes(raw: unknown): RascunhoInformacoes {
  const lida = informacoesLidas.parse(raw)
  const fatos: RascunhoInformacoes['fatos'] = []
  for (const f of lida.fatos) {
    if (fatos.length >= L.fatos) break
    const tema = cortar(f.tema, L.tema)
    const texto = cortar(f.texto, L.texto)
    if (!tema || !texto) continue
    const exemplos = f.exemplos
      .map((e) => cortar(e, L.exemplo))
      .filter((e): e is string => e !== null)
      .slice(0, L.exemplos)
    fatos.push({ tema, texto, exemplos, unidade: cortar(f.unidade, L.unidade), incluir: true })
  }
  return rascunhoInformacoesSchema.parse({ fatos })
}

const turnoLido = z.object({ abre: z.string(), fecha: z.string() })
const horariosLidos = z.object({
  unidades: z.array(z.object({
    unidade: z.string().nullable(),
    dias: z.array(z.object({ dia: z.number(), turnos: z.array(turnoLido) })),
    excecoes: z.array(z.object({ data: z.string(), fechado: z.boolean(), turnos: z.array(turnoLido), motivo: z.string().nullable() })),
  })),
})

/**
 * `semana` traz só os dias que o documento cita (dia fechado = turnos []), em ordem de 0 (domingo) a 6; dia repetido
 * junta os turnos. `hoje` (AAAA-MM-DD, fuso do restaurante): exceção de data passada, inválida ou repetida é descartada.
 * Unidade sem dia nem exceção válida é descartada.
 */
export function parseLeituraHorarios(raw: unknown, hoje: string): RascunhoHorarios {
  const lida = horariosLidos.parse(raw)
  const unidades: RascunhoHorarios['unidades'] = []
  for (const u of lida.unidades) {
    if (unidades.length >= L.unidadesHorario) break
    const porDia = new Map<number, { abre: string; fecha: string }[]>()
    for (const d of u.dias) {
      if (!Number.isInteger(d.dia) || d.dia < 0 || d.dia > 6) continue
      porDia.set(d.dia, [...(porDia.get(d.dia) ?? []), ...d.turnos])
    }
    const semana = [...porDia.entries()].sort(([a], [b]) => a - b).map(([dia, ts]) => ({ dia, ...turnos(ts) }))
    const excecoes: RascunhoHorarios['unidades'][number]['excecoes'] = []
    const vistas = new Set<string>()
    for (const e of u.excecoes) {
      if (excecoes.length >= L.excecoes) break
      const data = e.data.trim()
      if (!dataIsoValida(data) || data < hoje || vistas.has(data)) continue
      vistas.add(data)
      const t = e.fechado ? { turnos: [], conflito: false } : turnos(e.turnos)
      excecoes.push({ data, fechado: t.turnos.length === 0, turnos: t.turnos, motivo: cortar(e.motivo, L.motivo), conflito: t.conflito })
    }
    if (!semana.length && !excecoes.length) continue
    unidades.push({ unidade: cortar(u.unidade, L.unidade), semana, excecoes, incluir: true })
  }
  return rascunhoHorariosSchema.parse({ unidades })
}

const espacosLidos = z.object({
  espacos: z.array(z.object({
    unidade: z.string().nullable(),
    nome: z.string(),
    capacidadeMin: z.number().nullable(),
    capacidadeMax: z.number().nullable(),
    descricao: z.string().nullable(),
    condicoes: z.string().nullable(),
  })),
})

const capacidade = (n: number | null): number | null =>
  n !== null && Number.isInteger(n) && n >= L.capacidadeMin && n <= L.capacidadeMax ? n : null

/**
 * Capacidade fora de 1–1000 ou fracionária conta como não lida. Só o máximo ⇒ mínimo 1; só o mínimo ⇒ máximo = mínimo
 * (a revisão mostra e a equipe ajusta); nenhuma ⇒ espaço descartado (o rascunho exige as duas). Mínimo > máximo é trocado.
 */
export function parseLeituraEspacos(raw: unknown): RascunhoEspacos {
  const lida = espacosLidos.parse(raw)
  const espacos: RascunhoEspacos['espacos'] = []
  for (const e of lida.espacos) {
    if (espacos.length >= L.espacos) break
    const nome = cortar(e.nome, L.nomeEspaco)
    let min = capacidade(e.capacidadeMin)
    let max = capacidade(e.capacidadeMax)
    if (!nome || (min === null && max === null)) continue
    min ??= L.capacidadeMin
    max ??= min
    if (min > max) [min, max] = [max, min]
    espacos.push({
      unidade: cortar(e.unidade, L.unidade),
      nome,
      capacidadeMin: min,
      capacidadeMax: max,
      descricao: cortar(e.descricao, L.descricaoEspaco),
      condicoes: cortar(e.condicoes, L.condicoes),
      incluir: true,
    })
  }
  return rascunhoEspacosSchema.parse({ espacos })
}

/** "Só preços": o cardápio lido vira a lista nome + categoria + preço (a revisão compara com o cadastro). */
export function reduzirParaSoPrecos(r: RascunhoCardapio): RascunhoSoPrecos {
  return rascunhoSoPrecosSchema.parse({
    itens: r.categorias.flatMap((c) => c.itens.map((i) => ({ nome: i.nome, categoria: c.nome, precoCentavos: i.precoCentavos, incluir: true }))),
  })
}

// ------------------------------------------------------------- leitura

type Configuracao = { versao: string; system: string; schemaName: string; jsonSchema: Record<string, unknown>; o_que: string }

const CONFIG: Record<AlvoLeitura, Configuracao> = {
  cardapio: { versao: INGESTAO_PROMPT_VERSION, system: ingestaoSystemPrompt, schemaName: 'rascunho_cardapio', jsonSchema: ingestaoJsonSchema, o_que: 'as categorias e os itens do cardápio' },
  informacoes: { versao: INGESTAO_INFORMACOES_PROMPT_VERSION, system: ingestaoInformacoesSystemPrompt, schemaName: 'rascunho_informacoes', jsonSchema: ingestaoInformacoesJsonSchema, o_que: 'as informações gerais' },
  horarios: { versao: INGESTAO_HORARIOS_PROMPT_VERSION, system: ingestaoHorariosSystemPrompt, schemaName: 'rascunho_horarios', jsonSchema: ingestaoHorariosJsonSchema, o_que: 'os horários de funcionamento' },
  espacos: { versao: INGESTAO_ESPACOS_PROMPT_VERSION, system: ingestaoEspacosSystemPrompt, schemaName: 'rascunho_espacos', jsonSchema: ingestaoEspacosJsonSchema, o_que: 'os espaços para eventos' },
}

/** Versão do prompt usada pelo alvo/modo (para o `ai_runs`). "Só preços" lê com o prompt do cardápio. */
export function versaoPromptIngestao(alvo: AlvoLeitura, _modo: ModoLeitura): string {
  return CONFIG[alvo].versao
}

const erro = (error: string): JsonCallResult<never> => ({ ok: false, error, retryable: false, status: null, model: null, usage: null, latencyMs: 0 })

/** Só anexos de documento (PDF/imagem): texto vindo de fora nunca entra como parte; nome do PDF sanitizado. */
function anexoSeguro(p: ConteudoUsuario): ConteudoUsuario | null {
  if (p.type === 'pdf') return { type: 'pdf', filename: nomeSeguro(p.filename, 'pdf'), base64: p.base64 }
  if (p.type === 'image' && (MIMES_IMAGEM_INGESTAO as readonly string[]).includes(p.mime)) return { type: 'image', mime: p.mime, base64: p.base64 }
  return null
}

/**
 * Lê um lote de documento (todas as partes numa chamada só) e devolve um RASCUNHO do alvo para revisão humana
 * (PRD I10). Prompt, JSON schema estrito e parse escolhidos pelo alvo; "só preços" lê com o prompt do cardápio v1 e
 * reduz para nome + categoria + preço. `hoje` (AAAA-MM-DD no fuso do restaurante) vai na mensagem do usuário, para o
 * modelo completar o ano de datas como "25/12". Nada do documento vai para log.
 */
export async function lerDocumentoPorIa(
  llm: LlmClient,
  p: { alvo: AlvoLeitura; modo: ModoLeitura; partes: readonly ConteudoUsuario[]; modelos: string[]; hoje: string },
): Promise<JsonCallResult<LeituraDocumento>> {
  const cfg = Object.hasOwn(CONFIG, p.alvo) ? CONFIG[p.alvo] : undefined
  if (!cfg) return erro('alvo_invalido')
  if (p.modo !== 'completo' && !(p.modo === 'so_precos' && p.alvo === 'cardapio')) return erro('modo_invalido')
  if (!dataIsoValida(p.hoje)) return erro('data_invalida')
  if (p.partes.length === 0) return erro('sem_partes')
  if (p.partes.length > INGESTAO_MAX_PARTES) return erro('partes_demais')
  const partes: ConteudoUsuario[] = []
  for (const parte of p.partes) {
    const ok = anexoSeguro(parte)
    if (!ok) return erro('tipo_nao_suportado')
    partes.push(ok)
  }

  const { alvo, modo, hoje } = p
  const parse = (raw: unknown): LeituraDocumento => {
    switch (alvo) {
      case 'cardapio': {
        const rascunho = parseLeituraCardapio(raw)
        return modo === 'so_precos' ? { alvo, modo, rascunho: reduzirParaSoPrecos(rascunho) } : { alvo, modo: 'completo', rascunho }
      }
      case 'informacoes': return { alvo, modo: 'completo', rascunho: parseLeituraInformacoes(raw) }
      case 'horarios': return { alvo, modo: 'completo', rascunho: parseLeituraHorarios(raw, hoje) }
      case 'espacos': return { alvo, modo: 'completo', rascunho: parseLeituraEspacos(raw) }
    }
  }

  const anexos = partes.length === 1 ? 'O documento está no anexo.' : `O documento está nos ${partes.length} anexos, que são partes dele em ordem.`
  return llm.completeJson({
    models: p.modelos,
    system: cfg.system,
    user: `Hoje é ${hoje}. ${anexos} Extraia ${cfg.o_que} conforme as regras.`,
    userParts: partes,
    schemaName: cfg.schemaName,
    jsonSchema: cfg.jsonSchema,
    parse,
    maxTokens: INGESTAO_MAX_TOKENS,
    timeoutMs: INGESTAO_TIMEOUT_MS,
  })
}
