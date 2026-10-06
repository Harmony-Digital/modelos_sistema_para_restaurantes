import { describe, expect, it } from 'vitest'
import { ASA_NORTE, CONTEXTO, CONTEXTO_PEQUENO } from '../../../ai/evals/s1/fixture.ts'
import { MODELOS_S1, renderModelo, type ChaveModelo } from '../s1/modelos.ts'
import type { ContextoS1, ItemExtraido } from '../s1/tipos.ts'
import { resolverAtendimento } from '../s2/atendimento.ts'
import { resolverS3 } from './resolver.ts'
import type { EspacoS3Core, PedidoAtivoS3 } from './tipos.ts'

const SEG_14H = new Date('2026-10-05T14:00:00-03:00')

const nulos = { unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null }
const ped = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ({ servico: 'evento', tipo: 'pedido', ...nulos, ...extra })
const can = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ped({ tipo: 'cancelar', ...extra })
const esp = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ped({ tipo: 'espacos', ...extra })
const completo = (extra: Partial<ItemExtraido> = {}) =>
  ped({ unidade: 'asa sul', data: 'sábado', convidados: 40, tipoEvento: 'aniversário', ...extra })

const SALAO: EspacoS3Core = {
  id: 's-salao', unitId: 'u-asa-sul', nome: 'Salão Principal', capacidadeMin: 30, capacidadeMax: 80,
  descricao: 'Salão climatizado com som.', condicoes: 'Consumação mínima por pessoa.',
}
const VARANDA: EspacoS3Core = { id: 's-varanda', unitId: 'u-asa-sul', nome: 'Varanda', capacidadeMin: 10, capacidadeMax: 30, descricao: null, condicoes: null }
const MEZANINO: EspacoS3Core = {
  id: 's-mezanino', unitId: 'u-asa-norte', nome: 'Mezanino', capacidadeMin: 15, capacidadeMax: 40, descricao: 'Área reservada no andar de cima.', condicoes: null,
}
const ESPACOS = [SALAO, VARANDA, MEZANINO]

const FIM = 'Nossa equipe vai entrar em contato para confirmar.'
const REG_AS_SAB = `Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, sábado (10/10). ${FIM}`
const LINHA_SALAO = '• Salão Principal (Asa Sul) — 30 a 80 pessoas. Salão climatizado com som. Consumação mínima por pessoa.'
const LINHA_VARANDA = '• Varanda (Asa Sul) — 10 a 30 pessoas.'
const LINHA_MEZANINO = '• Mezanino (Asa Norte) — 15 a 40 pessoas. Área reservada no andar de cima.'
const NAO_ACHOU = 'Não encontrei pedido de evento seu em andamento.'
const registrar = (extra: Record<string, unknown> = {}) => ({
  tipo: 'registrar_evento', unitId: 'u-asa-sul', spaceId: null, data: '2026-10-10', convidados: 40,
  tipoEvento: 'aniversario', tipoTexto: 'aniversário', observacoes: null, ...extra,
})
const pedido = (id: string, unitId: string, data: string, status: PedidoAtivoS3['status'] = 'novo'): PedidoAtivoS3 =>
  ({ id, unitId, data, convidados: 40, tipo: 'aniversario', status })

describe('resolverS3 — pedido completo', () => {
  it('registra sem espaço e lista os espaços que comportam o grupo', () => {
    const r = resolverS3([completo()], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(`${REG_AS_SAB}\n\nEspaços para eventos:\n${LINHA_SALAO}`)
    expect(r.acoes).toEqual([registrar()])
    expect(r.perguntar).toBeNull()
    expect(r.pendenteUnidade).toEqual([])
    expect(r.handoff).toBe(false)
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('sem espaço que comporte: registra e não lista nada', () => {
    const r = resolverS3([completo({ convidados: 200 })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(`Recebemos seu pedido de aniversário para 200 convidados na unidade Asa Sul, sábado (10/10). ${FIM}`)
    expect(r.acoes).toEqual([registrar({ convidados: 200 })])
  })

  it('1 convidado no singular; tipo "outro" aparece como "evento" (o texto do cliente fica só para a equipe)', () => {
    const r = resolverS3([completo({ convidados: 1, tipoEvento: 'chá de bebê' })], CONTEXTO, [], SEG_14H, [])
    expect(r.texto).toBe(`Recebemos seu pedido de evento para 1 convidado na unidade Asa Sul, sábado (10/10). ${FIM}`)
    expect(r.acoes).toEqual([registrar({ convidados: 1, tipoEvento: 'outro', tipoTexto: 'chá de bebê' })])
  })

  it('espaço citado que comporta: registra no espaço', () => {
    const r = resolverS3([completo({ espaco: 'no salão principal' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(`Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, sábado (10/10), no espaço Salão Principal. ${FIM}`)
    expect(r.acoes).toEqual([registrar({ spaceId: 's-salao' })])
  })

  it('espaço de outra unidade não é aceito (busca só na unidade do pedido)', () => {
    const r = resolverS3([completo({ espaco: 'mezanino' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.acoes).toEqual([registrar()])
  })

  it('espaço inexistente: trata como não citado e informa os espaços que comportam', () => {
    const r = resolverS3([completo({ espaco: 'terraço' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.acoes).toEqual([registrar()])
    expect(r.texto).toBe(`${REG_AS_SAB}\n\nEspaços para eventos:\n${LINHA_SALAO}`)
  })

  it('espaço que não comporta: informa a capacidade, sugere e NÃO registra', () => {
    const r = resolverS3([completo({ espaco: 'varanda' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(
      'O espaço Varanda recebe de 10 a 30 pessoas. Para 40 pessoas, sugiro: Salão Principal. Qual espaço prefere? Se tanto faz, diga "pode ser qualquer um".',
    )
    expect(r.acoes).toEqual([])
    expect(r.perguntar).toEqual({
      campo: 'espaco', unitId: 'u-asa-sul',
      item: completo({ unidade: 'Asa Sul', data: '2026-10-10', espaco: null }),
    })
    expect([r.validos, r.respondidos]).toEqual([0, 0])
  })

  it('espaço que não comporta e nenhum outro comporta: sem sugestões', () => {
    const r = resolverS3([completo({ convidados: 100, espaco: 'varanda' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('O espaço Varanda recebe de 10 a 30 pessoas. Qual espaço prefere? Se tanto faz, diga "pode ser qualquer um".')
  })

  it('"pode ser qualquer um" (espaco = "*"): registra sem espaço e sem listar', () => {
    const r = resolverS3([completo({ espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(REG_AS_SAB)
    expect(r.acoes).toEqual([registrar()])
  })

  it('unidade fechada no dia: não bloqueia, grava observação para a equipe', () => {
    // Asa Sul não abre às segundas; 19/10 é segunda
    const r = resolverS3([completo({ data: 'dia 19', espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.acoes).toEqual([registrar({ data: '2026-10-19', observacoes: 'Unidade fechada nesse dia pelo horário cadastrado' })])
    expect(r.texto).toBe(`Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, segunda-feira (19/10). ${FIM}`)
  })

  it('unidade escolhida na lista vale para o pedido; uma só unidade ativa é assumida', () => {
    const r = resolverS3([completo({ unidade: null, espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [], 'u-asa-norte')
    expect(r.acoes).toEqual([registrar({ unitId: 'u-asa-norte' })])
    const so: ContextoS1 = { ...CONTEXTO, unidades: [ASA_NORTE] }
    expect(resolverS3([completo({ unidade: null, espaco: '*' })], so, ESPACOS, SEG_14H, []).acoes).toEqual([registrar({ unitId: 'u-asa-norte' })])
  })

  it('mesmo pedido repetido na mensagem registra uma vez', () => {
    const r = resolverS3([completo({ espaco: '*' }), completo({ espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.acoes).toHaveLength(1)
    expect(r.texto).toBe(REG_AS_SAB)
  })
})

describe('resolverS3 — pedido já registrado', () => {
  const JA = 'Já temos seu pedido de aniversário para 40 convidados na unidade Asa Sul, sábado (10/10). Nossa equipe vai entrar em contato para confirmar.'

  it.each(['novo', 'em_contato'] as const)('pedido %s na mesma unidade e data: não registra de novo', (status) => {
    const r = resolverS3([completo({ espaco: 'salão principal', convidados: 50 })], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-sul', '2026-10-10', status)])
    expect(r.acoes).toEqual([])
    expect(r.texto).toBe(JA)
    expect(r.perguntar).toBeNull()
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('basta unidade e data: não volta a perguntar convidados nem tipo', () => {
    const r = resolverS3([ped({ unidade: 'asa sul', data: 'sábado', espaco: 'salão' })], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-sul', '2026-10-10')])
    expect(r.acoes).toEqual([])
    expect(r.texto).toBe(JA)
  })

  it('outra unidade ou outra data: registra normalmente', () => {
    expect(resolverS3([completo({ espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-norte', '2026-10-10')]).acoes).toEqual([registrar()])
    expect(resolverS3([completo({ espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-sul', '2026-10-11')]).acoes).toEqual([registrar()])
  })

  it('o texto nunca diz "confirmado"/"reservado"', () => {
    const r = resolverS3([completo()], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-sul', '2026-10-10')])
    expect(r.texto?.toLowerCase()).not.toMatch(/reservad|confirmad/)
  })
})

describe('resolverS3 — coleta guiada (um campo por vez: unidade → data → convidados → tipo)', () => {
  it('sem nada: pergunta a unidade pela lista', () => {
    const item = ped()
    const r = resolverS3([item], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.pendenteUnidade).toEqual([item])
    expect(r.perguntar).toEqual({ campo: 'unidade', item, unitId: null })
    expect(r.texto).toBeNull() // a pergunta é o corpo da lista
    expect(r.acoes).toEqual([])
    expect([r.validos, r.respondidos]).toEqual([0, 0])
  })

  it('com unidade: pergunta a data', () => {
    const r = resolverS3([ped({ unidade: 'asa sul', convidados: 40 })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Para qual data é o evento?')
    expect(r.perguntar).toEqual({ campo: 'data', unitId: 'u-asa-sul', item: ped({ unidade: 'Asa Sul', convidados: 40 }) })
  })

  it('data que não entende: pergunta a data de novo', () => {
    const r = resolverS3([ped({ unidade: 'asa sul', data: 'qualquer dia' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Para qual data é o evento?')
    expect(r.perguntar?.campo).toBe('data')
    expect(r.perguntar?.item.data).toBeNull()
  })

  it('com unidade e data: pergunta convidados', () => {
    const r = resolverS3([ped({ unidade: 'asa sul', data: 'sábado', tipoEvento: 'niver' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Para quantos convidados?')
    expect(r.perguntar).toEqual({
      campo: 'convidados', unitId: 'u-asa-sul', item: ped({ unidade: 'Asa Sul', data: '2026-10-10', tipoEvento: 'niver' }),
    })
  })

  it('falta só o tipo: pergunta o tipo', () => {
    const r = resolverS3([completo({ tipoEvento: null })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)')
    expect(r.perguntar?.campo).toBe('tipo')
  })

  it('item guardado e completado depois (a triagem devolve o item inteiro): registra', () => {
    const r1 = resolverS3([completo({ tipoEvento: null })], CONTEXTO, ESPACOS, SEG_14H, [])
    const r2 = resolverS3([{ ...r1.perguntar!.item, tipoEvento: 'aniversário', espaco: '*' }], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r2.acoes).toEqual([registrar()])
  })

  it('data hoje ⇒ fora da janela (de amanhã até hoje + 365)', () => {
    const r = resolverS3([completo({ data: 'hoje' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Consigo registrar pedidos de evento de amanhã até 05/10/2027. Qual data você prefere?')
    expect(r.acoes).toEqual([])
    expect(r.perguntar).toMatchObject({ campo: 'data', item: { data: null, convidados: 40 } })
  })

  it('hoje + 365 vale; hoje + 366 está fora', () => {
    expect(resolverS3([completo({ data: '05/10/2027', espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, []).acoes).toEqual([registrar({ data: '2027-10-05' })])
    const fora = resolverS3([completo({ data: '06/10/2027' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(fora.acoes).toEqual([])
    expect(fora.perguntar?.campo).toBe('data')
    expect(resolverS3([completo({ data: 'amanhã', espaco: '*' })], CONTEXTO, ESPACOS, SEG_14H, []).acoes).toEqual([registrar({ data: '2026-10-06' })])
  })

  it('convidados fora de 1–1000: informa o limite e pergunta de novo', () => {
    for (const n of [0, 1001, 2.5]) {
      const r = resolverS3([completo({ convidados: n })], CONTEXTO, ESPACOS, SEG_14H, [])
      expect(r.texto).toBe('Consigo registrar eventos de 1 a 1000 convidados. Para quantos convidados?')
      expect(r.perguntar).toMatchObject({ campo: 'convidados', item: { convidados: null } })
      expect(r.acoes).toEqual([])
    }
  })

  it('a ordem vale mesmo com outros campos inválidos: sem data, pergunta a data antes de reclamar dos convidados', () => {
    const r = resolverS3([ped({ unidade: 'asa sul', convidados: 5000 })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Para qual data é o evento?')
  })

  it('nenhuma unidade ativa: lacuna', () => {
    const r = resolverS3([completo()], { ...CONTEXTO, unidades: [] }, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
    expect(r.acoes).toEqual([])
  })
})

describe('resolverS3 — cancelar', () => {
  const p1 = pedido('p1', 'u-asa-sul', '2026-10-10')
  const p2 = pedido('p2', 'u-asa-norte', '2026-10-20')

  it('nenhum pedido ⇒ não encontrado', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(NAO_ACHOU)
    expect(r.acoes).toEqual([])
    expect([r.validos, r.respondidos]).toEqual([1, 0])
  })

  it('um pedido e sem alvo ⇒ cancela esse', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [p1])
    const texto = 'Pronto, cancelei seu pedido de evento: Asa Sul, sábado (10/10).'
    expect(r.texto).toBe(texto)
    expect(r.acoes).toEqual([{ tipo: 'cancelar_evento', pedidoId: 'p1', texto, textoSeFalhar: NAO_ACHOU }])
    expect(r.handoff).toBe(false)
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('vários sem alvo ⇒ lista com exemplo', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [p2, p1])
    expect(r.texto).toBe(
      'Você tem estes pedidos:\n• Asa Sul — sábado (10/10), 40 convidados, aniversário\n• Asa Norte — terça-feira (20/10), 40 convidados, aniversário\n'
      + 'Para cancelar, mande por exemplo: "cancela o pedido de evento de sábado na unidade Asa Sul".',
    )
    expect(r.acoes).toEqual([])
  })

  it('vários com alvo reconhecido ⇒ cancela o certo', () => {
    const r = resolverS3([can({ unidade: 'asa norte' })], CONTEXTO, ESPACOS, SEG_14H, [p1, p2])
    expect(r.acoes).toMatchObject([{ tipo: 'cancelar_evento', pedidoId: 'p2' }])
    expect(resolverS3([can({ data: 'dia 20' })], CONTEXTO, ESPACOS, SEG_14H, [p1, p2]).acoes).toMatchObject([{ pedidoId: 'p2' }])
  })

  it('alvo não reconhecido ⇒ lista (não cancela o errado)', () => {
    for (const alvo of [{ unidade: 'taguatinga' }, { data: 'qualquer dia' }]) {
      const r = resolverS3([can(alvo)], CONTEXTO, ESPACOS, SEG_14H, [p1])
      expect(r.acoes).toEqual([])
      expect(r.texto).toContain('Você tem estes pedidos:\n• Asa Sul — sábado (10/10), 40 convidados, aniversário')
    }
  })

  it('pedido confirmado ⇒ não cancela, chama a equipe', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [pedido('p3', 'u-asa-sul', '2026-10-10', 'confirmado')])
    expect(r.texto).toBe('Esse evento já foi confirmado pela equipe. Vou chamar um atendente para te ajudar.')
    expect(r.acoes).toEqual([])
    expect(r.handoff).toBe(true)
  })

  it('pedido de data passada não conta', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [pedido('p0', 'u-asa-sul', '2026-10-01')])
    expect(r.texto).toBe(NAO_ACHOU)
  })

  it('tipo extraído pelo LLM nunca é ecoado: "reserva confirmada" vira "evento" e só a equipe vê o texto', () => {
    const r = resolverS3([completo({ tipoEvento: 'reserva confirmada' })], CONTEXTO, [], SEG_14H, [])
    expect(r.texto).toMatch(/^Recebemos seu pedido de evento para 40 convidados/)
    expect(r.texto).not.toMatch(/confirmad|reservad/i)
    expect(r.acoes).toEqual([registrar({ tipoEvento: 'outro', tipoTexto: 'reserva confirmada' })])
  })

  it('outro tipo de evento aparece como "evento" na lista', () => {
    const r = resolverS3([can()], CONTEXTO, ESPACOS, SEG_14H, [p1, { ...p2, tipo: 'outro', convidados: 1 }])
    expect(r.texto).toContain('• Asa Norte — terça-feira (20/10), 1 convidado, evento')
  })
})

describe('resolverS3 — espaços', () => {
  it('unidade citada: lista os espaços dela', () => {
    const r = resolverS3([esp({ unidade: 'asa sul' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(`Espaços para eventos:\n${LINHA_SALAO}\n${LINHA_VARANDA}`)
    expect(r.lacunas).toEqual([])
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('poucas unidades e nenhuma citada: lista os de todas, na ordem das unidades', () => {
    const r = resolverS3([esp()], CONTEXTO_PEQUENO, [MEZANINO, VARANDA, SALAO], SEG_14H, [])
    expect(r.texto).toBe(`Espaços para eventos:\n${LINHA_SALAO}\n${LINHA_VARANDA}\n${LINHA_MEZANINO}`)
  })

  it('muitas unidades e nenhuma citada: pergunta a unidade pela lista', () => {
    const item = esp()
    const r = resolverS3([item], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.pendenteUnidade).toEqual([item])
    expect(r.perguntar).toBeNull()
    expect(r.texto).toBeNull()
  })

  it('com convidados: só os que comportam', () => {
    const r = resolverS3([esp({ unidade: 'asa sul', convidados: 20 })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe(`Espaços para eventos:\n${LINHA_VARANDA}`)
  })

  it('sem espaço cadastrado ⇒ lacuna eventos:espacos', () => {
    const r = resolverS3([esp({ unidade: 'lago sul' })], CONTEXTO, ESPACOS, SEG_14H, [])
    expect(r.texto).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
    expect(r.lacunas).toEqual([{ chave: 'eventos:espacos', unitId: 'u-lago-sul' }])
    expect([r.validos, r.respondidos]).toEqual([1, 0])
    expect(resolverS3([esp()], CONTEXTO_PEQUENO, [], SEG_14H, []).lacunas).toEqual([{ chave: 'eventos:espacos', unitId: null }])
  })
})

describe('resolverAtendimento com S3', () => {
  const h = (extra: Partial<ItemExtraido>): ItemExtraido => ({ servico: 'horario_unidades', tipo: 'horario_dia', ...nulos, ...extra })
  const reg = (extra: Partial<ItemExtraido>): ItemExtraido => ({ servico: 'aviso_presenca', tipo: 'registrar', ...nulos, ...extra })
  const AS_SABADO = 'Sábado (10/10), a unidade Asa Sul abre das 11h30 às 15h e das 18h às 2h.'

  it('S1 + S3 na mesma mensagem: junta as respostas e soma o indicador', () => {
    const r = resolverAtendimento(
      [h({ unidade: 'asa sul', data: 'sábado' }), completo({ espaco: '*' })], CONTEXTO, SEG_14H, [], undefined, { espacos: ESPACOS, pedidos: [] },
    )
    expect(r.texto).toBe(`${AS_SABADO}\n\n${REG_AS_SAB}`)
    expect(r.acoesS3).toEqual([registrar()])
    expect(r.acoesS2).toEqual([])
    expect(r.handoff).toBe(false)
    expect([r.validos, r.respondidos]).toEqual([2, 2])
  })

  it('S2 + S3 na mesma mensagem', () => {
    const r = resolverAtendimento(
      [reg({ unidade: 'asa sul', data: 'sábado', pessoas: 4 }), completo({ espaco: '*' })], CONTEXTO, SEG_14H, [], undefined, { espacos: ESPACOS, pedidos: [] },
    )
    expect(r.texto).toBe(`Anotado: Asa Sul, sábado (10/10), 4 pessoas. Se mudar de ideia, é só me avisar.\n\n${REG_AS_SAB}`)
    expect(r.acoesS2).toHaveLength(1)
    expect(r.acoesS3).toEqual([registrar()])
  })

  it('a pergunta do evento vai por último', () => {
    const r = resolverAtendimento([ped({ unidade: 'asa sul' }), h({ unidade: 'asa sul', data: 'sábado' })], CONTEXTO, SEG_14H, [], undefined, { espacos: [], pedidos: [] })
    expect(r.texto).toBe(`${AS_SABADO}\n\nPara qual data é o evento?`)
    expect(r.perguntarEvento).toMatchObject({ campo: 'data', unitId: 'u-asa-sul' })
  })

  it('só S3 esperando a unidade: lista com o texto do evento; escolhida, segue a coleta', () => {
    const item = ped({ data: 'sábado', convidados: 40, tipoEvento: 'aniversário', espaco: '*' })
    const r = resolverAtendimento([item], CONTEXTO, SEG_14H, [], undefined, { espacos: ESPACOS, pedidos: [] })
    expect(r.lista?.corpo).toBe('Para qual unidade é o evento? Toque em "Ver unidades" e escolha.')
    expect(r.pendente).toEqual([item])
    expect(r.perguntarEvento).toMatchObject({ campo: 'unidade' })
    expect(r.texto).toBeNull()
    const depois = resolverAtendimento(r.pendente, CONTEXTO, SEG_14H, [], 'u-asa-sul', { espacos: ESPACOS, pedidos: [] })
    expect(depois.acoesS3).toEqual([registrar()])
    expect(depois.lista).toBeNull()
  })

  it('com lista de unidade pendente do S1, a pergunta do evento espera (um dado por vez)', () => {
    const r = resolverAtendimento([ped({ unidade: 'asa sul' }), h({})], CONTEXTO, SEG_14H, [], undefined, { espacos: [], pedidos: [] })
    expect(r.lista?.corpo).toBe('De qual unidade você quer saber? Toque em "Ver unidades" e escolha.')
    expect(r.perguntarEvento).toBeNull()
    expect(r.texto).toBeNull()
  })

  it('cancelar pedido confirmado propaga o handoff e as lacunas do S3', () => {
    const r = resolverAtendimento(
      [can(), ped({ tipo: 'espacos', unidade: 'lago sul' })], CONTEXTO, SEG_14H, [], undefined,
      { espacos: ESPACOS, pedidos: [pedido('p3', 'u-asa-sul', '2026-10-10', 'confirmado')] },
    )
    expect(r.handoff).toBe(true)
    expect(r.lacunas).toEqual([{ chave: 'eventos:espacos', unitId: 'u-lago-sul' }])
  })

  it('sem o contexto do S3: itens de evento são resolvidos sem espaços nem pedidos', () => {
    const r = resolverAtendimento([completo()], CONTEXTO_PEQUENO, SEG_14H, [])
    expect(r.acoesS3).toEqual([registrar()])
    expect(r.texto).toBe(REG_AS_SAB)
  })
})

describe('textos de evento', () => {
  it('nenhum modelo de evento diz "confirmado" (exceto o handoff) nem "reservado"', () => {
    const chaves = (Object.keys(MODELOS_S1) as ChaveModelo[]).filter((c) => c.startsWith('evento_'))
    expect(chaves.length).toBeGreaterThanOrEqual(13)
    for (const c of chaves) {
      const texto = MODELOS_S1[c].texto.toLowerCase()
      expect(texto, c).not.toMatch(/reservad/)
      if (c !== 'evento_confirmado_humano') expect(texto, c).not.toMatch(/confirmad/)
    }
  })

  it('respostas do S3 (todas as regras acima) nunca dizem "reservado"', () => {
    const r = resolverS3([completo(), can()], CONTEXTO, ESPACOS, SEG_14H, [pedido('p1', 'u-asa-sul', '2026-10-10')])
    expect(r.texto?.toLowerCase()).not.toMatch(/reservad|confirmad/)
  })

  it('modelo personalizado do restaurante é usado', () => {
    const ctx = { ...CONTEXTO, modelos: { evento_pergunta_data: 'Qual dia?' } }
    expect(resolverS3([ped({ unidade: 'asa sul' })], ctx, [], SEG_14H, []).texto).toBe('Qual dia?')
    expect(renderModelo('evento_registrado', { tipo: 'casamento', convidados: '2 convidados', unidade: 'X', quando: 'amanhã', espaco: '' }))
      .toBe(`Recebemos seu pedido de casamento para 2 convidados na unidade X, amanhã. ${FIM}`)
  })
})
