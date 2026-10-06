import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarUnidade = vi.fn()
const carregarUnidadesPainel = vi.fn()
const salvarEspaco = vi.fn()
const coordenadasDoLink = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/maps-link', () => ({ coordenadasDoLink }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarUnidade, carregarUnidadesPainel, salvarHorarios: vi.fn(), salvarExcecao: vi.fn(), removerExcecao: vi.fn(), salvarEspaco }))

const { salvarDadosUnidadeAction, salvarEspacoAction } = await import('./actions')
const ID = '00000000-0000-4000-8000-000000000001'
const form = { nome: 'Asa Sul', endereco: 'SCLS 404', bairro: '', cidade: '', uf: 'df', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true }

describe('salvarDadosUnidadeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('exige dono ou gerente', async () => {
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    await salvarDadosUnidadeAction(null, form)
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('entrada inválida não chega ao banco', async () => {
    expect(await salvarDadosUnidadeAction(null, { ...form, nome: '' })).toEqual({
      ok: false, fieldErrors: { nome: 'Informe o nome da unidade, como "Asa Sul"' },
    })
    expect(await salvarDadosUnidadeAction('não-é-uuid', form)).toEqual({ ok: false, formError: 'Não encontramos essa unidade.' })
    expect(salvarUnidade).not.toHaveBeenCalled()
  })
  it('link do Maps sem coordenadas salva com lat/lng nulos e devolve aviso', async () => {
    coordenadasDoLink.mockResolvedValue(null)
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    const r = await salvarDadosUnidadeAction(null, { ...form, mapsUrl: 'https://maps.app.goo.gl/x' })
    expect(r).toEqual({
      ok: true,
      data: { id: ID, aviso: 'Link salvo, mas não consegui ler a localização exata; o cartão de localização não será enviado.' },
    })
    expect(salvarUnidade).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', null, expect.objectContaining({
      mapsUrl: 'https://maps.app.goo.gl/x', lat: null, lng: null,
    }))
  })
  it('link do Maps igual ao gravado preserva as coordenadas sem ir à rede', async () => {
    const link = 'https://www.google.com/maps/@-15.8,-47.9,17z'
    carregarUnidadesPainel.mockResolvedValue({ restaurante: {}, unidades: [{ id: ID, mapsUrl: link, lat: -15.81, lng: -47.91 }] })
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    expect(await salvarDadosUnidadeAction(ID, { ...form, mapsUrl: link })).toEqual({ ok: true, data: { id: ID } })
    expect(coordenadasDoLink).not.toHaveBeenCalled()
    expect(salvarUnidade).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', ID, expect.objectContaining({ mapsUrl: link, lat: -15.81, lng: -47.91 }))
  })
  it('link do Maps alterado é resolvido de novo', async () => {
    carregarUnidadesPainel.mockResolvedValue({ restaurante: {}, unidades: [{ id: ID, mapsUrl: 'https://www.google.com/maps/@-1,-2,17z', lat: -1, lng: -2 }] })
    coordenadasDoLink.mockResolvedValue({ lat: -15.8, lng: -47.9 })
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    await salvarDadosUnidadeAction(ID, { ...form, mapsUrl: 'https://www.google.com/maps/@-15.8,-47.9,17z' })
    expect(coordenadasDoLink).toHaveBeenCalledWith('https://www.google.com/maps/@-15.8,-47.9,17z')
    expect(salvarUnidade).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', ID, expect.objectContaining({ lat: -15.8, lng: -47.9 }))
  })
  it('salva com vazios como nulo e coordenadas do link; nome repetido vai para o campo', async () => {
    coordenadasDoLink.mockResolvedValue({ lat: -15.8, lng: -47.9 })
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    expect(await salvarDadosUnidadeAction(null, { ...form, mapsUrl: 'https://www.google.com/maps/@-15.8,-47.9,17z' })).toEqual({ ok: true, data: { id: ID } })
    expect(salvarUnidade).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', null, expect.objectContaining({
      endereco: 'SCLS 404', bairro: null, uf: 'DF', cep: null, telefone: null, lat: -15.8, lng: -47.9,
    }))
    expect(revalidatePath).toHaveBeenCalledWith('/unidades')
    salvarUnidade.mockResolvedValue({ ok: false, erro: 'nome_duplicado' })
    expect(await salvarDadosUnidadeAction(null, form)).toEqual({ ok: false, fieldErrors: { nome: 'Já existe uma unidade com esse nome.' } })
  })
})

describe('salvarEspacoAction', () => {
  const espaco = { nome: 'Salão', capacidadeMin: '20', capacidadeMax: '80', descricao: '', condicoes: ' sinal de 30% ', ativo: true }
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('exige dono ou gerente e grava com números e textos vazios como nulo', async () => {
    salvarEspaco.mockResolvedValue({ ok: true, valor: { id: ID } })
    expect(await salvarEspacoAction(ID, null, espaco)).toEqual({ ok: true, data: { id: ID } })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(salvarEspaco).toHaveBeenCalledWith('db', { sub: 'u' }, null, {
      unitId: ID, nome: 'Salão', capacidadeMin: 20, capacidadeMax: 80, descricao: null, condicoes: 'sinal de 30%', ativo: true,
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/unidades/${ID}`)
  })
  it('entrada inválida e ids ruins não chegam ao banco', async () => {
    expect(await salvarEspacoAction(ID, null, { ...espaco, capacidadeMin: '90' })).toMatchObject({ ok: false })
    expect(await salvarEspacoAction('x', null, espaco)).toEqual({ ok: false, formError: 'Não encontramos essa unidade.' })
    expect(await salvarEspacoAction(ID, 'x', espaco)).toMatchObject({ ok: false })
    expect(salvarEspaco).not.toHaveBeenCalled()
  })
  it('nome repetido vai para o campo; sem permissão e capacidade viram erro geral', async () => {
    salvarEspaco.mockResolvedValueOnce({ ok: false, erro: 'nome_duplicado' })
    expect(await salvarEspacoAction(ID, null, espaco)).toEqual({ ok: false, fieldErrors: { nome: 'Já existe um espaço com esse nome nesta unidade.' } })
    salvarEspaco.mockResolvedValueOnce({ ok: false, erro: 'sem_permissao' })
    expect(await salvarEspacoAction(ID, ID, espaco)).toMatchObject({ ok: false, formError: expect.stringContaining('permissão') })
    salvarEspaco.mockResolvedValueOnce({ ok: false, erro: 'capacidade_invalida' })
    expect(await salvarEspacoAction(ID, null, espaco)).toMatchObject({ ok: false, formError: expect.any(String) })
  })
})
