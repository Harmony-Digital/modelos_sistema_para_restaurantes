import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acoes = {
  salvarCategoriaAction: vi.fn(),
  salvarItemAction: vi.fn(),
  salvarExcecaoAction: vi.fn(),
  enviarArquivoAction: vi.fn(),
  ativarArquivoAction: vi.fn(),
  urlPreviaArquivoAction: vi.fn(),
}
vi.mock('@/app/(painel)/conteudo/cardapio-actions', () => acoes)
const { Cardapio } = await import('./cardapio')
const { ExcecoesItem } = await import('./excecoes-item')
const { ArquivosCardapio } = await import('./arquivos-cardapio')

const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const C1 = '00000000-0000-4000-8000-0000000000c1'
const I1 = '00000000-0000-4000-8000-0000000000d1'
const categorias = [{ id: C1, nome: 'Carnes', ordem: 1, ativo: true }]
const item = (o: Record<string, unknown> = {}) => ({
  id: I1, categoryId: C1, nome: 'Picanha', descricao: 'Na brasa', precoCentavos: 8990, tags: ['sem_gluten'], outrosNomes: ['pica'], disponivel: true, ordem: 1, ...o,
})
const unidades = [{ id: U1, nome: 'Asa Sul' }, { id: U2, nome: 'Lago Norte' }]

beforeEach(() => vi.clearAllMocks())

describe('Cardapio (itens)', () => {
  it('mostra preço formatado, etiqueta e busca por outro nome sem acento', async () => {
    const user = userEvent.setup()
    render(<Cardapio categorias={categorias} itens={[item(), item({ id: 'x2', nome: 'Pão de alho', precoCentavos: null, tags: [], outrosNomes: [] })]} podeEditar />)
    expect(screen.getByText('R$ 89,90')).toBeInTheDocument()
    expect(screen.getByText('Preço sob consulta')).toBeInTheDocument()
    expect(screen.getByText('Sem glúten')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Buscar item' }), 'PÃO')
    expect(screen.queryByText('Picanha')).not.toBeInTheDocument()
    expect(screen.getByText('Pão de alho')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'pica')
    expect(screen.getByText('Picanha')).toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum item encontrado')
  })

  it('criar item: preço com máscara vira o texto "R$" e o envio leva a etiqueta marcada', async () => {
    const user = userEvent.setup()
    acoes.salvarItemAction.mockResolvedValue({ ok: true, data: { id: 'n' } })
    render(<Cardapio categorias={categorias} itens={[]} podeEditar />)
    await user.click(screen.getByRole('button', { name: 'Novo item' }))
    await user.type(screen.getByLabelText(/^Nome do item/), 'Costela')
    const preco = screen.getByLabelText(/^Preço/)
    await user.type(preco, '4590')
    expect(preco).toHaveValue('R$ 45,90')
    await user.click(screen.getByRole('button', { name: 'Sem glúten' }))
    expect(screen.getByRole('button', { name: 'Sem glúten' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Salvar item' }))
    await waitFor(() => expect(acoes.salvarItemAction).toHaveBeenCalledTimes(1))
    expect(acoes.salvarItemAction).toHaveBeenCalledWith(null, {
      categoryId: C1, nome: 'Costela', descricao: '', preco: 'R$ 45,90', tags: ['sem_gluten'], outrosNomes: [], disponivel: true, ordem: 1,
    })
  })

  it('item sem nome mostra a mensagem e não chama a ação; erro do servidor aparece no campo', async () => {
    const user = userEvent.setup()
    render(<Cardapio categorias={categorias} itens={[item()]} podeEditar />)
    await user.click(screen.getByRole('button', { name: 'Editar Picanha' }))
    expect(screen.getByLabelText(/^Preço/)).toHaveValue('R$ 89,90')
    await user.clear(screen.getByLabelText(/^Nome do item/))
    await user.click(screen.getByRole('button', { name: 'Salvar item' }))
    expect((await screen.findAllByText('Informe o nome')).length).toBeGreaterThan(0)
    expect(acoes.salvarItemAction).not.toHaveBeenCalled()
    acoes.salvarItemAction.mockResolvedValue({ ok: false, fieldErrors: { nome: 'Já existe um item com esse nome nessa categoria.' } })
    await user.type(screen.getByLabelText(/^Nome do item/), 'Picanha')
    await user.click(screen.getByRole('button', { name: 'Salvar item' }))
    expect((await screen.findAllByText('Já existe um item com esse nome nessa categoria.')).length).toBeGreaterThan(0)
  })

  it('dois envios seguidos chamam a ação uma vez só', async () => {
    let liberar: (v: { ok: true }) => void = () => {}
    acoes.salvarCategoriaAction.mockImplementation(() => new Promise((r) => { liberar = r }))
    const user = userEvent.setup()
    render(<Cardapio categorias={[]} itens={[]} podeEditar />)
    await user.click(screen.getByRole('button', { name: 'Nova categoria' }))
    await user.type(screen.getByLabelText(/^Nome da categoria/), 'Bebidas')
    const form = screen.getByLabelText(/^Nome da categoria/).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(acoes.salvarCategoriaAction).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    liberar({ ok: true })
    await waitFor(() => expect(acoes.salvarCategoriaAction).toHaveBeenCalledTimes(1))
    expect(acoes.salvarCategoriaAction).toHaveBeenCalledWith(null, { nome: 'Bebidas', ordem: '1', ativo: true })
  })

  it('sem permissão de edição não há botões; gerente restrito vê o porquê', () => {
    render(<Cardapio categorias={categorias} itens={[item()]} podeEditar={false} avisoSemEdicao="Só o dono altera." />)
    expect(screen.getByText('Picanha')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Só o dono altera.')).toBeInTheDocument()
  })
})

describe('ExcecoesItem', () => {
  const props = { unidades, categorias, itens: [item()], excecoes: [{ itemId: I1, unitId: U2, disponivel: false, precoOverrideCentavos: 9990 }], podeEditar: true }

  it('mostra o efetivo da unidade escolhida (preço próprio e indisponível)', async () => {
    const user = userEvent.setup()
    render(<ExcecoesItem {...props} />)
    expect(screen.getByText('R$ 89,90')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Unidade'), U2)
    expect(screen.getByText('R$ 99,90')).toBeInTheDocument()
    expect(screen.getByText('Indisponível')).toBeInTheDocument()
  })

  it('salva exceção: disponibilidade e preço da unidade; vazio segue o item', async () => {
    const user = userEvent.setup()
    acoes.salvarExcecaoAction.mockResolvedValue({ ok: true, data: null })
    render(<ExcecoesItem {...props} />)
    await user.click(screen.getByRole('button', { name: 'Ajustar Picanha nesta unidade' }))
    await user.selectOptions(screen.getByLabelText('Disponível nesta unidade'), 'nao')
    await user.type(screen.getByLabelText('Preço nesta unidade'), '9500')
    await user.click(screen.getByRole('button', { name: 'Salvar ajuste' }))
    await waitFor(() => expect(acoes.salvarExcecaoAction).toHaveBeenCalledWith({ itemId: I1, unitId: U1, disponivel: 'nao', preco: 'R$ 95,00' }))
  })

  it('voltar ao padrão envia "segue" e preço vazio', async () => {
    const user = userEvent.setup()
    acoes.salvarExcecaoAction.mockResolvedValue({ ok: true, data: null })
    render(<ExcecoesItem {...props} />)
    await user.selectOptions(screen.getByLabelText('Unidade'), U2)
    await user.click(screen.getByRole('button', { name: 'Ajustar Picanha nesta unidade' }))
    expect(screen.getByLabelText('Preço nesta unidade')).toHaveValue('R$ 99,90')
    await user.click(screen.getByRole('button', { name: 'Voltar ao padrão' }))
    await waitFor(() => expect(acoes.salvarExcecaoAction).toHaveBeenCalledWith({ itemId: I1, unitId: U2, disponivel: 'segue', preco: '' }))
  })

  it('atendente só consulta', () => {
    render(<ExcecoesItem {...props} podeEditar={false} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('ArquivosCardapio', () => {
  const arq = (o: Record<string, unknown> = {}) => ({ id: 'a1', unitId: null, titulo: 'Cardápio geral', mime: 'application/pdf', tamanho: 2_500_000, ativo: true, criadoEm: '2026-10-06T10:00:00.000Z', ...o })
  const escolher = (f: File) => fireEvent.change(screen.getByLabelText(/^Arquivo/), { target: { files: [f] } })

  it('upload rejeitado pelo servidor mostra a mensagem no campo do arquivo', async () => {
    const user = userEvent.setup()
    acoes.enviarArquivoAction.mockResolvedValue({ ok: false, fieldErrors: { arquivo: 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).' } })
    render(<ArquivosCardapio arquivos={[]} unidades={unidades} podeEnviar podeGeral />)
    escolher(new File(['MZ'], 'falso.pdf', { type: 'application/pdf' }))
    await user.type(screen.getByLabelText(/^Título/), 'Falso')
    await user.click(screen.getByRole('button', { name: 'Enviar arquivo' }))
    expect(await screen.findByText('Envie um PDF ou uma imagem (JPEG, PNG ou WebP).')).toBeInTheDocument()
    const fd = acoes.enviarArquivoAction.mock.calls[0]![0] as FormData
    expect(fd.get('titulo')).toBe('Falso')
    expect(fd.get('unitId')).toBe('')
  })

  it('arquivo grande é barrado no navegador (a regra real é do servidor); sem arquivo pede o arquivo', async () => {
    const user = userEvent.setup()
    render(<ArquivosCardapio arquivos={[]} unidades={unidades} podeEnviar podeGeral />)
    await user.click(screen.getByRole('button', { name: 'Enviar arquivo' }))
    expect(await screen.findByText('Escolha o arquivo do cardápio.')).toBeInTheDocument()
    const grande = new File(['x'], 'g.pdf', { type: 'application/pdf' })
    Object.defineProperty(grande, 'size', { value: 21 * 1024 * 1024 })
    escolher(grande)
    await user.click(screen.getByRole('button', { name: 'Enviar arquivo' }))
    expect(await screen.findByText('O arquivo passa de 20 MB. Envie um menor.')).toBeInTheDocument()
    expect(acoes.enviarArquivoAction).not.toHaveBeenCalled()
  })

  it('lista com escopo e tamanho; prévia abre pela URL assinada; ativar/desativar', async () => {
    const user = userEvent.setup()
    acoes.urlPreviaArquivoAction.mockResolvedValue({ ok: true, data: { url: 'https://s/x.png', mime: 'image/png', titulo: 'Foto' } })
    acoes.ativarArquivoAction.mockResolvedValue({ ok: true, data: null })
    render(<ArquivosCardapio arquivos={[arq(), arq({ id: 'a2', unitId: U1, titulo: 'Foto', mime: 'image/png', ativo: false })]} unidades={unidades} podeEnviar podeGeral />)
    expect(screen.getByText('Todas as unidades · PDF · 2,4 MB')).toBeInTheDocument()
    expect(screen.getByText('Desativado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ver prévia: Foto/ }))
    expect(await screen.findByRole('img', { name: 'Prévia de Foto' })).toHaveAttribute('src', 'https://s/x.png')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Ativar: Foto/ }))
    await waitFor(() => expect(acoes.ativarArquivoAction).toHaveBeenCalledWith('a2', true))
  })

  it('atendente só vê a lista e a prévia; gerente restrito não mexe em arquivo geral nem escolhe "todas"', async () => {
    const { rerender } = render(<ArquivosCardapio arquivos={[arq()]} unidades={unidades} podeEnviar={false} podeGeral={false} />)
    expect(screen.queryByLabelText(/^Arquivo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Desativar/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ver prévia/ })).toBeInTheDocument()
    rerender(<ArquivosCardapio arquivos={[arq(), arq({ id: 'a2', unitId: U1, titulo: 'Da Asa Sul' })]} unidades={[unidades[0]!]} podeEnviar podeGeral={false} />)
    expect(screen.queryByRole('button', { name: 'Desativar: Cardápio geral' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desativar: Da Asa Sul' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Vale para')).queryByRole('option', { name: 'Todas as unidades' })).not.toBeInTheDocument()
  })
})
