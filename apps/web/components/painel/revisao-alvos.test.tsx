import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acoesAlvo = { aplicarImportacaoAction: vi.fn() }
const acoes = { descartarImportacaoAction: vi.fn() }
const push = vi.fn()
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
vi.mock('@/app/(painel)/conteudo/importar-alvo-actions', () => acoesAlvo)
vi.mock('@/app/(painel)/conteudo/importar-actions', () => acoes)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))
const { RevisaoSoPrecos, RevisaoInformacoes, RevisaoHorarios, RevisaoEspacos } = await import('./revisao-alvos')

const ID = '00000000-0000-4000-8000-000000000011'
const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const unidades = [{ id: U1, nome: 'Asa Sul' }, { id: U2, nome: 'Lago Norte' }]
const grupo = (nome: string | RegExp) => screen.getByRole('group', { name: nome })
const enviado = () => acoesAlvo.aplicarImportacaoAction.mock.calls[0]![1]
const ok = { ok: true, data: { criados: 1, atualizados: 1, ignorados: 0 } }

beforeEach(() => vi.clearAllMocks())

describe('RevisaoSoPrecos', () => {
  const rascunho = {
    itens: [
      { nome: 'Picanha', categoria: 'Carnes', precoCentavos: 9990, precoConflito: [9990, 10490], incluir: true },
      { nome: 'Lagosta', categoria: null, precoCentavos: 25000, incluir: true },
      { nome: 'Costela', categoria: null, precoCentavos: null, incluir: true },
    ],
  }
  const props = {
    id: ID,
    rascunho,
    mudancas: [{ indice: 0, itemId: 'i1', nome: 'Picanha', categoria: 'Carnes', antes: 8990, depois: 9990 }],
    ignorados: [{ indice: 1, nome: 'Lagosta', motivo: 'nao_encontrado' as const }, { indice: 2, nome: 'Costela', motivo: 'sem_preco' as const }],
    podeAplicar: true,
  }

  it('antes → depois editável; não encontrados e sem preço à parte; confirma o rascunho editado', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue({ ok: true, data: { criados: 0, atualizados: 1, ignorados: 2 } })
    render(<RevisaoSoPrecos {...props} />)
    const g = within(grupo('Picanha'))
    expect(g.getByText('R$ 89,90 → R$ 99,90')).toBeInTheDocument()
    expect(g.getByText('Preços diferentes nos arquivos: R$ 99,90 e R$ 104,90. Confira o preço.')).toBeInTheDocument()
    const fora = screen.getByRole('region', { name: 'Ficam de fora' })
    expect(within(fora).getByText('Lagosta')).toBeInTheDocument()
    expect(within(fora).getByText('não está no cardápio (itens novos não entram em “só preços”)')).toBeInTheDocument()
    expect(within(fora).getByText('preço não lido (o atual fica)')).toBeInTheDocument()
    const preco = g.getByLabelText(/^Novo preço/)
    await user.clear(preco)
    await user.type(preco, '10490')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(acoesAlvo.aplicarImportacaoAction.mock.calls[0]![0]).toBe(ID)
    expect(enviado()).toMatchObject({ alvo: 'cardapio', modo: 'so_precos' })
    expect(enviado().rascunho.itens[0]).toMatchObject({ nome: 'Picanha', precoCentavos: 10490, incluir: true })
    // os de fora seguem no rascunho como vieram (o banco decide de novo)
    expect(enviado().rascunho.itens[2]).toMatchObject({ nome: 'Costela', precoCentavos: null })
    expect(await screen.findByRole('status')).toHaveTextContent('Preços atualizados: 1 item, 2 ignorados')
  })

  it('nenhuma mudança marcada: não confirma; nada para mudar ensina', async () => {
    const user = userEvent.setup()
    render(<RevisaoSoPrecos {...props} />)
    await user.click(within(grupo('Picanha')).getByRole('checkbox', { name: 'Incluir' }))
    expect(screen.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled()
  })

  it('sem nenhuma mudança: estado vazio que explica', () => {
    render(<RevisaoSoPrecos {...props} mudancas={[]} />)
    expect(screen.getByText(/Nenhum preço muda/)).toBeInTheDocument()
  })
})

describe('RevisaoInformacoes', () => {
  const rascunho = {
    fatos: [
      { tema: 'Estacionamento', texto: 'Temos estacionamento.', exemplos: ['tem estacionamento?'], unidade: null, incluir: true },
      { tema: 'Pets', texto: 'Aceitamos pets.', exemplos: [], unidade: 'asa sul', incluir: true },
      { tema: 'Wi-Fi', texto: 'Senha no balcão.', exemplos: [], unidade: 'Filial X', incluir: true },
    ],
  }
  const props = {
    id: ID,
    rascunho,
    rotulos: [
      { acao: 'atualizar' as const, factId: 'f1', unitId: null },
      { acao: 'novo' as const, factId: null, unitId: U1 },
      { acao: 'unidade_desconhecida' as const, factId: null, unitId: null },
    ],
    unidades,
    fatosExistentes: [{ tema: 'Estacionamento', unitId: null }, { tema: 'Pets', unitId: U2 }],
    podeAplicar: true,
  }

  it('lista editável com Novo/Atualiza, unidade ou "todas" e contagem', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue(ok)
    render(<RevisaoInformacoes {...props} />)
    expect(screen.getByText('1 novo, 1 para atualizar, 1 com unidade não encontrada')).toBeInTheDocument()
    expect(within(grupo('Estacionamento')).getByText('Atualiza')).toBeInTheDocument()
    expect(within(grupo('Pets')).getByText('Novo')).toBeInTheDocument()
    expect(within(grupo('Wi-Fi')).getByText('Unidade “Filial X” não encontrada: escolha uma unidade ou este item fica de fora.')).toBeInTheDocument()
    // trocar a unidade de Pets para Lago Norte, que já tem esse tema: vira Atualiza
    await user.selectOptions(within(grupo('Pets')).getByLabelText('Unidade'), 'Lago Norte')
    expect(within(grupo('Pets')).getByText('Atualiza')).toBeInTheDocument()
    await user.selectOptions(within(grupo('Wi-Fi')).getByLabelText('Unidade'), '')
    expect(within(grupo('Wi-Fi')).getByText('Novo')).toBeInTheDocument()
    const texto = within(grupo('Estacionamento')).getByLabelText(/^Texto/)
    await user.clear(texto)
    await user.type(texto, 'Estacionamento gratuito.')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toMatchObject({ alvo: 'informacoes', modo: 'completo' })
    expect(enviado().rascunho.fatos).toEqual([
      { tema: 'Estacionamento', texto: 'Estacionamento gratuito.', exemplos: ['tem estacionamento?'], unidade: null, incluir: true },
      { tema: 'Pets', texto: 'Aceitamos pets.', exemplos: [], unidade: 'Lago Norte', incluir: true },
      { tema: 'Wi-Fi', texto: 'Senha no balcão.', exemplos: [], unidade: null, incluir: true },
    ])
  })

  it('texto vazio não é enviado', async () => {
    const user = userEvent.setup()
    render(<RevisaoInformacoes {...props} />)
    await user.clear(within(grupo('Pets')).getByLabelText(/^Texto/))
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('Escreva a resposta')).toBeInTheDocument()
    expect(acoesAlvo.aplicarImportacaoAction).not.toHaveBeenCalled()
  })
})

describe('RevisaoHorarios', () => {
  const t = (abre: string, fecha: string) => ({ abre, fecha })
  const rascunho = {
    unidades: [
      {
        unidade: 'asa sul',
        semana: [
          { dia: 1, turnos: [t('11:00', '15:00'), t('18:00', '23:00')], conflito: false },
          { dia: 5, turnos: [t('11:00', '16:00'), t('15:00', '23:00')], conflito: true },
        ],
        excecoes: [{ data: '2026-12-25', fechado: true, turnos: [], motivo: 'Natal', conflito: false }],
        incluir: true,
      },
      { unidade: 'Filial Centro', semana: [], excecoes: [{ data: '2026-12-31', fechado: false, turnos: [t('11:00', '16:00')], motivo: null, conflito: false }], incluir: true },
    ],
  }
  const props = {
    id: ID,
    rascunho,
    rotulos: [
      { unitId: U1, reconhecida: true, acao: 'atualizar' as const },
      { unitId: null, reconhecida: false, acao: 'escolher_unidade' as const },
    ],
    unidades,
    unidadesComHorario: [U1],
    podeAplicar: true,
  }

  it('grade da semana com turnos, conflito e exceções; semana vazia só muda exceções', () => {
    render(<RevisaoHorarios {...props} />)
    const asa = within(screen.getByRole('region', { name: 'Horários de Asa Sul' }))
    expect(asa.getByText('Atualiza')).toBeInTheDocument()
    const segunda = within(asa.getByRole('group', { name: 'Segunda' }))
    expect(segunda.getAllByLabelText(/^Abre/)).toHaveLength(2)
    expect(within(asa.getByRole('group', { name: 'Domingo' })).getByText('Fechado')).toBeInTheDocument()
    const sexta = asa.getByRole('group', { name: 'Sexta' })
    expect(within(sexta).getByText('Leituras diferentes para este dia (fechado num arquivo e aberto em outro, ou turnos sobrepostos): confira.')).toBeInTheDocument()
    expect(sexta).toHaveAttribute('data-conflito', 'true')
    expect(asa.getByRole('group', { name: 'Segunda' })).not.toHaveAttribute('data-conflito')
    expect(screen.getByText(/1 dia para conferir/)).toBeInTheDocument()
    expect(asa.getByText('25/12/2026')).toBeInTheDocument()
    expect(asa.getByText(/Fechado · Natal/)).toBeInTheDocument()
    const outra = within(screen.getByRole('region', { name: 'Horários de Filial Centro' }))
    expect(outra.getByText('A semana não muda, só as exceções.')).toBeInTheDocument()
    expect(outra.getByText(/11:00–16:00/)).toBeInTheDocument()
  })

  it('unidade não reconhecida: confirmar sem escolher é recusado na tela (Review Focus 1)', async () => {
    const user = userEvent.setup()
    render(<RevisaoHorarios {...props} />)
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('Escolha a unidade ou ignore estes horários.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Confira os campos marcados antes de confirmar.')
    expect(acoesAlvo.aplicarImportacaoAction).not.toHaveBeenCalled()
  })

  it('escolher a unidade grava o id dela no rascunho e mostra Novo/Atualiza; editar turno vai junto', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue(ok)
    render(<RevisaoHorarios {...props} />)
    const outra = within(screen.getByRole('region', { name: 'Horários de Filial Centro' }))
    expect(outra.queryByText('Novo')).not.toBeInTheDocument()
    await user.selectOptions(outra.getByLabelText(/^Unidade/), 'Asa Sul')
    expect(outra.getByText('Atualiza')).toBeInTheDocument()
    await user.selectOptions(outra.getByLabelText(/^Unidade/), 'Lago Norte')
    expect(outra.getByText('Novo')).toBeInTheDocument()
    expect(screen.getByText(/1 unidade nova, 1 para atualizar/)).toBeInTheDocument()
    const segunda = within(within(screen.getByRole('region', { name: 'Horários de Asa Sul' })).getByRole('group', { name: 'Segunda' }))
    const fecha = segunda.getAllByLabelText(/^Fecha/)[1]!
    await user.clear(fecha)
    await user.type(fecha, '2330')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    const r = enviado()
    expect(r).toMatchObject({ alvo: 'horarios', modo: 'completo' })
    expect(r.rascunho.unidades[0].unidade).toBe('asa sul')
    expect(r.rascunho.unidades[0].semana[0]).toEqual({ dia: 1, turnos: [t('11:00', '15:00'), t('18:00', '23:30')], conflito: false })
    expect(r.rascunho.unidades[1]).toMatchObject({ unidade: U2, semana: [], incluir: true })
  })

  it('ignorar a unidade não reconhecida: segue sem ela', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue(ok)
    render(<RevisaoHorarios {...props} />)
    await user.selectOptions(screen.getByLabelText(/^Unidade/), 'Ignorar estes horários')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(enviado().rascunho.unidades[1]).toMatchObject({ unidade: 'Filial Centro', incluir: false })
  })

  it('turno inválido (abre = fecha) não é enviado', async () => {
    const user = userEvent.setup()
    render(<RevisaoHorarios {...props} />)
    await user.selectOptions(screen.getByLabelText(/^Unidade/), 'Ignorar estes horários')
    const segunda = within(within(screen.getByRole('region', { name: 'Horários de Asa Sul' })).getByRole('group', { name: 'Segunda' }))
    const fecha = segunda.getAllByLabelText(/^Fecha/)[0]!
    await user.clear(fecha)
    await user.type(fecha, '1100')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText(/Confira os turnos/)).toBeInTheDocument()
    expect(acoesAlvo.aplicarImportacaoAction).not.toHaveBeenCalled()
  })

  it('adicionar e remover turno; dia sem turno vira Fechado', async () => {
    const user = userEvent.setup()
    render(<RevisaoHorarios {...props} />)
    const asa = within(screen.getByRole('region', { name: 'Horários de Asa Sul' }))
    const domingo = within(asa.getByRole('group', { name: 'Domingo' }))
    await user.click(domingo.getByRole('button', { name: 'Adicionar turno no domingo' }))
    expect(domingo.getAllByLabelText(/^Abre/)).toHaveLength(1)
    await user.click(domingo.getByRole('button', { name: 'Remover turno 1 do domingo' }))
    expect(domingo.getByText('Fechado')).toBeInTheDocument()
  })
})

describe('RevisaoEspacos', () => {
  const rascunho = {
    espacos: [
      { nome: 'Salão', unidade: 'Asa Sul', capacidadeMin: 10, capacidadeMax: 40, descricao: null, condicoes: null, incluir: true },
      { nome: 'Varanda', unidade: 'Asa Sul', capacidadeMin: 1, capacidadeMax: 20, descricao: 'Ao ar livre', condicoes: null, incluir: true, capacidadeIncompleta: true },
      { nome: 'Terraço', unidade: null, capacidadeMin: 20, capacidadeMax: 60, descricao: null, condicoes: null, incluir: true },
    ],
  }
  const props = {
    id: ID,
    rascunho,
    rotulos: [
      { acao: 'atualizar' as const, unitId: U1, spaceId: 's1' },
      { acao: 'novo' as const, unitId: U1, spaceId: null },
      { acao: 'escolher_unidade' as const, unitId: null, spaceId: null },
    ],
    unidades,
    espacosExistentes: [{ unitId: U1, nome: 'Salão' }, { unitId: U2, nome: 'Terraço' }],
    podeAplicar: true,
  }

  it('lista por unidade com capacidades; unidade a escolher é obrigatória', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue(ok)
    render(<RevisaoEspacos {...props} />)
    const asa = within(screen.getByRole('region', { name: 'Espaços de Asa Sul' }))
    expect(within(asa.getByRole('group', { name: 'Salão' })).getByText('Atualiza')).toBeInTheDocument()
    expect(within(asa.getByRole('group', { name: 'Varanda' })).getByText('Novo')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Espaços sem unidade reconhecida' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('Escolha a unidade ou deixe este espaço de fora.')).toBeInTheDocument()
    expect(acoesAlvo.aplicarImportacaoAction).not.toHaveBeenCalled()
    await user.selectOptions(within(grupo('Terraço')).getByLabelText(/^Unidade/), 'Lago Norte')
    const max = within(grupo('Salão')).getByLabelText(/^Capacidade máxima/)
    await user.clear(max)
    await user.type(max, '50')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(enviado()).toMatchObject({ alvo: 'espacos', modo: 'completo' })
    expect(enviado().rascunho.espacos[0]).toMatchObject({ nome: 'Salão', capacidadeMax: 50 })
    expect(enviado().rascunho.espacos[2]).toMatchObject({ nome: 'Terraço', unidade: U2, incluir: true })
    // capacidade não conferida segue marcada
    expect(enviado().rascunho.espacos[1]).toMatchObject({ nome: 'Varanda', capacidadeIncompleta: true })
  })

  it('unidade escolhida à mão e nome editado: Novo/Atualiza pelo cadastro', async () => {
    const user = userEvent.setup()
    render(<RevisaoEspacos {...props} />)
    const terraco = within(grupo('Terraço'))
    expect(terraco.queryByText('Novo')).not.toBeInTheDocument()
    await user.selectOptions(terraco.getByLabelText(/^Unidade/), 'Asa Sul')
    expect(terraco.getByText('Novo')).toBeInTheDocument()
    await user.selectOptions(terraco.getByLabelText(/^Unidade/), 'Lago Norte')
    expect(terraco.getByText('Atualiza')).toBeInTheDocument()
    // renomear a Varanda para um espaço que já existe na unidade: passa a atualizar
    const nome = within(grupo('Varanda')).getByLabelText(/^Nome/)
    await user.clear(nome)
    await user.type(nome, 'salao')
    expect(within(grupo('salao')).getByText('Atualiza')).toBeInTheDocument()
  })

  it('capacidade incompleta: aviso para conferir; corrigir tira a marca', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue(ok)
    render(<RevisaoEspacos {...props} />)
    const varanda = within(grupo('Varanda'))
    expect(varanda.getByText('Só uma capacidade foi lida: confira a capacidade mínima e a máxima.')).toBeInTheDocument()
    expect(within(grupo('Salão')).queryByText(/Só uma capacidade/)).not.toBeInTheDocument()
    expect(screen.getByText(/1 com capacidade a conferir/)).toBeInTheDocument()
    const min = varanda.getByLabelText(/^Capacidade mínima/)
    await user.clear(min)
    await user.type(min, '8')
    expect(varanda.queryByText(/Só uma capacidade/)).not.toBeInTheDocument()
    await user.selectOptions(within(grupo('Terraço')).getByLabelText(/^Unidade/), 'Deixar de fora')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(enviado().rascunho.espacos[1]).toMatchObject({ nome: 'Varanda', capacidadeMin: 8, capacidadeMax: 20, capacidadeIncompleta: false })
  })

  it('mínimo maior que o máximo não é enviado', async () => {
    const user = userEvent.setup()
    render(<RevisaoEspacos {...props} />)
    await user.selectOptions(within(grupo('Terraço')).getByLabelText(/^Unidade/), 'Deixar de fora')
    const min = within(grupo('Varanda')).getByLabelText(/^Capacidade mínima/)
    await user.clear(min)
    await user.type(min, '30')
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('O mínimo passa do máximo')).toBeInTheDocument()
    expect(acoesAlvo.aplicarImportacaoAction).not.toHaveBeenCalled()
  })
})
