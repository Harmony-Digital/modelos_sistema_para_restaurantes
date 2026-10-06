// Mesma fixture do S1/S3 (unidades, horários, fatos, espaços): o S4 acrescenta o cardápio (preços efetivos por unidade).
import { formatarPreco, type ItemCardapioCore, type ResumoCardapio, type TagCardapio } from '@atd/core'

export * from '../s3/fixture.ts'

const AS = 'u-asa-sul'
const AN = 'u-asa-norte'
const LS = 'u-lago-sul'
const AC = 'u-aguas-claras'
const UNIDADES = [AS, AN, LS, AC]

type Opcoes = { descricao?: string; tags?: TagCardapio[]; precos?: Record<string, number | null>; indisponivel?: string[] }
const item = (id: string, nome: string, categoria: string, base: number | null, o: Opcoes = {}): ItemCardapioCore => ({
  id, nome, categoria, descricao: o.descricao ?? null, tags: o.tags ?? [], precoBaseCentavos: base,
  porUnidade: UNIDADES.map((unitId) => ({
    unitId,
    disponivel: !o.indisponivel?.includes(unitId),
    precoCentavos: o.precos && unitId in o.precos ? o.precos[unitId]! : base,
  })),
})

export const PICANHA = item('i-picanha', 'Picanha na brasa', 'Carnes', 8990, { descricao: 'Acompanha arroz, farofa e vinagrete' })
/** preço diferente na Asa Norte */
export const FRALDINHA = item('i-fraldinha', 'Fraldinha', 'Carnes', 6490, { precos: { [AN]: 6890 } })
export const COSTELA = item('i-costela', 'Costela no bafo', 'Carnes', null, { descricao: 'Serve duas pessoas' })
/** indisponível no Lago Sul */
export const FEIJOADA = item('i-feijoada', 'Feijoada completa', 'Pratos do dia', 5490, { descricao: 'Sábados e quartas', indisponivel: [LS] })
export const DEGUSTACAO = item('i-degustacao', 'Menu degustação', 'Pratos do dia', 123456, { descricao: 'Para a mesa toda' })
export const RISOTO = item('i-risoto', 'Risoto de cogumelos', 'Vegetarianos', 5890, { tags: ['vegetariano', 'sem_gluten'] })
export const BOWL = item('i-bowl', 'Bowl vegano', 'Vegetarianos', 4290, { tags: ['vegano', 'vegetariano', 'sem_lactose'] })
export const SALADA = item('i-salada', 'Salada da casa', 'Vegetarianos', 3290, { tags: ['vegano', 'vegetariano', 'sem_gluten'] })
export const KIDS = item('i-kids', 'Mini filé kids', 'Infantil', 3490, { tags: ['infantil'] })
/** preço diferente no Lago Sul */
export const CHOPP = item('i-chopp', 'Chopp 300 ml', 'Bebidas', 1290, { tags: ['bebida'], precos: { [LS]: 1390 } })
export const SUCO = item('i-suco', 'Suco natural', 'Bebidas', 990, { tags: ['bebida', 'vegano'] })
/** só na Asa Sul */
export const CAIPIRINHA = item('i-caipirinha', 'Caipirinha', 'Bebidas', 2490, { tags: ['bebida'], indisponivel: [AN, LS, AC] })
export const PUDIM = item('i-pudim', 'Pudim de leite', 'Sobremesas', 1490, { tags: ['sobremesa', 'vegetariano'] })
export const PETIT = item('i-petit', 'Petit gâteau', 'Sobremesas', 2290, { tags: ['sobremesa', 'vegetariano'] })

export const CARDAPIO: ItemCardapioCore[] = [PICANHA, FRALDINHA, COSTELA, FEIJOADA, DEGUSTACAO, RISOTO, BOWL, SALADA, KIDS, CHOPP, SUCO, CAIPIRINHA, PUDIM, PETIT]

/** O que a busca do banco devolve para um filtro (itens com a tag). */
export const comTag = (tag: TagCardapio) => CARDAPIO.filter((i) => i.tags.includes(tag))

/**
 * Resumo do banco (mesma regra de `resumoCardapio`): categorias em ordem, até 3 itens disponíveis cada, com o preço
 * efetivo da unidade; `'todas'` (várias unidades, nenhuma citada): disponível em alguma unidade, preço único ou "varia".
 */
export function resumoDe(unidade: string | 'todas'): ResumoCardapio {
  const efetivo = (i: ItemCardapioCore) => {
    const onde = i.porUnidade.filter((p) => p.disponivel && (unidade === 'todas' || p.unitId === unidade))
    if (onde.length === 0) return null
    const precos = new Set(onde.map((p) => p.precoCentavos))
    return precos.size > 1 ? { precoCentavos: null, precoVaria: true } : { precoCentavos: onde[0]!.precoCentavos }
  }
  return [...new Set(CARDAPIO.map((i) => i.categoria))].map((categoria) => ({
    categoria,
    itens: CARDAPIO.filter((i) => i.categoria === categoria).flatMap((i) => {
      const e = efetivo(i)
      return e ? [{ nome: i.nome, ...e }] : []
    }).slice(0, 3),
  }))
}

/** O que o worker manda sem unidade citada (4 unidades ativas). */
export const RESUMO: ResumoCardapio = resumoDe('todas')

/** Todo "R$ x" do texto deve existir no banco: preços dos itens encontrados e do resumo usados no caso. */
export function precosForaDoBanco(texto: string | null, itens: readonly ItemCardapioCore[], resumo: ResumoCardapio): string[] {
  const doBanco = new Set<string>()
  for (const i of itens) {
    if (i.precoBaseCentavos !== null) doBanco.add(formatarPreco(i.precoBaseCentavos))
    for (const p of i.porUnidade) if (p.precoCentavos !== null) doBanco.add(formatarPreco(p.precoCentavos))
  }
  for (const c of resumo) for (const i of c.itens) if (i.precoCentavos !== null) doBanco.add(formatarPreco(i.precoCentavos))
  return [...(texto ?? '').matchAll(/R\$\s?[\d.]+(?:,\d{1,2})?/g)].map((m) => m[0]).filter((p) => !doBanco.has(p))
}
