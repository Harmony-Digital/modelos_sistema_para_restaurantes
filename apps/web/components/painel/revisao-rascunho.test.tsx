import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acoes = {
  importarCsvAction: vi.fn(),
  estadoImportacaoAction: vi.fn(),
  aplicarRascunhoAction: vi.fn(),
  descartarImportacaoAction: vi.fn(),
}
const push = vi.fn()
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
const acoesAlvo = { aplicarImportacaoAction: vi.fn() }
vi.mock('@/app/(painel)/conteudo/importar-actions', () => acoes)
vi.mock('@/app/(painel)/conteudo/importar-alvo-actions', () => acoesAlvo)
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast }))
const { RevisaoRascunho } = await import('./revisao-rascunho')

const ID = '00000000-0000-4000-8000-000000000011'
const U1 = '00000000-0000-4000-8000-0000000000a1'
const item = (o: Record<string, unknown> = {}) => ({
  nome: 'Picanha', descricao: null, precoCentavos: 8990, tags: ['sem_gluten'], outrosNomes: [], unidade: null, incluir: true, ...o,
})
const rascunho = {
  categorias: [
    { nome: 'CARNES', itens: [item(), item({ nome: 'Costela', precoCentavos: 4590, tags: [] })] },
    { nome: 'Bebidas', itens: [item({ nome: 'Suco', precoCentavos: 900, tags: ['bebida'] })] },
  ],
}
const base = {
  id: ID,
  origem: 'csv' as const,
  rascunho,
  categoriasExistentes: [{ nome: 'Carnes', ativo: true }, { nome: 'Bebidas', ativo: false }],
  itensExistentes: [{ categoria: 'Carnes', nome: 'picanha', precoCentavos: 5990, descricao: 'Antiga', tags: ['sem_gluten'], outrosNomes: ['pica'] }],
  unidades: [{ id: U1, nome: 'Asa Sul' }],
  podeAplicar: true,
}
const grupo = (nome: string) => screen.getByRole('group', { name: nome })

beforeEach(() => vi.clearAllMocks())

describe('RevisaoRascunho', () => {
  it('marca Novo / Atualiza pelo nome normalizado e avisa da categoria desativada', async () => {
    const user = userEvent.setup()
    render(<RevisaoRascunho {...base} />)
    expect(within(grupo('Picanha')).getByText('Atualiza')).toBeInTheDocument()
    expect(within(grupo('Costela')).getByText('Novo')).toBeInTheDocument()
    expect(within(grupo('Picanha')).getByLabelText(/^Preço/)).toHaveValue('R$ 89,90')
    expect(screen.getByText('A categoria Bebidas está desativada: os itens não aparecerão para os clientes até reativá-la.')).toBeInTheDocument()
    // renomear para um nome existente vira "Atualiza"
    const nome = within(grupo('Costela')).getByLabelText(/^Nome/)
    await user.clear(nome)
    await user.type(nome, 'PICANHA')
    expect(within(grupo('PICANHA')).getByText('Atualiza')).toBeInTheDocument()
  })

  it('item que atualiza mostra o que muda; em branco mantém o valor atual (I2)', async () => {
    const user = userEvent.setup()
    render(<RevisaoRascunho {...base} />)
    const g = within(grupo('Picanha'))
    expect(g.getByText('Muda: preço R$ 59,90 → R$ 89,90')).toBeInTheDocument()
    expect(g.getByText('Em branco mantém o preço atual.')).toBeInTheDocument()
    await user.clear(g.getByLabelText(/^Preço/))
    expect(g.getByText('Nada muda: campos em branco mantêm o valor atual.')).toBeInTheDocument()
    await user.type(g.getByLabelText(/^Descrição/), 'Nova')
    expect(g.getByText('Muda: descrição')).toBeInTheDocument()
    expect(within(grupo('Costela')).getByText('Em branco = preço sob consulta.')).toBeInTheDocument()
  })

  it('nome da categoria editável: juntar com a existente recalcula Novo/Atualiza e vai no rascunho (M1)', async () => {
    const user = userEvent.setup()
    acoes.aplicarRascunhoAction.mockResolvedValue({ ok: true, data: { criados: 0, atualizados: 1, ignorados: [] } })
    const r = { categorias: [{ nome: 'Carnes na brasa', itens: [item()] }] }
    render(<RevisaoRascunho {...base} rascunho={r} />)
    expect(within(grupo('Picanha')).getByText('Novo')).toBeInTheDocument()
    expect(screen.getByText('Categoria nova')).toBeInTheDocument()
    const cat = screen.getByRole('combobox', { name: /^Categoria/ })
    await user.clear(cat)
    await user.type(cat, 'carnes')
    expect(within(grupo('Picanha')).getByText('Atualiza')).toBeInTheDocument()
    expect(screen.getByText('Categoria existente')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoes.aplicarRascunhoAction).toHaveBeenCalledTimes(1))
    expect(acoes.aplicarRascunhoAction.mock.calls[0]![1].categorias[0].nome).toBe('carnes')
  })

  it('categoria sem nome não é enviada', async () => {
    const user = userEvent.setup()
    render(<RevisaoRascunho {...base} />)
    await user.clear(screen.getAllByRole('combobox', { name: /^Categoria/ })[0]!)
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('Informe a categoria')).toBeInTheDocument()
    expect(acoes.aplicarRascunhoAction).not.toHaveBeenCalled()
  })

  it('confirmar uma vez com duplo clique, enviando as edições; mostra contagens e ignorados', async () => {
    const user = userEvent.setup()
    let resolver!: (v: unknown) => void
    acoes.aplicarRascunhoAction.mockImplementation(() => new Promise((r) => { resolver = r }))
    render(<RevisaoRascunho {...base} />)
    const preco = within(grupo('Costela')).getByLabelText(/^Preço/)
    await user.clear(preco)
    await user.type(preco, '5000')
    await user.click(within(grupo('Suco')).getByRole('checkbox', { name: 'Incluir' }))
    await user.click(within(grupo('Picanha')).getByRole('button', { name: 'Vegano' }))
    const confirmar = screen.getByRole('button', { name: 'Confirmar importação' })
    await user.dblClick(confirmar)
    expect(acoes.aplicarRascunhoAction).toHaveBeenCalledTimes(1)
    const [id, enviado, opcoes] = acoes.aplicarRascunhoAction.mock.calls[0]!
    expect(id).toBe(ID)
    expect(opcoes).toEqual({ usarComoArquivoDeEnvio: false, unitIdArquivo: null })
    expect(enviado.categorias[0].itens[0]).toEqual(item({ tags: ['sem_gluten', 'vegano'] }))
    expect(enviado.categorias[0].itens[1]).toMatchObject({ nome: 'Costela', precoCentavos: 5000 })
    expect(enviado.categorias[1].itens[0]).toMatchObject({ nome: 'Suco', incluir: false })
    resolver({ ok: true, data: { criados: 1, atualizados: 1, ignorados: [{ categoria: 'Carnes', nome: 'Cupim', motivo: 'unidade_desconhecida' }, { categoria: 'Carnes', nome: 'Fraldinha', motivo: 'unidade_desconhecida' }] } })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Cardápio atualizado: 1 novos, 1 atualizados'))
    expect(await screen.findByText('2 itens ignorados: unidade não encontrada')).toBeInTheDocument()
    expect(screen.getByText('Carnes · Cupim')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument()
  })

  it('ja_aplicado ⇒ "Essa importação já foi aplicada."', async () => {
    const user = userEvent.setup()
    acoes.aplicarRascunhoAction.mockResolvedValue({ ok: false, formError: 'Essa importação já foi aplicada.' })
    render(<RevisaoRascunho {...base} />)
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Essa importação já foi aplicada.')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('nome vazio não é enviado', async () => {
    const user = userEvent.setup()
    render(<RevisaoRascunho {...base} />)
    await user.clear(within(grupo('Costela')).getByLabelText(/^Nome/))
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    expect(await screen.findByText('Informe o nome')).toBeInTheDocument()
    expect(acoes.aplicarRascunhoAction).not.toHaveBeenCalled()
  })

  it('PDF/foto: opção de usar o arquivo como cardápio de envio, com unidade', async () => {
    const user = userEvent.setup()
    acoes.aplicarRascunhoAction.mockResolvedValue({ ok: true, data: { criados: 0, atualizados: 3, ignorados: [] } })
    const { unmount } = render(<RevisaoRascunho {...base} />)
    expect(screen.queryByLabelText('Usar este arquivo como cardápio para enviar aos clientes')).not.toBeInTheDocument()
    unmount()
    render(<RevisaoRascunho {...base} origem="arquivo" />)
    await user.click(screen.getByLabelText('Usar este arquivo como cardápio para enviar aos clientes'))
    await user.selectOptions(screen.getByLabelText('Vale para'), U1)
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoes.aplicarRascunhoAction).toHaveBeenCalledTimes(1))
    expect(acoes.aplicarRascunhoAction.mock.calls[0]![2]).toEqual({ usarComoArquivoDeEnvio: true, unitIdArquivo: U1 })
    expect(screen.queryByText(/ignorad/)).not.toBeInTheDocument()
  })

  it('descartar pede confirmação e volta à lista', async () => {
    const user = userEvent.setup()
    acoes.descartarImportacaoAction.mockResolvedValue({ ok: true, data: null })
    render(<RevisaoRascunho {...base} />)
    await user.click(screen.getByRole('button', { name: 'Descartar' }))
    const dialogo = await screen.findByRole('dialog')
    expect(acoes.descartarImportacaoAction).not.toHaveBeenCalled()
    await user.click(within(dialogo).getByRole('button', { name: 'Descartar importação' }))
    await waitFor(() => expect(acoes.descartarImportacaoAction).toHaveBeenCalledWith(ID))
    expect(toast.success).toHaveBeenCalledWith('Importação descartada')
    expect(push).toHaveBeenCalledWith('/conteudo?aba=importar')
  })

  it('gerente sem acesso a todas as unidades não confirma', () => {
    render(<RevisaoRascunho {...base} podeAplicar={false} />)
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument()
    expect(screen.getByText(/Só o dono, ou gerente com acesso a todas as unidades, confirma a importação/)).toBeInTheDocument()
  })

  it('preços diferentes lidos para o mesmo item: destaca o conflito para conferir', () => {
    const r = { categorias: [{ nome: 'Carnes', itens: [item({ precoConflito: [8990, 9490] }), item({ nome: 'Costela', precoConflito: [4590] })] }] }
    render(<RevisaoRascunho {...base} rascunho={r} />)
    expect(within(grupo('Picanha')).getByText('Preços diferentes nos arquivos: R$ 89,90 e R$ 94,90. Confira o preço.')).toBeInTheDocument()
    expect(within(grupo('Costela')).queryByText(/Preços diferentes/)).not.toBeInTheDocument()
  })

  it('vários arquivos (por alvo): confirma pela importação por alvo; sem marcar, nenhum arquivo de envio', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue({ ok: true, data: { criados: 2, atualizados: 1, ignorados: 1 } })
    render(<RevisaoRascunho {...base} origem="arquivo" porAlvo arquivosDeEnvio={[{ ordem: 1, mime: 'application/pdf' }]} />)
    expect(screen.getByLabelText('Usar este arquivo como cardápio para enviar aos clientes')).not.toBeChecked()
    await user.dblClick(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(acoes.aplicarRascunhoAction).not.toHaveBeenCalled()
    const [id, entrada] = acoesAlvo.aplicarImportacaoAction.mock.calls[0]!
    expect(id).toBe(ID)
    expect(entrada).toMatchObject({ alvo: 'cardapio', modo: 'completo', arquivoDeEnvio: null })
    expect(entrada.rascunho.categorias[0].itens[0]).toEqual(item())
    expect(await screen.findByRole('status')).toHaveTextContent('Cardápio atualizado: 2 novos, 1 atualizados, 1 ignorado')
  })

  it('I3: vários arquivos: escolhe um deles como cardápio de envio, com unidade (igual à Etapa 05)', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue({ ok: true, data: { criados: 2, atualizados: 1, ignorados: 0 } })
    render(
      <RevisaoRascunho {...base} origem="arquivo" porAlvo arquivosDeEnvio={[{ ordem: 1, mime: 'image/jpeg' }, { ordem: 2, mime: 'application/pdf' }]} />,
    )
    await user.click(screen.getByLabelText('Usar um dos arquivos como cardápio para enviar aos clientes'))
    // o PDF vem escolhido; dá para trocar
    expect(screen.getByLabelText('Arquivo')).toHaveValue('2')
    await user.selectOptions(screen.getByLabelText('Arquivo'), 'Arquivo 1 (Foto)')
    await user.selectOptions(screen.getByLabelText('Vale para'), U1)
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    expect(acoesAlvo.aplicarImportacaoAction.mock.calls[0]![1]).toMatchObject({ arquivoDeEnvio: { ordem: 1, unitId: U1 } })
  })

  it('quem não confirma (gerente restrito) não vê a opção de arquivo de envio', () => {
    render(<RevisaoRascunho {...base} origem="arquivo" porAlvo podeAplicar={false} arquivosDeEnvio={[{ ordem: 1, mime: 'application/pdf' }]} />)
    expect(screen.queryByLabelText(/como cardápio para enviar aos clientes/)).not.toBeInTheDocument()
  })

  it('mesmo item em duas categorias (fotos diferentes): avisa e deixa desmarcar um deles', async () => {
    const user = userEvent.setup()
    acoesAlvo.aplicarImportacaoAction.mockResolvedValue({ ok: true, data: { criados: 1, atualizados: 0, ignorados: 1 } })
    const r = { categorias: [{ nome: 'Carnes', itens: [item()] }, { nome: 'Promoções', itens: [item({ nome: 'picanha ', precoCentavos: 7990 }), item({ nome: 'Pudim' })] }] }
    render(<RevisaoRascunho {...base} origem="arquivo" porAlvo rascunho={r} />)
    const carnes = within(screen.getByRole('region', { name: 'Categoria Carnes' }))
    const promo = within(screen.getByRole('region', { name: 'Categoria Promoções' }))
    expect(carnes.getByText('Também aparece em Promoções. Se for o mesmo item, desmarque “Incluir” em um deles.')).toBeInTheDocument()
    expect(promo.getByText('Também aparece em Carnes. Se for o mesmo item, desmarque “Incluir” em um deles.')).toBeInTheDocument()
    expect(within(promo.getByRole('group', { name: 'Pudim' })).queryByText(/Também aparece/)).not.toBeInTheDocument()
    await user.click(within(promo.getByRole('group', { name: 'picanha' })).getByRole('checkbox', { name: 'Incluir' }))
    expect(screen.queryByText(/Também aparece/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(acoesAlvo.aplicarImportacaoAction).toHaveBeenCalledTimes(1))
    const entrada = acoesAlvo.aplicarImportacaoAction.mock.calls[0]![1]
    expect(entrada.rascunho.categorias[1].itens[0]).toMatchObject({ nome: 'picanha', incluir: false })
    expect(entrada.rascunho.categorias[0].itens[0]).toMatchObject({ nome: 'Picanha', incluir: true })
  })
})
