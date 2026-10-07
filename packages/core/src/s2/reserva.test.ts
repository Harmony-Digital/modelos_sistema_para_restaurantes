import { describe, expect, it } from 'vitest'
import { AGUAS_CLARAS, ASA_NORTE, ASA_SUL, CONTEXTO, LAGO_SUL } from '../../../ai/evals/s1/fixture.ts'
import type { ContextoS1, ItemExtraido, UnidadeS1 } from '../s1/tipos.ts'
import { resolverAtendimento, retomarPerguntaEvento } from './atendimento.ts'
import { continuarReserva, diasDaReserva, limparNome, resolverS2 } from './resolver.ts'
import type { AcaoS2, AvisoAtivoS2, CampoReserva, ContextoReserva, PerguntaReserva, VagasUnidade } from './tipos.ts'

const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const SAB = '2026-10-10'
const REGRAS = 'Guardamos o lugar por até 15 minutos.'
const nulos = { unidade: null, data: null, tema: null, pessoas: null, horario: null, convidados: null, tipoEvento: null, espaco: null, consulta: null, tag: null }
const reg = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ({ servico: 'aviso_presenca', tipo: 'registrar', ...nulos, ...extra })
const can = (extra: Partial<ItemExtraido> = {}): ItemExtraido => reg({ tipo: 'cancelar', ...extra })
const ped = (extra: Partial<ItemExtraido> = {}): ItemExtraido => ({ servico: 'evento', tipo: 'pedido', ...nulos, ...extra })

type Ocupacao = Record<string, Record<string, VagasUnidade>>
const pendente = (campo: CampoReserva, extra: Partial<PerguntaReserva> = {}): PerguntaReserva =>
  ({ campo, item: reg(), unitId: null, tentativasNumero: 0, ...extra })
/** Por padrão a mensagem responde à pergunta de contato: só assim o core aceita `contato_ok` do item. */
const rc = (ocupacao: Ocupacao = {}, extra: Partial<ContextoReserva> = {}): ContextoReserva => ({
  vagas: new Map(Object.entries(ocupacao).map(([dia, us]) => [dia, new Map(Object.entries(us))])),
  regras: REGRAS,
  pergunta: pendente('contato'),
  ...extra,
})
const respostaNumero = (valor: string | null, tentativas: number): Partial<ContextoReserva> =>
  ({ pergunta: pendente('contato_numero', { tentativasNumero: tentativas }), numero: { valor, tentativas } })
const completo = (extra: Partial<ItemExtraido> = {}) =>
  reg({ unidade: 'asa sul', data: 'sábado', pessoas: 4, horario: '20h', nome: 'Ana Souza', contato_ok: true, ...extra })
const CONFIRMADA_AS = `Reserva feita: unidade Asa Sul, sábado (10/10), às 20h, 4 pessoas, em nome de Ana Souza.\n\n${REGRAS}`
const PERGUNTA_DATA = 'Para qual dia é a reserva? Consigo reservar de hoje até 04/11.'
const LOTADA_AS = 'A unidade Asa Sul está lotada no sábado (10/10) para 4 pessoas.'
const OUTRO_DIA = 'Se preferir, me diga outro dia.'
const reservaAtiva = (extra: Partial<AvisoAtivoS2> = {}): AvisoAtivoS2 =>
  ({ id: 'r1', unitId: 'u-asa-sul', data: SAB, pessoas: 4, horarioAprox: null, horario: '20:00', nome: 'Ana Souza', ...extra })
const registrar = (extra: Partial<Extract<AcaoS2, { tipo: 'registrar' }>> = {}) => ({
  tipo: 'registrar', unitId: 'u-asa-sul', data: SAB, pessoas: 4, horario: '20:00', nome: 'Ana Souza', contato: 'whatsapp',
  atualiza: false, texto: CONFIRMADA_AS, textoSeLotado: expect.any(String), ...extra,
})

describe('reserva — item completo', () => {
  it('vai direto para a confirmação com o resumo e as regras', () => {
    const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe(CONFIRMADA_AS)
    expect(r.acoes).toEqual([registrar()])
    expect(r.perguntarReserva).toBeNull()
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('cabe na lotação (ocupação + pessoas = capacidade)', () => {
    const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc({ [SAB]: { 'u-asa-sul': { ocupadas: 146, capacidade: 150 } } }))
    expect(r.acoes).toEqual([registrar()])
  })

  it('texto de corrida pronto: lotado com as outras unidades e outro dia, sem grupo menor (as vagas mudaram)', () => {
    const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc({ [SAB]: { 'u-asa-sul': { ocupadas: 146, capacidade: 150 } } }))
    const acao = r.acoes[0] as Extract<AcaoS2, { tipo: 'registrar' }>
    expect(acao.textoSeLotado).toBe(`${LOTADA_AS} Nesse dia, temos vaga para 4 pessoas em: Asa Norte, Lago Sul e Águas Claras. ${OUTRO_DIA}`)
  })

  it('reserva repetida na mesma mensagem: vale a última', () => {
    const r = resolverS2([completo(), completo({ pessoas: 6 })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.acoes).toEqual([registrar({ pessoas: 6, texto: CONFIRMADA_AS.replace('4 pessoas', '6 pessoas') })])
    expect(r.texto).toBe(CONFIRMADA_AS.replace('4 pessoas', '6 pessoas'))
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })
})

describe('reserva — um dado por vez, nesta ordem', () => {
  it('sem unidade (várias unidades): lista "Para qual unidade é a reserva?"', () => {
    const item = reg({ data: 'sábado', pessoas: 4 })
    const r = resolverAtendimento([item], CONTEXTO, SEG_14H, [], undefined, undefined, undefined, rc())
    expect(r.lista?.corpo).toBe('Para qual unidade é a reserva? Toque em "Ver unidades" e escolha.')
    expect(r.pendente).toEqual([item])
    expect(r.perguntarReserva).toEqual({ campo: 'unidade', item, unitId: null, tentativasNumero: 0 })
    expect(r.texto).toBeNull()
  })

  it('unidade → data → pessoas → horário → nome → contato → confirmada', () => {
    const passos: [Partial<ItemExtraido>, string, string][] = [
      [{}, 'data', PERGUNTA_DATA],
      [{ data: 'sábado' }, 'pessoas', 'Para quantas pessoas?'],
      [{ pessoas: 4 }, 'horario', 'Para que horas é a reserva?'],
      [{ horario: '20h' }, 'nome', 'Em nome de quem fica a reserva?'],
      [{ nome: 'Ana Souza' }, 'contato', 'Posso usar este número do WhatsApp para falar com você sobre a reserva?'],
    ]
    let item = reg({ unidade: 'asa sul' })
    let unitId: string | undefined
    for (const [resposta, campo, texto] of passos) {
      const r = resolverS2([{ ...item, ...resposta }], CONTEXTO, SEG_14H, [], unitId, rc())
      expect(r.texto, campo).toBe(texto)
      expect(r.acoes, campo).toEqual([])
      expect(r.perguntarReserva, campo).toMatchObject({ campo, unitId: 'u-asa-sul', tentativasNumero: 0 })
      expect([r.validos, r.respondidos], campo).toEqual([0, 0])
      item = r.perguntarReserva!.item
      unitId = r.perguntarReserva!.unitId!
    }
    // o item guardado traz o que já foi validado
    expect(item).toMatchObject({ unidade: 'Asa Sul', data: SAB, pessoas: 4, horario: '20:00', nome: 'Ana Souza', contato_ok: null })
    const fim = resolverS2([{ ...item, contato_ok: true }], CONTEXTO, SEG_14H, [], unitId, rc())
    expect(fim.texto).toBe(CONFIRMADA_AS)
    expect(fim.acoes).toEqual([registrar()])
  })

  it('só uma pergunta por mensagem', () => {
    const r = resolverS2([reg({ unidade: 'asa sul' }), reg({ unidade: 'asa norte', data: 'amanhã' })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe(PERGUNTA_DATA)
    expect(r.perguntarReserva).toMatchObject({ campo: 'data', unitId: 'u-asa-sul' })
  })

  it('data fora do prazo ou não entendida: pergunta o dia de novo', () => {
    for (const data of ['20/11', 'semana retrasada']) {
      const r = resolverS2([completo({ data })], CONTEXTO, SEG_14H, [], undefined, rc())
      expect(r.texto, data).toBe(PERGUNTA_DATA)
      expect(r.perguntarReserva, data).toMatchObject({ campo: 'data', item: { data: null, pessoas: 4 } })
      expect(r.acoes).toEqual([])
    }
  })

  it('unidade fechada no dia: diz e pergunta outro dia', () => {
    const r = resolverS2([completo({ data: 'hoje' })], CONTEXTO, SEG_14H, [], undefined, rc()) // Asa Sul não abre segunda
    expect(r.texto).toBe(`Hoje, a unidade Asa Sul não abre. ${PERGUNTA_DATA}`)
    expect(r.perguntarReserva).toMatchObject({ campo: 'data' })
  })

  it('pessoas inválidas: pergunta de novo', () => {
    for (const pessoas of [0, 2.5]) {
      const r = resolverS2([completo({ pessoas })], CONTEXTO, SEG_14H, [], undefined, rc())
      expect(r.perguntarReserva, String(pessoas)).toMatchObject({ campo: 'pessoas', item: { pessoas: null } })
    }
  })
})

describe('reserva — horário', () => {
  const FORA_AS_SAB = 'Sábado (10/10), a unidade Asa Sul funciona das 11h30 às 15h e das 18h às 2h. Para que horas é a reserva?'

  it('fora do funcionamento: horário do dia e a pergunta de novo, sem gravar', () => {
    const r = resolverS2([completo({ horario: '16h' })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe(FORA_AS_SAB)
    expect(r.acoes).toEqual([])
    expect(r.perguntarReserva).toMatchObject({ campo: 'horario', item: { horario: null, pessoas: 4 } })
  })

  it('"à noite" não é horário: mostra o funcionamento e pergunta', () => {
    const r = resolverS2([completo({ horario: 'à noite' })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe(FORA_AS_SAB)
    expect(r.acoes).toEqual([])
  })

  it('madrugada de turno que cruza a meia-noite vale', () => {
    const r = resolverS2([completo({ horario: '1h' })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.acoes).toEqual([registrar({ horario: '01:00', texto: CONFIRMADA_AS.replace('às 20h', 'à 1h') })])
  })

  it('horário de hoje que já passou', () => {
    const r = resolverS2([completo({ unidade: 'asa norte', data: 'hoje', horario: '11h' })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe('Esse horário de hoje já passou. Para que horas é a reserva?')
    expect(r.perguntarReserva).toMatchObject({ campo: 'horario' })
  })

  it('unidade sem horário cadastrado: aceita o HH:MM e, sem ele, só pergunta', () => {
    const semHorario: UnidadeS1 = { ...ASA_NORTE, semanal: [[], [], [], [], [], [], []], excecoes: {} }
    const ctx: ContextoS1 = { ...CONTEXTO, unidades: [semHorario] }
    expect(resolverS2([completo({ unidade: null, horario: '9h' })], ctx, SEG_14H, [], undefined, rc()).acoes).toHaveLength(1)
    const r = resolverS2([completo({ unidade: null, horario: 'à noite' })], ctx, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe('Para que horas é a reserva?')
  })
})

describe('reserva — nome e contato', () => {
  it('nome com marcador de PII ou sem letras: pergunta o nome', () => {
    for (const nome of ['[TELEFONE]', '123', '  ']) {
      const r = resolverS2([completo({ nome })], CONTEXTO, SEG_14H, [], undefined, rc())
      expect(r.perguntarReserva, nome).toMatchObject({ campo: 'nome' })
    }
  })

  it('contato_ok só vale respondendo à pergunta de contato', () => {
    for (const extra of [{ pergunta: null }, { pergunta: pendente('nome') }]) {
      const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc({}, extra))
      expect(r.acoes).toEqual([])
      expect(r.perguntarReserva).toMatchObject({ campo: 'contato', item: { contato_ok: null } })
    }
    // o "não" já respondido e guardado no pendente segue valendo (a v7 devolve null quando o cliente manda só o número)
    const r = resolverS2([completo({ contato_ok: null })], CONTEXTO, SEG_14H, [], undefined, rc({}, respostaNumero('+5561999998888', 0)))
    expect(r.acoes).toEqual([registrar({ contato: { numero: '+5561999998888' } })])
  })

  it('número capturado só vale com a pergunta do número pendente', () => {
    const r = resolverS2([completo({ contato_ok: false })], CONTEXTO, SEG_14H, [], undefined,
      rc({}, { numero: { valor: '+5561999998888', tentativas: 0 } })) // pendente era a pergunta de contato
    expect(r.acoes).toEqual([])
    expect(r.perguntarReserva).toMatchObject({ campo: 'contato_numero', tentativasNumero: 0 })
  })

  it('limparNome tira o que não é nome e corta em 80', () => {
    expect(limparNome('  Ana   <b>Souza</b> ')).toBe('Ana b Souza b')
    expect(limparNome("D'Ávila-Lima Jr.")).toBe("D'Ávila-Lima Jr.")
    expect(limparNome('a'.repeat(100))).toHaveLength(80)
    expect(limparNome(null)).toBeNull()
  })

  it('não pode usar o WhatsApp: pede o número', () => {
    const r = resolverS2([completo({ contato_ok: false })], CONTEXTO, SEG_14H, [], undefined, rc())
    expect(r.texto).toBe('Qual número devo usar para falar com você sobre a reserva? Mande com DDD, por exemplo: (61) 99999-8888.')
    expect(r.perguntarReserva).toMatchObject({ campo: 'contato_numero', tentativasNumero: 0, item: { contato_ok: false, nome: 'Ana Souza' } })
  })

  it('número capturado pelo worker vai na ação', () => {
    const r = resolverS2([completo({ contato_ok: false })], CONTEXTO, SEG_14H, [], undefined,
      rc({}, respostaNumero('+5561999998888', 0)))
    expect(r.acoes).toEqual([registrar({ contato: { numero: '+5561999998888' } })])
  })

  it('primeira falha do número: pede de novo; segunda: segue com o WhatsApp e avisa', () => {
    const r1 = resolverS2([completo({ contato_ok: false })], CONTEXTO, SEG_14H, [], undefined, rc({}, respostaNumero(null, 0)))
    expect(r1.texto).toBe('Não consegui ler esse número. Mande com DDD, por exemplo: (61) 99999-8888.')
    expect(r1.perguntarReserva).toMatchObject({ campo: 'contato_numero', tentativasNumero: 1 })
    expect(r1.acoes).toEqual([])
    const r2 = resolverS2([r1.perguntarReserva!.item], CONTEXTO, SEG_14H, [], 'u-asa-sul',
      rc({}, respostaNumero(null, r1.perguntarReserva!.tentativasNumero)))
    expect(r2.texto).toBe(`Não consegui ler o número, então vou usar este número do WhatsApp para falar com você sobre a reserva.\n\n${CONFIRMADA_AS}`)
    expect(r2.acoes).toEqual([registrar({ contato: 'whatsapp' })])
    expect(r2.perguntarReserva).toBeNull()
  })
})

describe('reserva — lotado', () => {
  const cheio = (extra: Record<string, VagasUnidade> = {}): Ocupacao =>
    ({ [SAB]: { 'u-asa-sul': { ocupadas: 147, capacidade: 150 }, ...extra } })

  it('três ofertas: outras unidades, outro dia e grupo menor; nada é gravado', () => {
    const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc(cheio()))
    expect(r.texto).toBe(`${LOTADA_AS} Nesse dia, temos vaga para 4 pessoas em: Asa Norte, Lago Sul e Águas Claras. ${OUTRO_DIA} Na unidade Asa Sul, ainda temos vaga para até 3 pessoas.`)
    expect(r.acoes).toEqual([])
    // a reserva fica pendente com o que já foi dito (sem unidade fixa): "e no domingo?", "e na Asa Norte?", "e para 3?"
    expect(r.perguntarReserva).toEqual({
      campo: 'lotado', unitId: null, tentativasNumero: 0,
      item: { ...completo(), unidade: 'Asa Sul', data: SAB, horario: '20:00', contato_ok: null },
    })
    expect([r.validos, r.respondidos]).toEqual([1, 1])
  })

  it('decide logo depois das pessoas: não pergunta horário, nome nem contato', () => {
    const r = resolverS2([reg({ unidade: 'asa sul', data: 'sábado', pessoas: 4 })], CONTEXTO, SEG_14H, [], undefined, rc(cheio()))
    expect(r.texto).toContain(LOTADA_AS)
    expect(r.texto).not.toContain('?')
    expect(r.perguntarReserva).toMatchObject({ campo: 'lotado', item: { pessoas: 4, data: SAB, unidade: 'Asa Sul' } })
  })

  describe('continua depois do lotado sem recomeçar', () => {
    const lotado = () => resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc(cheio())).perguntarReserva!
    const continuar = (novo: Partial<ItemExtraido>) => {
      const p = lotado()
      // o worker junta a resposta ao item guardado; contato_ok só vale respondendo à pergunta de contato
      return resolverS2([continuarReserva(p, reg(novo))], CONTEXTO, SEG_14H, [], p.unitId ?? undefined, rc(cheio(), { pergunta: p }))
    }
    const contatoDe = (r: ReturnType<typeof continuar>) => {
      expect(r.texto).toBe('Posso usar este número do WhatsApp para falar com você sobre a reserva?')
      expect(r.acoes).toEqual([])
      return r.perguntarReserva!
    }

    it('"e na sexta?": outro dia, mesmas pessoas, horário e nome', () => {
      expect(contatoDe(continuar({ data: 'sexta' }))).toMatchObject({
        campo: 'contato', unitId: 'u-asa-sul', item: { unidade: 'Asa Sul', data: '2026-10-09', pessoas: 4, horario: '20:00', nome: 'Ana Souza' },
      })
    })

    it('"e na Asa Norte?": outra unidade, mesmo dia', () => {
      expect(contatoDe(continuar({ unidade: 'asa norte' }))).toMatchObject({
        campo: 'contato', unitId: 'u-asa-norte', item: { unidade: 'Asa Norte', data: SAB, pessoas: 4, horario: '20:00' },
      })
    })

    it('"e para 3?": grupo menor que cabe', () => {
      expect(contatoDe(continuar({ pessoas: 3 }))).toMatchObject({ campo: 'contato', item: { unidade: 'Asa Sul', data: SAB, pessoas: 3 } })
    })

    it('"e no domingo?" com horário fora do domingo: pergunta só o horário', () => {
      const r = continuar({ data: 'domingo' })
      expect(r.perguntarReserva).toMatchObject({ campo: 'horario', item: { data: '2026-10-11', pessoas: 4, nome: 'Ana Souza' } })
    })

    it('cancelar não é continuação', () => {
      const novo = can()
      expect(continuarReserva(lotado(), novo)).toBe(novo)
    })
  })

  it('só as ofertas que existem: outras cheias ou fechadas e sem vaga nenhuma', () => {
    const ocupacao = cheio({
      'u-asa-sul': { ocupadas: 150, capacidade: 150 },
      'u-asa-norte': { ocupadas: 98, capacidade: 100 }, // só 2 vagas
      'u-lago-sul': { ocupadas: 0, capacidade: 3 },
    })
    const semAC: ContextoS1 = { ...CONTEXTO, unidades: [ASA_SUL, ASA_NORTE, LAGO_SUL] }
    const r = resolverS2([completo()], semAC, SEG_14H, [], undefined, rc(ocupacao))
    expect(r.texto).toBe(`${LOTADA_AS} ${OUTRO_DIA}`)
  })

  it('outras unidades: até 3, na ordem, só as abertas no dia', () => {
    const extras = ['Taguatinga', 'Sudoeste'].map((nome, i): UnidadeS1 => ({ ...ASA_NORTE, id: `u-x${i}`, nome, ordem: 10 + i }))
    const fechadaSab: UnidadeS1 = { ...AGUAS_CLARAS, semanal: [[], [], [], [], [], [], []].map((d, i) => (i === 6 ? [] : [{ abre: '18:00', fecha: '23:00' }])) }
    const ctx: ContextoS1 = { ...CONTEXTO, unidades: [ASA_SUL, ASA_NORTE, LAGO_SUL, fechadaSab, ...extras] }
    const r = resolverS2([completo()], ctx, SEG_14H, [], undefined, rc(cheio()))
    expect(r.texto).toContain('em: Asa Norte, Lago Sul e Taguatinga.')
  })

  it('sem capacidade cadastrada (ou sem leitura do dia) não bloqueia', () => {
    const r = resolverS2([completo()], CONTEXTO, SEG_14H, [], undefined, rc({ [SAB]: { 'u-asa-sul': { ocupadas: 999, capacidade: null } } }))
    expect(r.acoes).toHaveLength(1)
  })
})

describe('reserva — mudança', () => {
  const ativa = reservaAtiva()

  it('diminuir nunca bloqueia, mesmo com a unidade acima da lotação', () => {
    const r = resolverS2([reg({ pessoas: 3 })], CONTEXTO, SEG_14H, [ativa], undefined, rc({ [SAB]: { 'u-asa-sul': { ocupadas: 160, capacidade: 150 } } }))
    expect(r.acoes).toEqual([registrar({
      pessoas: 3, contato: 'manter', atualiza: true, reservaId: 'r1', texto: CONFIRMADA_AS.replace('4 pessoas', '3 pessoas'),
    })])
  })

  it('aumentar desconta a própria reserva da ocupação', () => {
    const vagas = rc({ [SAB]: { 'u-asa-sul': { ocupadas: 148, capacidade: 150 } } }) // 4 delas são da própria
    const r = resolverS2([reg({ unidade: 'asa sul', data: 'sábado', pessoas: 6 })], CONTEXTO, SEG_14H, [ativa], undefined, vagas)
    expect(r.acoes).toEqual([registrar({
      pessoas: 6, contato: 'manter', atualiza: true, reservaId: 'r1', texto: CONFIRMADA_AS.replace('4 pessoas', '6 pessoas'),
    })])
    const lotado = resolverS2([reg({ pessoas: 7 })], CONTEXTO, SEG_14H, [ativa], undefined, vagas)
    expect(lotado.acoes).toEqual([])
    expect(lotado.texto).toContain('Na unidade Asa Sul, ainda temos vaga para até 6 pessoas.')
  })

  it('mudar o horário mantém o resto', () => {
    const r = resolverS2([reg({ horario: '21h' })], CONTEXTO, SEG_14H, [ativa], undefined, rc())
    expect(r.acoes).toEqual([registrar({
      horario: '21:00', contato: 'manter', atualiza: true, reservaId: 'r1', texto: CONFIRMADA_AS.replace('às 20h', 'às 21h'),
    })])
  })

  it('pedido sem nada a mudar, com uma reserva ativa, é reserva nova: pergunta o que falta', () => {
    for (const item of [reg(), reg({ contato_ok: true })]) {
      const r = resolverS2([item], CONTEXTO, SEG_14H, [ativa], undefined, rc())
      expect(r.acoes).toEqual([])
      expect(r.perguntarReserva).toMatchObject({ campo: 'unidade' })
      const so = resolverS2([item], { ...CONTEXTO, unidades: [ASA_SUL] }, SEG_14H, [ativa], undefined, rc())
      expect(so.acoes).toEqual([])
      expect(so.texto).toBe(PERGUNTA_DATA)
    }
  })

  it('nome novo sem unidade nem dia também é mudança da única reserva', () => {
    const r = resolverS2([reg({ nome: 'Bia Lima' })], CONTEXTO, SEG_14H, [ativa], undefined, rc())
    expect(r.acoes).toEqual([registrar({
      nome: 'Bia Lima', contato: 'manter', atualiza: true, reservaId: 'r1', texto: CONFIRMADA_AS.replace('Ana Souza', 'Bia Lima'),
    })])
  })

  it('aviso antigo sem horário nem nome: pergunta o que falta', () => {
    const antigo = reservaAtiva({ horario: null, nome: null, horarioAprox: 'à noite' })
    const r = resolverS2([reg({ pessoas: 5 })], CONTEXTO, SEG_14H, [antigo], undefined, rc())
    expect(r.perguntarReserva).toMatchObject({ campo: 'horario', item: { pessoas: 5, data: SAB, unidade: 'Asa Sul' } })
  })
})

describe('reserva — cancelar', () => {
  it('cancela a única reserva', () => {
    const r = resolverS2([can()], CONTEXTO, SEG_14H, [reservaAtiva()], undefined, rc())
    const texto = 'Pronto, cancelei sua reserva: Asa Sul, sábado (10/10).'
    expect(r.texto).toBe(texto)
    expect(r.acoes).toEqual([{ tipo: 'cancelar', avisoId: 'r1', texto, textoSeFalhar: 'Não encontrei nenhuma reserva sua.' }])
  })

  it('sem reserva: diz que não encontrou', () => {
    expect(resolverS2([can()], CONTEXTO, SEG_14H, [], undefined, rc()).texto).toBe('Não encontrei nenhuma reserva sua.')
  })

  it('várias: lista e dá o exemplo de frase', () => {
    const r = resolverS2([can()], CONTEXTO, SEG_14H, [reservaAtiva(), reservaAtiva({ id: 'r2', unitId: 'u-asa-norte', data: '2026-10-05', pessoas: 2 })], undefined, rc())
    expect(r.texto).toBe('Você tem estas reservas:\n• Asa Norte — hoje, 2 pessoas\n• Asa Sul — sábado (10/10), 4 pessoas\nPara cancelar, mande por exemplo: "cancela a reserva de hoje na unidade Asa Norte".')
    expect(r.acoes).toEqual([])
  })
})

describe('reserva — mais de 60 pessoas vira pedido de evento', () => {
  it('segue a coleta do evento com o que o cliente já disse', () => {
    const r = resolverAtendimento([reg({ unidade: 'asa sul', data: 'dia 20', pessoas: 80, horario: '20h' })], CONTEXTO, SEG_14H, [],
      undefined, { espacos: [], pedidos: [] }, undefined, rc())
    expect(r.acoesS2).toEqual([])
    expect(r.perguntarReserva).toBeNull()
    expect(r.texto).toBe('Reservas vão até 60 pessoas. Para um grupo maior, registro um pedido de evento e a nossa equipe entra em contato.\n\n'
      + 'Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)')
    expect(r.perguntarEvento).toMatchObject({ campo: 'tipo', item: { servico: 'evento', convidados: 80, unidade: 'Asa Sul', data: '2026-10-20' } })
  })

  it('"seremos 80" sobre a única reserva: o evento herda a unidade e o dia dela', () => {
    const r = resolverAtendimento([reg({ pessoas: 80 })], CONTEXTO, SEG_14H, [reservaAtiva({ data: '2026-10-20' })],
      undefined, { espacos: [], pedidos: [] }, undefined, rc())
    expect(r.lista).toBeNull()
    expect(r.perguntarEvento).toMatchObject({ campo: 'tipo', item: { convidados: 80, unidade: 'Asa Sul', data: '2026-10-20' } })
  })

  it('sem o contexto da reserva (worker antigo), segue o limite do aviso', () => {
    const r = resolverAtendimento([reg({ unidade: 'asa sul', data: 'sábado', pessoas: 80 })], CONTEXTO, SEG_14H, [])
    expect(r.texto).toBe('Consigo anotar avisos de 1 a 60 pessoas. Para grupos maiores, fale com a nossa equipe.')
  })
})

describe('reserva — prioridade das perguntas (lista > reserva > evento)', () => {
  it('a pergunta da reserva sai e a do evento fica adiada', () => {
    const r = resolverAtendimento([reg({ unidade: 'asa sul', data: 'sábado' }), ped({ unidade: 'asa sul', data: 'dia 20', tipoEvento: 'aniversário' })],
      CONTEXTO, SEG_14H, [], undefined, { espacos: [], pedidos: [] }, undefined, rc())
    expect(r.texto).toBe('Para quantas pessoas?')
    expect(r.perguntarReserva).toMatchObject({ campo: 'pessoas' })
    expect(r.perguntarEvento).toBeNull()
    expect(r.perguntaEventoAdiada).toMatchObject({ campo: 'convidados' })
    // com a reserva ainda perguntando, a do evento continua guardada
    expect(retomarPerguntaEvento(r, r.perguntaEventoAdiada)).toBe(r)
  })

  it('lista de unidade de outro item esconde a pergunta da reserva', () => {
    const r = resolverAtendimento([reg({ unidade: 'asa sul' }), { ...reg(), servico: 'horario_unidades', tipo: 'horario_dia' }],
      CONTEXTO, SEG_14H, [], undefined, undefined, undefined, rc())
    expect(r.lista).not.toBeNull()
    expect(r.perguntarReserva).toBeNull()
    expect(r.texto).toBeNull()
  })
})

describe('diasDaReserva', () => {
  it('dias que o worker precisa ler a ocupação', () => {
    expect(diasDaReserva([completo(), reg({ data: 'amanhã' }), can({ data: 'hoje' }), reg({ data: '20/11' })], CONTEXTO, SEG_14H, []))
      .toEqual(['2026-10-06', SAB])
    expect(diasDaReserva([reg({ pessoas: 6 })], CONTEXTO, SEG_14H, [reservaAtiva()])).toEqual([SAB])
    expect(diasDaReserva([reg({ pessoas: 6 })], CONTEXTO, SEG_14H, [])).toEqual([])
  })
})
