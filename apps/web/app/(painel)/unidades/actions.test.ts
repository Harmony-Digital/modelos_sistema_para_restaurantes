import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarUnidade = vi.fn()
const coordenadasDoLink = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/maps-link', () => ({ coordenadasDoLink }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarUnidade, salvarHorarios: vi.fn(), salvarExcecao: vi.fn(), removerExcecao: vi.fn() }))

const { salvarDadosUnidadeAction } = await import('./actions')
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
  it('link do Maps ilegível vira erro no campo', async () => {
    coordenadasDoLink.mockResolvedValue(null)
    const r = await salvarDadosUnidadeAction(null, { ...form, mapsUrl: 'https://maps.app.goo.gl/x' })
    expect(r).toMatchObject({ ok: false, fieldErrors: { mapsUrl: expect.stringContaining('Compartilhar → Copiar link') } })
    expect(salvarUnidade).not.toHaveBeenCalled()
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
