import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarHorarioHumano = vi.fn()
const salvarRespostaRapida = vi.fn()
const listarRespostasRapidas = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarHorarioHumano, salvarRespostaRapida, listarRespostasRapidas }))

const { salvarHorarioHumanoAction, salvarRespostaRapidaAction } = await import('./actions')

const Q = '00000000-0000-4000-8000-0000000000aa'
const dias = (over: Record<string, { inicio: string; fim: string }[]> = {}) => ({
  dom: [], seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, role: 'dono' })
  salvarHorarioHumano.mockResolvedValue({ ok: true, valor: null })
  salvarRespostaRapida.mockResolvedValue({ ok: true, valor: { id: Q } })
  listarRespostasRapidas.mockResolvedValue([
    { id: Q, titulo: 'a', texto: 'a', ordem: 3, ativo: true },
    { id: '00000000-0000-4000-8000-0000000000bb', titulo: 'b', texto: 'b', ordem: 7, ativo: false },
  ])
})

describe('horário de atendimento humano', () => {
  it('só o dono: pede o papel antes de tudo', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarHorarioHumanoAction({ dias: dias() })).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono'])
    expect(salvarHorarioHumano).not.toHaveBeenCalled()
  })

  it('grava só os dias com turno', async () => {
    const r = await salvarHorarioHumanoAction({ dias: dias({ seg: [{ inicio: '09:00', fim: '18:00' }], sab: [{ inicio: '10:00', fim: '14:00' }] }) })
    expect(r).toEqual({ ok: true, data: null })
    expect(salvarHorarioHumano).toHaveBeenCalledWith('db', { sub: 'u' }, {
      dias: { seg: [{ inicio: '09:00', fim: '18:00' }], sab: [{ inicio: '10:00', fim: '14:00' }] },
    })
    expect(revalidatePath).toHaveBeenCalledWith('/ajustes')
  })

  it('vazio é permitido (sem promessa de horário)', async () => {
    expect(await salvarHorarioHumanoAction({ dias: dias() })).toEqual({ ok: true, data: null })
    expect(salvarHorarioHumano).toHaveBeenCalledWith('db', { sub: 'u' }, { dias: {} })
  })

  it('valida os turnos antes do banco: formato, sobreposição e mais de 4 turnos', async () => {
    expect((await salvarHorarioHumanoAction({ dias: dias({ seg: [{ inicio: '9h', fim: '18:00' }] }) })).ok).toBe(false)
    expect(
      (await salvarHorarioHumanoAction({ dias: dias({ ter: [{ inicio: '09:00', fim: '12:00' }, { inicio: '11:00', fim: '15:00' }] }) })).ok,
    ).toBe(false)
    const cinco = ['06', '08', '10', '12', '14'].map((h) => ({ inicio: `${h}:00`, fim: `${h}:30` }))
    expect((await salvarHorarioHumanoAction({ dias: dias({ qua: cinco }) })).ok).toBe(false)
    expect(salvarHorarioHumano).not.toHaveBeenCalled()
  })

  it('erro do banco vira mensagem do painel', async () => {
    salvarHorarioHumano.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarioHumanoAction({ dias: dias() })).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
  })
})

describe('respostas rápidas', () => {
  const v = (over = {}) => ({ titulo: ' Boas-vindas ', texto: ' Olá! Como posso ajudar? ', ativo: true, ...over })

  it('dono/gerente apenas (atendente consulta)', async () => {
    requireStaff.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(salvarRespostaRapidaAction(null, v())).rejects.toThrow()
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(salvarRespostaRapida).not.toHaveBeenCalled()
  })

  it('nova vai para o fim da lista; editada mantém a ordem', async () => {
    await salvarRespostaRapidaAction(null, v())
    expect(salvarRespostaRapida).toHaveBeenLastCalledWith('db', { sub: 'u' }, null, { titulo: 'Boas-vindas', texto: 'Olá! Como posso ajudar?', ativo: true, ordem: 8 })
    await salvarRespostaRapidaAction(Q, v({ ativo: false }))
    expect(salvarRespostaRapida).toHaveBeenLastCalledWith('db', { sub: 'u' }, Q, { titulo: 'Boas-vindas', texto: 'Olá! Como posso ajudar?', ativo: false, ordem: 3 })
    expect(revalidatePath).toHaveBeenCalledWith('/conteudo')
  })

  it('Zod: título até 40, texto até 1000, ambos obrigatórios', async () => {
    expect(await salvarRespostaRapidaAction(null, v({ titulo: 'x'.repeat(41) }))).toMatchObject({ ok: false, fieldErrors: { titulo: 'Use no máximo 40 caracteres' } })
    expect(await salvarRespostaRapidaAction(null, v({ texto: 'x'.repeat(1001) }))).toMatchObject({ ok: false, fieldErrors: { texto: 'Use no máximo 1000 caracteres' } })
    expect(await salvarRespostaRapidaAction(null, v({ texto: '  ' }))).toMatchObject({ ok: false })
    expect(salvarRespostaRapida).not.toHaveBeenCalled()
  })

  it('id inválido ou de outro restaurante ⇒ não encontrada, sem gravar', async () => {
    expect(await salvarRespostaRapidaAction('x', v())).toEqual({ ok: false, formError: 'Não encontramos essa resposta.' })
    expect(await salvarRespostaRapidaAction('00000000-0000-4000-8000-0000000000ff', v())).toEqual({ ok: false, formError: 'Não encontramos essa resposta.' })
    expect(salvarRespostaRapida).not.toHaveBeenCalled()
  })

  it('limite de 30 ativas ⇒ mensagem amigável, sem revalidar', async () => {
    salvarRespostaRapida.mockResolvedValue({ ok: false, erro: 'limite' })
    expect(await salvarRespostaRapidaAction(null, v())).toEqual({
      ok: false, formError: 'Você já tem 30 respostas rápidas ativas. Desative uma para ativar outra.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
