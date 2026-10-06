import { redirect, notFound } from 'next/navigation'
import { describe, expect, it } from 'vitest'
import { chamarAcao, ERRO_AO_SALVAR } from './action-result'

describe('chamarAcao', () => {
  it('devolve o resultado da ação', async () => {
    expect(await chamarAcao(async () => ({ ok: true as const }))).toEqual({ ok: true })
  })
  it('exceção comum vira erro geral', async () => {
    expect(await chamarAcao(async () => { throw new Error('rede') })).toEqual({ ok: false, formError: ERRO_AO_SALVAR })
  })
  it('repropaga redirect e notFound do Next em vez de engolir', async () => {
    await expect(chamarAcao(async () => redirect('/entrar'))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    await expect(chamarAcao(async () => notFound())).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
  })
})
