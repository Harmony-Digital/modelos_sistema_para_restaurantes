import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const carregarUnidadesPainel = vi.fn()
const criarAvisoPainel = vi.fn()
const cancelarAvisoPainel = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ carregarUnidadesPainel, criarAvisoPainel, cancelarAvisoPainel }))

const { criarAvisoAction, cancelarAvisoAction } = await import('./actions')

const U = '00000000-0000-4000-8000-000000000001'
const jantar = { abre: '18:00', fecha: '23:00' }
const unidadePainel = (over = {}) => ({ id: U, nome: 'Asa Sul', ativo: true, semanal: [[], [], [jantar], [jantar], [jantar], [jantar], [jantar]], excecoes: {}, ...over })
// o relógio é fixado: segunda 05/10/2026 12:00 em Brasília
const form = (over = {}) => ({ unitId: U, data: '2026-10-06', pessoas: '4', horario: '20:00', nome: ' Ana ', ...over })

describe('previsão: actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'))
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [unidadePainel()] })
    criarAvisoPainel.mockResolvedValue({ ok: true, valor: { id: 'a1' } })
    cancelarAvisoPainel.mockResolvedValue({ ok: true, valor: null })
  })

  it('exige dono/gerente antes de tudo', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarAvisoAction(form())).rejects.toThrow()
    await expect(cancelarAvisoAction(crypto.randomUUID())).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(carregarUnidadesPainel).not.toHaveBeenCalled()
    expect(cancelarAvisoPainel).not.toHaveBeenCalled()
  })

  it('Zod antes do banco', async () => {
    const r = await criarAvisoAction(form({ pessoas: '61', data: '2026-12-01' }))
    expect(r).toEqual({ ok: false, fieldErrors: { pessoas: 'Informe de 1 a 60 pessoas.', data: 'Escolha um dia de hoje até 30 dias à frente.' } })
    expect(carregarUnidadesPainel).not.toHaveBeenCalled()
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('cria o aviso com valores normalizados e revalida', async () => {
    expect(await criarAvisoAction(form())).toEqual({ ok: true, data: { id: 'a1' } })
    expect(criarAvisoPainel).toHaveBeenCalledWith('db', { sub: 'u' }, { unitId: U, data: '2026-10-06', pessoas: 4, horarioAprox: '20:00', nome: 'Ana' })
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
    expect(revalidatePath).toHaveBeenCalledWith('/')
    await criarAvisoAction(form({ horario: '', nome: '' }))
    expect(criarAvisoPainel).toHaveBeenLastCalledWith('db', { sub: 'u' }, expect.objectContaining({ horarioAprox: null, nome: null }))
  })

  it('unidade fora da lista visível ou desativada', async () => {
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [unidadePainel({ ativo: false })] })
    expect(await criarAvisoAction(form())).toEqual({ ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } })
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [] })
    expect(await criarAvisoAction(form())).toEqual({ ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('unidade fechada no dia e horário fora dos turnos', async () => {
    expect(await criarAvisoAction(form({ data: '2026-10-05' }))).toEqual({ ok: false, fieldErrors: { data: 'A unidade não abre nesse dia.' } })
    expect(await criarAvisoAction(form({ horario: '12:00' }))).toEqual({
      ok: false, fieldErrors: { horario: 'Nesse dia a unidade funciona das 18h às 23h.' },
    })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('hoje num horário que já passou, no fuso do restaurante', async () => {
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z')) // terça 06/10 21:00 em Brasília
    expect(await criarAvisoAction(form({ horario: '20:00' }))).toEqual({ ok: false, fieldErrors: { horario: 'Esse horário de hoje já passou.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
    expect(await criarAvisoAction(form({ horario: '22:00' }))).toEqual({ ok: true, data: { id: 'a1' } })
  })

  it('painel é estrito: 20:00 às 20h05 de hoje já passou', async () => {
    vi.setSystemTime(new Date('2026-10-06T23:05:00Z')) // terça 06/10 20:05 em Brasília
    expect(await criarAvisoAction(form({ horario: '20:00' }))).toEqual({ ok: false, fieldErrors: { horario: 'Esse horário de hoje já passou.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('erro do banco vira mensagem do painel', async () => {
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await criarAvisoAction(form())).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
  })

  it('unidade lotada no dia: mensagem com as vagas que restam, sem revalidar', async () => {
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 3 })
    expect(await criarAvisoAction(form())).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Restam 3 vagas.' })
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 1 })
    expect(await criarAvisoAction(form())).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Resta 1 vaga.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('cancelar: id inválido, sucesso e aviso que sumiu', async () => {
    expect(await cancelarAvisoAction('x')).toEqual({ ok: false, formError: 'Esse aviso não está mais disponível.' })
    expect(cancelarAvisoPainel).not.toHaveBeenCalled()
    const id = crypto.randomUUID()
    expect(await cancelarAvisoAction(id)).toEqual({ ok: true, data: null })
    expect(cancelarAvisoPainel).toHaveBeenCalledWith('db', { sub: 'u' }, id)
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
    cancelarAvisoPainel.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await cancelarAvisoAction(id)).toEqual({ ok: false, formError: 'Esse aviso não está mais disponível.' })
  })
})
