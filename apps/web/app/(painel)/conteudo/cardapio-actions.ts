'use server'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ativarArquivo, listarCardapio, registrarArquivoCardapio, salvarCategoria, salvarExcecaoItem, salvarItem, type ErroPainel, type ResultadoPainel } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { LIMITE_ARQUIVO_BYTES, validarArquivoCardapio } from '@/lib/arquivo-cardapio'
import { requireStaff } from '@/lib/dal'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import {
  arquivoMetaSchema, categoriaSchema, excecaoSchema, itemSchema,
  type CategoriaForm, type ExcecaoForm, type ItemForm,
} from '@/lib/schemas/cardapio'
import { getDb } from '@/lib/server/db'
import { createClient } from '@/lib/supabase/server'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADO = { ok: false as const, formError: 'Não encontramos esse item.' }
const idValido = (id: string) => z.uuid().safeParse(id).success
const SEM_PERMISSAO_GERAL = 'Só o dono, ou gerente com acesso a todas as unidades, altera categorias e itens.'
const SEM_PERMISSAO_UNIDADE = 'Você só pode alterar o cardápio das unidades que gerencia.'
const PREVIA_SEGUNDOS = 120

function revalidar() {
  revalidatePath('/conteudo')
}

/** Resultado do banco em ActionResult com mensagens do cardápio (a de `nome_duplicado` vai para o campo Nome). */
function resultado<T>(r: ResultadoPainel<T>, o: { semPermissao: string; duplicado?: string }): ActionResult<T> {
  if (r.ok) {
    revalidar()
    return { ok: true, data: r.valor }
  }
  const erro: ErroPainel = r.erro
  if (erro === 'sem_permissao') return { ok: false, formError: o.semPermissao }
  if (erro === 'nome_duplicado' && o.duplicado) return { ok: false, fieldErrors: { nome: o.duplicado } }
  return { ok: false, formError: MENSAGEM_ERRO_PAINEL[erro] }
}

export async function salvarCategoriaAction(id: string | null, input: CategoriaForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADO
  const p = categoriaSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarCategoria(getDb(), s.claims, id, p.data)
  return resultado(r, { semPermissao: SEM_PERMISSAO_GERAL, duplicado: 'Já existe uma categoria com esse nome.' })
}

export async function salvarItemAction(id: string | null, input: ItemForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADO
  const p = itemSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const { preco, ...resto } = p.data
  const r = await salvarItem(getDb(), s.claims, id, { ...resto, precoCentavos: preco })
  return resultado(r, { semPermissao: SEM_PERMISSAO_GERAL, duplicado: 'Já existe um item com esse nome nessa categoria.' })
}

/** Sem disponibilidade própria e sem preço próprio = o item volta ao padrão da unidade. */
export async function salvarExcecaoAction(input: ExcecaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  const p = excecaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const { itemId, unitId, disponivel, precoOverrideCentavos } = p.data
  const dados = disponivel === null && precoOverrideCentavos === null
    ? { itemId, unitId, remover: true as const }
    : { itemId, unitId, disponivel, precoOverrideCentavos }
  const r = await salvarExcecaoItem(getDb(), s.claims, dados)
  return resultado(r, { semPermissao: SEM_PERMISSAO_UNIDADE })
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const jaExiste = (e: { statusCode?: string | number; message?: string }) => String(e.statusCode) === '409' || /already exists/i.test(e.message ?? '')

/**
 * Upload do cardápio: tipo, tamanho e sha256 são conferidos aqui (nunca confiar no navegador) e o objeto vai ao
 * Storage com a sessão do próprio usuário (policies por papel). O nome é o sha256: mesmo conteúdo, mesmo objeto.
 */
export async function enviarArquivoAction(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  const meta = arquivoMetaSchema.safeParse({ titulo: fd.get('titulo') ?? '', unitId: fd.get('unitId') ?? '' })
  const arquivo = fd.get('arquivo')
  const erros: Record<string, string> = meta.success ? {} : actionErrorFromZod(meta.error).fieldErrors
  const semArquivo = !(arquivo instanceof File) || (arquivo.size === 0 && arquivo.name === '')
  if (semArquivo) erros.arquivo = 'Escolha o arquivo do cardápio.'
  if (!meta.success || semArquivo) return { ok: false, fieldErrors: erros }
  if (arquivo.size > LIMITE_ARQUIVO_BYTES) return { ok: false, fieldErrors: { arquivo: 'O arquivo passa de 20 MB. Envie um menor.' } }

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const v = validarArquivoCardapio(bytes)
  if (!v.ok) return { ok: false, fieldErrors: { arquivo: v.erro } }

  const hash = sha256(bytes)
  const objeto = `${s.restaurantId}/${hash}.${v.ext}`
  const supabase = await createClient()
  const { error } = await supabase.storage.from('cardapio').upload(objeto, bytes, { contentType: v.mime, upsert: false })
  if (error && !jaExiste(error as { statusCode?: string; message?: string })) {
    return { ok: false, formError: 'Não foi possível enviar o arquivo agora. Tente de novo.' }
  }
  const r = await registrarArquivoCardapio(getDb(), s.claims, {
    unitId: meta.data.unitId, titulo: meta.data.titulo, storagePath: `cardapio/${objeto}`, mime: v.mime, tamanho: bytes.length, sha256: hash,
  })
  return resultado(r, { semPermissao: SEM_PERMISSAO_UNIDADE })
}

export async function ativarArquivoAction(id: string, ativo: boolean): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADO
  const r = await ativarArquivo(getDb(), s.claims, id, ativo)
  return resultado(r, { semPermissao: SEM_PERMISSAO_UNIDADE })
}

/** URL assinada curta para ver o arquivo (bucket privado). Só arquivos que a RLS deixa o usuário ver. */
export async function urlPreviaArquivoAction(id: string): Promise<ActionResult<{ url: string; mime: string; titulo: string }>> {
  const s = await requireStaff()
  if (!idValido(id)) return NAO_ENCONTRADO
  const { arquivos } = await listarCardapio(getDb(), s.claims)
  const a = arquivos.find((x) => x.id === id)
  const [bucket, ...resto] = a?.storagePath.split('/') ?? []
  if (!a || !bucket) return NAO_ENCONTRADO
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(resto.join('/'), PREVIA_SEGUNDOS)
  if (error || !data) return { ok: false, formError: 'Não foi possível abrir o arquivo agora. Tente de novo.' }
  return { ok: true, data: { url: data.signedUrl, mime: a.mime, titulo: a.titulo } }
}
