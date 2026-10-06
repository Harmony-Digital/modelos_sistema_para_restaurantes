'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { lerCsvCardapio, rascunhoSchema, type RascunhoCardapio } from '@atd/core/s4'
import {
  aplicarRascunho, criarImportacao, enqueueIngest, lerImportacao, rejeitarImportacao,
  type ItemIgnorado, type StatusImportacao,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import { opcoesImportacaoSchema, type OpcoesImportacao } from '@/lib/schemas/cardapio'
import { requireStaff } from '@/lib/dal'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import {
  arquivoDoForm, copiarParaCardapio, ERRO_SEM_ARQUIVO, ERRO_STORAGE, lerArquivoCardapio, sha256, subirArquivo,
} from '@/lib/server/upload-arquivo'

/** Importações são só de dono/gerente (RLS de knowledge_documents). */
const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const LIMITE_CSV_BYTES = 2 * 1024 * 1024
const SEM_PERMISSAO = 'Só o dono ou o gerente importam o cardápio.'
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa importação.' }
const idValido = (id: string) => z.uuid().safeParse(id).success

function revalidar() {
  revalidatePath('/conteudo')
}

/** UTF-8; se não for (Excel pt-BR costuma salvar em Windows-1252), lê como Windows-1252. */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Planilha do cardápio lida no servidor (sem IA). Com erros por linha, nada é criado e os erros voltam para a tela
 * (`id: null`); sem erros, a importação nasce `rascunho` e segue para a revisão.
 */
export async function importarCsvAction(fd: FormData): Promise<ActionResult<{ id: string | null; erros: string[] }>> {
  const s = await requireStaff(GESTAO)
  const arquivo = arquivoDoForm(fd.get('arquivo'))
  if (!arquivo) return { ok: false, fieldErrors: { arquivo: 'Escolha a planilha CSV.' } }
  if (arquivo.size > LIMITE_CSV_BYTES) return { ok: false, fieldErrors: { arquivo: 'A planilha passa de 2 MB.' } }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  // byte nulo = arquivo binário (.xlsx é um zip, PDF, imagem): CSV é texto
  if (bytes.includes(0)) return { ok: false, fieldErrors: { arquivo: 'Envie a planilha salva como CSV (no Excel: Salvar como → CSV).' } }

  const { rascunho, erros } = lerCsvCardapio(decodificar(bytes))
  if (erros.length > 0) return { ok: true, data: { id: null, erros: erros.map((e) => e.mensagem) } }

  const r = await criarImportacao(getDb(), s.claims, {
    storagePath: null, mime: 'text/csv', tamanho: bytes.length, sha256: sha256(bytes), origem: 'csv', draft: rascunho,
  })
  if (!r.ok) return { ok: false, formError: r.erro === 'sem_permissao' ? SEM_PERMISSAO : MENSAGEM_ERRO_PAINEL[r.erro] }
  revalidar()
  return { ok: true, data: { id: r.valor.id, erros: [] } }
}

/**
 * PDF/foto do cardápio: validado e gravado no bucket `importacoes` como o arquivo de cardápio; a importação nasce
 * `enviado` e a leitura por IA vai para a fila. Mesmo arquivo já importado devolve a importação existente — fora de
 * `enviado` (lendo, em rascunho, aplicada) ela não volta para a fila e a tela segue o estado atual.
 */
export async function importarArquivoAction(fd: FormData): Promise<ActionResult<{ id: string; status: StatusImportacao }>> {
  const s = await requireStaff(GESTAO)
  const arquivo = arquivoDoForm(fd.get('arquivo'))
  if (!arquivo) return { ok: false, fieldErrors: { arquivo: ERRO_SEM_ARQUIVO } }
  const a = await lerArquivoCardapio(arquivo)
  if (!a.ok) return { ok: false, fieldErrors: { arquivo: a.erro } }
  const enviado = await subirArquivo('importacoes', s.restaurantId, a)
  if (!enviado.ok) return { ok: false, formError: ERRO_STORAGE }

  const db = getDb()
  const r = await criarImportacao(db, s.claims, {
    storagePath: enviado.storagePath, mime: a.mime, tamanho: a.bytes.length, sha256: a.sha256, origem: 'arquivo',
  })
  if (!r.ok) return { ok: false, formError: r.erro === 'sem_permissao' ? SEM_PERMISSAO : MENSAGEM_ERRO_PAINEL[r.erro] }
  const imp = await lerImportacao(db, s.claims, r.valor.id)
  if (!imp) return NAO_ENCONTRADA
  revalidar()
  if (imp.status === 'enviado') {
    try {
      // singletonKey = id: reenviar o mesmo arquivo enquanto `enviado` não duplica o job
      await enqueueIngest(await getBoss())(imp.id)
    } catch {
      return { ok: false, formError: 'Recebemos o arquivo, mas não foi possível começar a leitura agora. Envie de novo em instantes.' }
    }
  }
  return { ok: true, data: { id: imp.id, status: imp.status } }
}

/** Para o acompanhamento da leitura (polling da tela). */
export async function estadoImportacaoAction(id: string): Promise<ActionResult<{ status: StatusImportacao; erro: string | null }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const imp = await lerImportacao(getDb(), s.claims, id)
  if (!imp) return NAO_ENCONTRADA
  return { ok: true, data: { status: imp.status, erro: imp.erro } }
}

/**
 * Confirmação humana do rascunho revisado (PRD I10). Sem revalidatePath de propósito: a tela de revisão mostra o
 * resultado (inclusive os itens ignorados) e só então o usuário navega. Com "usar como arquivo de envio", o arquivo
 * é copiado antes para o bucket `cardapio` (a equipe toda vê a prévia; `importacoes` é só de dono/gerente).
 */
export async function aplicarRascunhoAction(
  id: string,
  rascunho: RascunhoCardapio,
  opcoes: OpcoesImportacao,
): Promise<ActionResult<{ criados: number; atualizados: number; ignorados: ItemIgnorado[] }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const r = rascunhoSchema.safeParse(rascunho)
  if (!r.success) return { ok: false, formError: 'Algum item está com dado inválido. Confira nomes e preços.' }
  const o = opcoesImportacaoSchema.safeParse(opcoes)
  if (!o.success) return actionErrorFromZod(o.error)
  const db = getDb()
  if (o.data.usarComoArquivoDeEnvio) {
    const imp = await lerImportacao(db, s.claims, id)
    if (!imp) return NAO_ENCONTRADA
    // sem arquivo (CSV): aplicarRascunho recusa com arquivo_invalido
    if (imp.storagePath !== null && !(await copiarParaCardapio(imp.storagePath))) return { ok: false, formError: ERRO_STORAGE }
  }
  const res = await aplicarRascunho(db, s.claims, id, r.data, o.data)
  if (res.ok) return { ok: true, data: res.valor }
  if (res.erro === 'ja_aplicado') return { ok: false, formError: 'Essa importação já foi aplicada.' }
  if (res.erro === 'arquivo_invalido') return { ok: false, formError: 'Este arquivo não pode ser usado como cardápio para enviar aos clientes.' }
  if (res.erro === 'sem_permissao') return { ok: false, formError: 'Só o dono, ou gerente com acesso a todas as unidades, aplica a importação.' }
  return { ok: false, formError: MENSAGEM_ERRO_PAINEL[res.erro] }
}

/** Descarta o rascunho (ou a importação com erro). */
export async function descartarImportacaoAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const r = await rejeitarImportacao(getDb(), s.claims, id)
  if (r.ok) {
    revalidar()
    return { ok: true, data: null }
  }
  if (r.erro === 'nao_encontrada') return { ok: false, formError: 'Essa importação já foi aplicada ou descartada.' }
  return { ok: false, formError: r.erro === 'sem_permissao' ? SEM_PERMISSAO : MENSAGEM_ERRO_PAINEL[r.erro] }
}
