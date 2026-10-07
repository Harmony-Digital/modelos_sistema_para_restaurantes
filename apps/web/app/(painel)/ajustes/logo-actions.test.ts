import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarLogo = vi.fn()
const removerLogo = vi.fn()
const revalidatePath = vi.fn()
const ordem: string[] = []
const upload = vi.fn()
const remove = vi.fn()
const from = vi.fn(() => ({ upload, remove }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ storage: { from } }) }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarLogo, removerLogo }))

const { enviarLogoAction, removerLogoAction } = await import('./logo-actions')

const REST = '00000000-0000-4000-8000-0000000000aa'
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(100).fill(0)]
const sha = (b: number[]) => createHash('sha256').update(Uint8Array.from(b)).digest('hex')
const form = (bytes: number[] | null, name = 'logo.png', type = 'image/png') => {
  const fd = new FormData()
  if (bytes) fd.set('arquivo', new File([Uint8Array.from(bytes)], name, { type }))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  ordem.length = 0
  requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: REST, role: 'gerente' })
  upload.mockImplementation(async () => { ordem.push('upload'); return { error: null } })
  remove.mockImplementation(async (p: string[]) => { ordem.push(`remove:${p.join(',')}`); return { data: [], error: null } })
  salvarLogo.mockImplementation(async () => { ordem.push('banco'); return { ok: true, valor: { anterior: `${REST}/logo-${'b'.repeat(64)}.jpg` } } })
  removerLogo.mockImplementation(async () => { ordem.push('banco'); return { ok: true, valor: { anterior: `${REST}/logo-${'b'.repeat(64)}.jpg` } } })
})

describe('enviarLogoAction', () => {
  it('dono ou gerente: confere pelos bytes, grava no bucket marca, salva no banco e só então apaga a anterior', async () => {
    expect(await enviarLogoAction(form(PNG))).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    const caminho = `${REST}/logo-${sha(PNG)}.png`
    expect(from).toHaveBeenCalledWith('marca')
    expect(upload).toHaveBeenCalledWith(caminho, expect.any(Uint8Array), { contentType: 'image/png', upsert: false })
    expect(salvarLogo).toHaveBeenCalledWith('db', { sub: 'u' }, REST, caminho)
    expect(ordem).toEqual(['upload', 'banco', `remove:${REST}/logo-${'b'.repeat(64)}.jpg`])
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('a mesma logo já enviada (objeto existe) é aceita; sem anterior, nada é apagado', async () => {
    upload.mockResolvedValue({ error: { statusCode: '409', message: 'The resource already exists' } })
    salvarLogo.mockResolvedValue({ ok: true, valor: { anterior: null } })
    expect(await enviarLogoAction(form(PNG))).toEqual({ ok: true, data: null })
    expect(remove).not.toHaveBeenCalled()
  })

  it('recusa .png que é SVG ou PDF, arquivo acima de 1 MB e campo vazio, sem tocar no Storage nem no banco', async () => {
    const svg = [...'<svg xmlns="http://www.w3.org/2000/svg"/>'].map((c) => c.charCodeAt(0))
    const pdf = [...'%PDF-1.7'].map((c) => c.charCodeAt(0))
    const tipo = { ok: false, fieldErrors: { arquivo: 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).' } }
    expect(await enviarLogoAction(form(svg))).toEqual(tipo)
    expect(await enviarLogoAction(form(svg, 'logo.svg', 'image/svg+xml'))).toEqual(tipo)
    expect(await enviarLogoAction(form(pdf))).toEqual(tipo)
    const grande = new Array(1024 * 1024 + 1).fill(0)
    grande.splice(0, PNG.length, ...PNG)
    expect(await enviarLogoAction(form(grande))).toEqual({ ok: false, fieldErrors: { arquivo: 'A logo passa de 1 MB. Envie uma imagem menor.' } })
    expect(await enviarLogoAction(form(null))).toEqual({ ok: false, fieldErrors: { arquivo: 'Escolha a imagem da logo.' } })
    expect(upload).not.toHaveBeenCalled()
    expect(salvarLogo).not.toHaveBeenCalled()
  })

  it('falha no Storage: mensagem geral, sem gravar no banco', async () => {
    upload.mockResolvedValue({ error: { statusCode: '403', message: 'denied' } })
    expect(await enviarLogoAction(form(PNG))).toEqual({ ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' })
    expect(salvarLogo).not.toHaveBeenCalled()
  })

  it('banco recusa (sem permissão): apaga o objeto novo, mantém o anterior e não revalida', async () => {
    salvarLogo.mockImplementation(async () => { ordem.push('banco'); return { ok: false, erro: 'sem_permissao' } })
    expect(await enviarLogoAction(form(PNG))).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    expect(ordem).toEqual(['upload', 'banco', `remove:${REST}/logo-${sha(PNG)}.png`])
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('banco recusa e o objeto já existia (pode ser a logo atual): não apaga nada', async () => {
    upload.mockImplementation(async () => { ordem.push('upload'); return { error: { statusCode: '409', message: 'The resource already exists' } } })
    salvarLogo.mockImplementation(async () => { ordem.push('banco'); return { ok: false, erro: 'nao_encontrada' } })
    expect((await enviarLogoAction(form(PNG))).ok).toBe(false)
    expect(ordem).toEqual(['upload', 'banco'])
  })

  it('falha ao apagar a anterior não desfaz a troca (o banco já gravou)', async () => {
    remove.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await enviarLogoAction(form(PNG))).toEqual({ ok: true, data: null })
  })
})

describe('removerLogoAction', () => {
  it('remove no banco e depois apaga o objeto anterior', async () => {
    expect(await removerLogoAction()).toEqual({ ok: true, data: null })
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
    expect(removerLogo).toHaveBeenCalledWith('db', { sub: 'u' }, REST)
    expect(ordem).toEqual(['banco', `remove:${REST}/logo-${'b'.repeat(64)}.jpg`])
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('sem logo: nada a apagar; recusa do banco vira mensagem sem apagar nada', async () => {
    removerLogo.mockResolvedValue({ ok: true, valor: { anterior: null } })
    expect(await removerLogoAction()).toEqual({ ok: true, data: null })
    removerLogo.mockResolvedValue({ ok: false, erro: 'sem_permissao' })
    expect(await removerLogoAction()).toEqual({ ok: false, formError: 'Você não tem permissão para fazer essa alteração.' })
    expect(remove).not.toHaveBeenCalled()
  })
})
