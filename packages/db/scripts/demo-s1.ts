/** Dados de demonstração de S1 no restaurante local (idempotente). Só para desenvolvimento/homologação local. */
import { and, eq, inArray } from 'drizzle-orm'
import { createDb, ehBancoLocal, getSingleRestaurantId, schema } from '../src/index.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('Defina DATABASE_URL')
if (!ehBancoLocal(url)) throw new Error('demo:s1 só roda no banco local')

type T = { abre: string; fecha: string }
const almoco = { abre: '11:30', fecha: '15:00' }
const jantar = { abre: '18:00', fecha: '23:00' }
const jantarTarde = { abre: '18:00', fecha: '02:00' }
const todoDia = (t: T): T[][] => Array.from({ length: 7 }, () => [t])
const lago = { abre: '12:00', fecha: '16:00' }
const noite = { abre: '18:00', fecha: '23:00' }
const diaTodo = { abre: '12:00', fecha: '23:00' }

const UNIDADES = [
  {
    slug: 'asa-sul', nome: 'Asa Sul', ordem: 1, apelidos: ['204 sul'],
    endereco: 'SCLS 404 Bloco C', bairro: 'Asa Sul', cidade: 'Brasília', uf: 'DF', lat: -15.8136, lng: -47.896,
    mapsUrl: 'https://www.google.com/maps/@-15.8136,-47.896,17z',
    semanal: [[{ abre: '11:30', fecha: '16:00' }], [], [almoco, jantar], [almoco, jantar], [almoco, jantar], [almoco, jantarTarde], [almoco, jantarTarde]],
    excecoes: [{ data: '2026-12-25', fechado: true, turnos: [] as T[], motivo: 'Natal' }],
  },
  {
    slug: 'asa-norte', nome: 'Asa Norte', ordem: 2, apelidos: [],
    endereco: 'SCLN 302 Bloco B', bairro: 'Asa Norte', cidade: 'Brasília', uf: 'DF', lat: -15.7801, lng: -47.8829,
    mapsUrl: 'https://www.google.com/maps/@-15.7801,-47.8829,17z',
    semanal: todoDia({ abre: '11:00', fecha: '23:00' }),
    excecoes: [{ data: '2026-12-24', fechado: false, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Véspera de Natal' }],
  },
  {
    slug: 'lago-sul', nome: 'Lago Sul', ordem: 3, apelidos: [],
    endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', lat: null, lng: null, mapsUrl: null,
    semanal: [[lago], [], [lago], [lago], [lago], [lago], [lago]],
    excecoes: [],
  },
  {
    slug: 'aguas-claras', nome: 'Águas Claras', ordem: 4, apelidos: ['AC'],
    endereco: null, bairro: 'Águas Claras', cidade: 'Brasília', uf: 'DF', lat: null, lng: null, mapsUrl: null,
    semanal: [[diaTodo], [noite], [noite], [noite], [noite], [noite], [diaTodo]],
    excecoes: [],
  },
]

const FATOS = [
  { tema: 'Estacionamento', exemplos: ['tem vaga', 'onde estacionar'], texto: 'Temos estacionamento gratuito para clientes em todas as unidades.', unidade: null },
  { tema: 'Wi-Fi', exemplos: ['senha do wifi', 'internet'], texto: 'A senha do Wi-Fi está no cardápio da mesa.', unidade: 'asa-sul' },
  { tema: 'Pet friendly', exemplos: ['aceita cachorro', 'pode levar animal'], texto: 'Aceitamos pets na área externa, com coleira.', unidade: null },
  { tema: 'Música ao vivo', exemplos: ['tem show'], texto: 'Sextas e sábados tem música ao vivo a partir das 20h.', unidade: 'asa-norte' },
  { tema: 'Formas de pagamento', exemplos: ['aceita pix', 'cartao', 'vale refeicao'], texto: 'Aceitamos Pix, cartões de crédito e débito e vale-refeição.', unidade: null },
  { tema: 'Acessibilidade', exemplos: ['cadeirante', 'rampa'], texto: 'A unidade tem rampa de acesso e banheiro adaptado.', unidade: 'lago-sul' },
]

// Cardápio de demonstração (S4): preço em centavos; exceções por unidade (preço próprio / indisponível)
const CARDAPIO = [
  {
    categoria: 'Carnes', ordem: 1,
    itens: [
      { nome: 'Picanha na brasa', descricao: 'Com farofa, vinagrete e mandioca', precoCentavos: 8990, tags: [], outrosNomes: ['picanha'], excecoes: [{ unidade: 'asa-sul', preco: 9490 }] },
      { nome: 'Carne de sol', descricao: 'Com manteiga de garrafa e macaxeira', precoCentavos: 7490, tags: [], outrosNomes: ['carne do sol'], excecoes: [{ unidade: 'lago-sul', disponivel: false }] },
      { nome: 'Costela no bafo', descricao: null, precoCentavos: null, tags: [], outrosNomes: [], excecoes: [] },
    ],
  },
  {
    categoria: 'Saladas', ordem: 2,
    itens: [
      { nome: 'Salada tropical', descricao: 'Folhas, manga e castanha de caju', precoCentavos: 3990, tags: ['vegano', 'sem_gluten'], outrosNomes: [], excecoes: [] },
    ],
  },
  {
    categoria: 'Bebidas', ordem: 3,
    itens: [
      { nome: 'Suco de laranja', descricao: 'Natural, 500 ml', precoCentavos: 1290, tags: ['bebida', 'vegano'], outrosNomes: ['suco'], excecoes: [] },
      { nome: 'Água com gás', descricao: null, precoCentavos: 650, tags: ['bebida'], outrosNomes: [], excecoes: [] },
    ],
  },
  {
    categoria: 'Sobremesas', ordem: 4,
    itens: [
      { nome: 'Pudim de leite', descricao: null, precoCentavos: 1690, tags: ['sobremesa', 'vegetariano'], outrosNomes: ['pudim'], excecoes: [] },
    ],
  },
]

const { db, sql } = createDb(url)
try {
  const restaurantId = await getSingleRestaurantId(db)
  await db.transaction(async (tx) => {
    const ids: Record<string, string> = {}
    for (const { semanal, excecoes, ...dados } of UNIDADES) {
      const [u] = await tx
        .insert(schema.units)
        .values({ restaurantId, ...dados })
        .onConflictDoUpdate({ target: [schema.units.restaurantId, schema.units.slug], set: { ...dados, ativo: true } })
        .returning({ id: schema.units.id })
      const unitId = u!.id
      ids[dados.slug] = unitId
      await tx.delete(schema.unitHours).where(eq(schema.unitHours.unitId, unitId))
      await tx.delete(schema.unitHourExceptions).where(eq(schema.unitHourExceptions.unitId, unitId))
      const turnos = semanal.flatMap((dia, weekday) => dia.map((t, i) => ({ restaurantId, unitId, weekday, turno: i + 1, ...t })))
      if (turnos.length) await tx.insert(schema.unitHours).values(turnos)
      if (excecoes.length) await tx.insert(schema.unitHourExceptions).values(excecoes.map((e) => ({ restaurantId, unitId, ...e })))
    }
    await tx.delete(schema.knowledgeFacts).where(and(
      eq(schema.knowledgeFacts.restaurantId, restaurantId),
      inArray(schema.knowledgeFacts.tema, FATOS.map((f) => f.tema)),
    ))
    await tx.insert(schema.knowledgeFacts).values(FATOS.map(({ unidade, ...f }) => ({ restaurantId, ...f, unitId: unidade ? ids[unidade]! : null })))

    // cardápio: atualiza pelo nome (o índice único é do nome normalizado, sem alvo simples para upsert)
    const { menuCategories, menuItems, menuItemUnits } = schema
    for (const { categoria, ordem, itens } of CARDAPIO) {
      const [existente] = await tx.select({ id: menuCategories.id }).from(menuCategories)
        .where(and(eq(menuCategories.restaurantId, restaurantId), eq(menuCategories.nome, categoria)))
      const categoryId = existente
        ? (await tx.update(menuCategories).set({ ordem, ativo: true }).where(eq(menuCategories.id, existente.id)).returning({ id: menuCategories.id }))[0]!.id
        : (await tx.insert(menuCategories).values({ restaurantId, nome: categoria, ordem }).returning({ id: menuCategories.id }))[0]!.id
      for (const [i, { excecoes, ...item }] of itens.entries()) {
        const dados = { ...item, disponivel: true, ordem: i + 1 }
        const [atual] = await tx.select({ id: menuItems.id }).from(menuItems)
          .where(and(eq(menuItems.categoryId, categoryId), eq(menuItems.nome, item.nome)))
        const itemId = atual
          ? (await tx.update(menuItems).set(dados).where(eq(menuItems.id, atual.id)).returning({ id: menuItems.id }))[0]!.id
          : (await tx.insert(menuItems).values({ restaurantId, categoryId, ...dados }).returning({ id: menuItems.id }))[0]!.id
        for (const e of excecoes) {
          const excecao = { disponivel: 'disponivel' in e ? e.disponivel : null, precoOverrideCentavos: 'preco' in e ? e.preco : null }
          await tx.insert(menuItemUnits).values({ itemId, unitId: ids[e.unidade]!, restaurantId, ...excecao })
            .onConflictDoUpdate({ target: [menuItemUnits.itemId, menuItemUnits.unitId], set: excecao })
        }
      }
    }
  })
  const itens = CARDAPIO.reduce((n, c) => n + c.itens.length, 0)
  process.stdout.write(`Demonstração de S1 pronta: ${UNIDADES.length} unidades, ${FATOS.length} informações e cardápio com ${itens} itens.\n`)
} finally {
  await sql.end()
}
