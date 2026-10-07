'use server'
import { revalidatePath } from 'next/cache'
import { removerLogo, salvarLogo, type ResultadoMarca } from '@atd/db'
import type { ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { MENSAGEM_ERRO_PAINEL } from '@/lib/painel-erros'
import { getDb } from '@/lib/server/db'
import { apagarDaMarca, arquivoDoForm, ERRO_STORAGE, lerImagemLogo, subirArquivo } from '@/lib/server/upload-arquivo'

/** Logo do restaurante (spec §7): só dono e gerente; o banco grava primeiro e o objeto anterior é apagado depois. */
const GESTAO = ['dono', 'gerente'] as const

const erroDoBanco = (r: Extract<ResultadoMarca<unknown>, { ok: false }>): ActionResult<null> =>
  r.erro === 'valor_invalido'
    ? { ok: false, fieldErrors: { arquivo: 'Envie a logo em PNG, JPG ou WebP (SVG não é aceito).' } }
    : { ok: false, formError: MENSAGEM_ERRO_PAINEL[r.erro] }

export async function enviarLogoAction(fd: FormData): Promise<ActionResult<null>> {
  const s = await requireStaff([...GESTAO])
  const arquivo = arquivoDoForm(fd.get('arquivo'))
  if (!arquivo) return { ok: false, fieldErrors: { arquivo: 'Escolha a imagem da logo.' } }
  const a = await lerImagemLogo(arquivo)
  if (!a.ok) return { ok: false, fieldErrors: { arquivo: a.erro } }
  const enviado = await subirArquivo('marca', s.restaurantId, a, 'logo-')
  if (!enviado.ok) return { ok: false, formError: ERRO_STORAGE }
  const caminho = enviado.storagePath.replace(/^marca\//, '')
  const r = await salvarLogo(getDb(), s.claims, s.restaurantId, caminho)
  if (!r.ok) {
    // o objeto novo não ficou no banco (o anterior continua valendo); se já existia, pode ser a logo em uso: fica
    if (enviado.criado) await apagarDaMarca(caminho)
    return erroDoBanco(r)
  }
  if (r.valor.anterior && r.valor.anterior !== caminho) await apagarDaMarca(r.valor.anterior)
  revalidatePath('/', 'layout')
  return { ok: true, data: null }
}

export async function removerLogoAction(): Promise<ActionResult<null>> {
  const s = await requireStaff([...GESTAO])
  const r = await removerLogo(getDb(), s.claims, s.restaurantId)
  if (!r.ok) return erroDoBanco(r)
  if (r.valor.anterior) await apagarDaMarca(r.valor.anterior)
  revalidatePath('/', 'layout')
  return { ok: true, data: null }
}
