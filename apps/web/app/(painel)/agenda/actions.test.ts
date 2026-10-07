import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const carregarUnidadesPainel = vi.fn()
const criarAvisoPainel = vi.fn()
const mudarStatusReserva = vi.fn()
const revelarContatoReserva = vi.fn()
const revalidatePath = vi.fn()
const PHONE_KEY = Buffer.alloc(32, 3)
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/server/env', () => ({ env: () => ({ phoneKey: PHONE_KEY }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ carregarUnidadesPainel, criarAvisoPainel, mudarStatusReserva, revelarContatoReserva }))

const { criarReservaAction, mudarStatusReservaAction, revelarContatoReservaAction } = await import('./actions')
const { decryptPhone } = await import('@atd/core')

const U = '00000000-0000-4000-8000-000000000001'
const jantar = { abre: '18:00', fecha: '23:00' }
const unidadePainel = (over = {}) => ({ id: U, nome: 'Asa Sul', ativo: true, semanal: [[], [], [jantar], [jantar], [jantar], [jantar], [jantar]], excecoes: {}, ...over })
// o relógio é fixado: segunda 05/10/2026 12:00 em Brasília
const form = (over = {}) => ({ unitId: U, data: '2026-10-06', pessoas: '4', horario: '20:00', nome: ' Ana ', contato: '', ...over })

describe('reservas: actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T15:00:00Z'))
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [unidadePainel()] })
    criarAvisoPainel.mockResolvedValue({ ok: true, valor: { id: 'a1' } })
    mudarStatusReserva.mockResolvedValue({ ok: true, valor: null })
    revelarContatoReserva.mockResolvedValue({ ok: true, valor: { telefone: '+5561999998888', origem: 'informado' } })
  })

  it('exige dono/gerente antes de tudo', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(criarReservaAction(form())).rejects.toThrow()
    await expect(mudarStatusReservaAction(crypto.randomUUID(), 'cancelada')).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledTimes(2)
    for (const c of requireStaff.mock.calls) expect(c).toEqual([['dono', 'gerente']])
    expect(carregarUnidadesPainel).not.toHaveBeenCalled()
    expect(mudarStatusReserva).not.toHaveBeenCalled()
  })

  it('Zod antes do banco', async () => {
    const r = await criarReservaAction(form({ pessoas: '61', data: '2026-12-01' }))
    expect(r).toEqual({ ok: false, fieldErrors: { pessoas: 'Informe de 1 a 60 pessoas.', data: 'Escolha um dia de hoje até 30 dias à frente.' } })
    expect(carregarUnidadesPainel).not.toHaveBeenCalled()
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('cria a reserva com nome e horário, sem contato (null), e revalida', async () => {
    expect(await criarReservaAction(form())).toEqual({ ok: true, data: { id: 'a1' } })
    expect(criarAvisoPainel).toHaveBeenCalledWith('db', { sub: 'u' }, {
      unitId: U, data: '2026-10-06', pessoas: 4, horarioAprox: null, horario: '20:00', nome: 'Ana', contatoCifrado: null,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('nome e horário obrigatórios: nada vai ao banco', async () => {
    expect(await criarReservaAction(form({ horario: '', nome: '' }))).toEqual({
      ok: false, fieldErrors: { horario: 'Informe o horário, como 20:00.', nome: 'Informe o nome da reserva.' },
    })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('contato informado vai cifrado (E.164), nunca em claro; inválido volta no campo', async () => {
    await criarReservaAction(form({ contato: '(61) 9 9999-8888' }))
    const enviado = criarAvisoPainel.mock.calls[0]![2] as { contatoCifrado: string }
    expect(enviado.contatoCifrado).not.toContain('99999')
    expect(decryptPhone(enviado.contatoCifrado, PHONE_KEY)).toBe('+5561999998888')
    expect(await criarReservaAction(form({ contato: 'não sei' }))).toEqual({
      ok: false, fieldErrors: { contato: 'Informe o telefone com DDD, como (61) 99999-8888.' },
    })
    expect(criarAvisoPainel).toHaveBeenCalledTimes(1)
  })

  it('unidade fora da lista visível ou desativada', async () => {
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [unidadePainel({ ativo: false })] })
    expect(await criarReservaAction(form())).toEqual({ ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } })
    carregarUnidadesPainel.mockResolvedValue({ restaurante: { timezone: 'America/Sao_Paulo', politicaFeriado: 'como_domingo' }, unidades: [] })
    expect(await criarReservaAction(form())).toEqual({ ok: false, fieldErrors: { unitId: 'Escolha uma unidade.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('unidade fechada no dia e horário fora dos turnos', async () => {
    expect(await criarReservaAction(form({ data: '2026-10-05' }))).toEqual({ ok: false, fieldErrors: { data: 'A unidade não abre nesse dia.' } })
    expect(await criarReservaAction(form({ horario: '12:00' }))).toEqual({
      ok: false, fieldErrors: { horario: 'Nesse dia a unidade funciona das 18h às 23h.' },
    })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('hoje num horário que já passou, no fuso do restaurante', async () => {
    vi.setSystemTime(new Date('2026-10-07T00:00:00Z')) // terça 06/10 21:00 em Brasília
    expect(await criarReservaAction(form({ horario: '20:00' }))).toEqual({ ok: false, fieldErrors: { horario: 'Esse horário de hoje já passou.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
    expect(await criarReservaAction(form({ horario: '22:00' }))).toEqual({ ok: true, data: { id: 'a1' } })
  })

  it('painel é estrito: 20:00 às 20h05 de hoje já passou', async () => {
    vi.setSystemTime(new Date('2026-10-06T23:05:00Z')) // terça 06/10 20:05 em Brasília
    expect(await criarReservaAction(form({ horario: '20:00' }))).toEqual({ ok: false, fieldErrors: { horario: 'Esse horário de hoje já passou.' } })
    expect(criarAvisoPainel).not.toHaveBeenCalled()
  })

  it('erro do banco vira mensagem do painel', async () => {
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await criarReservaAction(form())).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
  })

  it('unidade lotada no dia: mensagem com as vagas que restam, sem revalidar', async () => {
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 3 })
    expect(await criarReservaAction(form())).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Restam 3 vagas.' })
    criarAvisoPainel.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 1 })
    expect(await criarReservaAction(form())).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Resta 1 vaga.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('mudar a situação: id ou situação inválidos não vão ao banco; sucesso revalida', async () => {
    expect(await mudarStatusReservaAction('x', 'cancelada')).toEqual({ ok: false, formError: 'Essa reserva não está mais disponível.' })
    const id = crypto.randomUUID()
    expect(await mudarStatusReservaAction(id, 'ativo' as never)).toEqual({ ok: false, formError: 'Escolha confirmada, cancelada ou não veio.' })
    expect(mudarStatusReserva).not.toHaveBeenCalled()
    expect(await mudarStatusReservaAction(id, 'nao_veio')).toEqual({ ok: true, data: null })
    expect(mudarStatusReserva).toHaveBeenCalledWith('db', { sub: 'u' }, id, 'nao_veio')
    expect(revalidatePath).toHaveBeenCalledWith('/agenda')
    expect(revalidatePath).toHaveBeenCalledWith('/')
  })

  it('reconfirmar sem vaga: mensagem com as vagas, sem revalidar; demais recusas com mensagem própria', async () => {
    const id = crypto.randomUUID()
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 2 })
    expect(await mudarStatusReservaAction(id, 'confirmada')).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Restam 2 vagas.' })
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'lotado', vagas: 0 })
    expect(await mudarStatusReservaAction(id, 'confirmada')).toEqual({ ok: false, formError: 'A unidade está lotada nesse dia. Não resta nenhuma vaga.' })
    expect(revalidatePath).not.toHaveBeenCalled()
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'transicao_invalida' })
    expect(await mudarStatusReservaAction(id, 'cancelada')).toEqual({
      ok: false, formError: 'Confirmada e Cancelada valem de hoje em diante; Não veio, só no dia da reserva ou depois.',
    })
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'duplicada' })
    expect(await mudarStatusReservaAction(id, 'confirmada')).toEqual({
      ok: false, formError: 'O cliente já tem outra reserva confirmada nessa unidade e nesse dia.',
    })
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await mudarStatusReservaAction(id, 'cancelada')).toEqual({ ok: false, formError: 'Essa reserva não está mais disponível.' })
    mudarStatusReserva.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await mudarStatusReservaAction(id, 'cancelada')).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
  })

  it('ver contato: qualquer papel da equipe (a RLS limita a unidade); o número só vem na resposta', async () => {
    const id = crypto.randomUUID()
    expect(await revelarContatoReservaAction(id)).toEqual({ ok: true, data: { telefone: '+5561999998888', origem: 'informado' } })
    expect(requireStaff).toHaveBeenCalledWith()
    expect(revelarContatoReserva).toHaveBeenCalledWith('db', { sub: 'u' }, id, PHONE_KEY)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(await revelarContatoReservaAction('x')).toEqual({ ok: false, formError: 'Essa reserva não está mais disponível.' })
    revelarContatoReserva.mockResolvedValue({ ok: false, erro: 'nao_encontrada' })
    expect(await revelarContatoReservaAction(id)).toEqual({ ok: false, formError: 'Essa reserva não está mais disponível.' })
    expect(revelarContatoReserva).toHaveBeenCalledTimes(2)
  })
})
