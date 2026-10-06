'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  rascunhoCardapioImportacaoSchema, rascunhoEspacosSchema, rascunhoHorariosSchema, rascunhoInformacoesSchema, rascunhoSoPrecosSchema,
} from '@atd/core/importacao'
import { anexarArquivo, aplicarImportacao, criarImportacaoArquivos, enqueueIngest, iniciarLeitura, lerImportacao, removerArquivo } from '@atd/db'
import type { ActionResult } from '@/lib/action-result'
import type { AlvoImportacaoTela, ModoImportacaoTela } from '@/lib/importacao'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import { requireStaff } from '@/lib/dal'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import { arquivoDoForm, ERRO_STORAGE, lerArquivoCardapio, subirArquivo } from '@/lib/server/upload-arquivo'
import { createClient } from '@/lib/supabase/server'

/**
 * Importação por alvo com vários arquivos (Etapa 07): criar → anexar um arquivo por requisição (até 10) → "Ler
 * arquivos" (enfileira a leitura por lotes) → revisão → aplicar (PRD I10). Dono/gerente; o banco exige acesso a
 * todas as unidades.
 */
const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const SEM_PERMISSAO = 'Só o dono, ou gerente com acesso a todas as unidades, importa arquivos.'
const SEM_PERMISSAO_APLICAR = 'Só o dono, ou gerente com acesso a todas as unidades, aplica a importação.'
const JA_INICIADA = 'A leitura destes arquivos já começou. Para mudar a lista, comece outra importação.'
const RASCUNHO_INVALIDO = 'Algum dado está inválido. Confira e tente de novo.'
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa importação.' }
const idValido = (id: string) => z.uuid().safeParse(id).success

const alvoModoSchema = z
  .object({ alvo: z.enum(['cardapio', 'informacoes', 'horarios', 'espacos']), modo: z.enum(['completo', 'so_precos']) })
  .refine((v) => v.modo === 'completo' || v.alvo === 'cardapio', { message: '"Só preços" é só para o cardápio.' })

const erroPainel = (erro: keyof typeof MENSAGEM_ERRO_PAINEL) => ({
  ok: false as const,
  formError: erro === 'sem_permissao' ? SEM_PERMISSAO : MENSAGEM_ERRO_PAINEL[erro],
})

export async function novaImportacaoAction(v: { alvo: AlvoImportacaoTela; modo: ModoImportacaoTela }): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  const p = alvoModoSchema.safeParse(v)
  if (!p.success) return { ok: false, formError: 'Escolha o que importar.' }
  const r = await criarImportacaoArquivos(getDb(), s.claims, p.data)
  if (!r.ok) return erroPainel(r.erro)
  revalidatePath('/conteudo')
  return { ok: true, data: r.valor }
}

/** Um arquivo por requisição: tipo pelos primeiros bytes, tamanho e sha256 no servidor; vai ao bucket `importacoes`. */
export async function anexarArquivoAction(id: string, fd: FormData): Promise<ActionResult<{ ordem: number }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const arquivo = arquivoDoForm(fd.get('arquivo'))
  if (!arquivo) return { ok: false, fieldErrors: { arquivo: 'Escolha o arquivo.' } }
  const a = await lerArquivoCardapio(arquivo)
  if (!a.ok) return { ok: false, fieldErrors: { arquivo: a.erro } }
  const enviado = await subirArquivo('importacoes', s.restaurantId, a)
  if (!enviado.ok) return { ok: false, formError: ERRO_STORAGE }
  const r = await anexarArquivo(getDb(), s.claims, id, { storagePath: enviado.storagePath, mime: a.mime, tamanho: a.bytes.length, sha256: a.sha256 })
  if (r.ok) {
    if (r.valor.descartarCaminho !== null) await apagarSobra(r.valor.descartarCaminho)
    return { ok: true, data: { ordem: r.valor.ordem } }
  }
  if (r.erro === 'limite_arquivos') return { ok: false, formError: 'No máximo 10 arquivos por importação.' }
  if (r.erro === 'ja_iniciada') return { ok: false, formError: JA_INICIADA }
  return erroPainel(r.erro)
}

/**
 * O conteúdo já estava na lista com outro caminho: apaga o objeto recém-enviado (sessão do usuário; as policies do
 * Storage decidem). Melhor esforço: falhar aqui não desfaz o anexo.
 */
async function apagarSobra(caminho: string) {
  const objeto = caminho.replace(/^importacoes\//, '')
  if (objeto === caminho) return
  try {
    const supabase = await createClient()
    await supabase.storage.from('importacoes').remove([objeto])
  } catch {
    // objeto órfão: sem dado do documento em log
  }
}

export async function removerArquivoAction(id: string, ordem: number): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id) || !z.int().min(1).max(10).safeParse(ordem).success) return NAO_ENCONTRADA
  const r = await removerArquivo(getDb(), s.claims, id, ordem)
  if (r.ok) return { ok: true, data: null }
  if (r.erro === 'ja_iniciada') return { ok: false, formError: JA_INICIADA }
  return erroPainel(r.erro)
}

const NAO_ENFILEIROU = 'Recebemos os arquivos, mas não foi possível começar a leitura agora. Tente de novo em instantes.'

/**
 * "Ler arquivos": fecha a lista e enfileira a leitura (singletonKey = id). O mesmo conjunto já importado devolve a
 * importação existente (`existente`). Clicar de novo depois de a fila falhar reenfileira (a leitura já iniciada
 * continua `enviado` até o worker pegar).
 */
export async function lerArquivosAction(id: string): Promise<ActionResult<{ id: string; existente: boolean }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const db = getDb()
  const r = await iniciarLeitura(db, s.claims, id)
  if (!r.ok) {
    if (r.erro === 'ja_importado') return { ok: true, data: { id: r.id, existente: true } }
    if (r.erro === 'sem_arquivos') return { ok: false, formError: 'Envie ao menos um arquivo antes de ler.' }
    if (r.erro !== 'ja_iniciada') return erroPainel(r.erro)
    const imp = await lerImportacao(db, s.claims, id)
    if (!imp) return NAO_ENCONTRADA
    if (imp.status !== 'enviado' || imp.recebendo) return { ok: true, data: { id, existente: false } }
  }
  revalidatePath('/conteudo')
  try {
    await enqueueIngest(await getBoss())(id)
  } catch {
    return { ok: false, formError: NAO_ENFILEIROU }
  }
  return { ok: true, data: { id, existente: false } }
}

const SCHEMAS = {
  cardapio: { completo: rascunhoCardapioImportacaoSchema, so_precos: rascunhoSoPrecosSchema },
  informacoes: { completo: rascunhoInformacoesSchema },
  horarios: { completo: rascunhoHorariosSchema },
  espacos: { completo: rascunhoEspacosSchema },
} as const

function schemaDoAlvo(alvo: string, modo: string): z.ZodType | null {
  const porModo = (SCHEMAS as Record<string, Record<string, z.ZodType> | undefined>)[alvo]
  return porModo?.[modo] ?? null
}

/**
 * Confirmação humana (PRD I10) do rascunho revisado, validado aqui pelo schema do alvo e de novo no banco (que também
 * confere o alvo da importação). Sem revalidatePath: a tela mostra o resultado e o usuário navega.
 */
export async function aplicarImportacaoAction(
  id: string,
  entrada: { alvo: AlvoImportacaoTela; modo: ModoImportacaoTela; rascunho: unknown },
): Promise<ActionResult<{ criados: number; atualizados: number; ignorados: number }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADA
  const schema = schemaDoAlvo(entrada.alvo, entrada.modo)
  const r = schema?.safeParse(entrada.rascunho)
  if (!r?.success) return { ok: false, formError: RASCUNHO_INVALIDO }
  const res = await aplicarImportacao(getDb(), s.claims, id, r.data)
  if (res.ok) return { ok: true, data: res.valor }
  switch (res.erro) {
    case 'unidade_nao_escolhida':
      return { ok: false, formError: 'Escolha a unidade de cada horário ou espaço marcado (ou deixe-o de fora) antes de confirmar.' }
    case 'ja_aplicado':
      return { ok: false, formError: 'Essa importação já foi aplicada.' }
    case 'rascunho_invalido':
      return { ok: false, formError: RASCUNHO_INVALIDO }
    case 'sem_permissao':
      return { ok: false, formError: SEM_PERMISSAO_APLICAR }
    case 'nao_pronta':
      return { ok: false, formError: 'Esta importação não está pronta para confirmar: a leitura ainda não terminou, deu erro ou ela foi descartada. Atualize a página.' }
    default:
      return { ok: false, formError: MENSAGEM_ERRO_PAINEL[res.erro] }
  }
}
