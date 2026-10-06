import { describe, expect, it } from 'vitest'
import { ambienteDoWorkerE2e, workersQueBloqueiam } from './worker'

describe('guarda do worker do e2e', () => {
  it('ignora o heartbeat do teste de banco do worker (worker-teste); outro worker bloqueia', () => {
    expect(workersQueBloqueiam([{ worker_id: 'worker-teste' }])).toEqual([])
    expect(workersQueBloqueiam([{ worker_id: 'worker-teste' }, { worker_id: 'vps-1234' }])).toEqual(['vps-1234'])
  })
})

describe('ambiente do worker do e2e', () => {
  const shell = { OPENROUTER_API_KEY: 'sk-or-local', AI_TRIAGE_MODELS: 'nvidia/x:free', OPENROUTER_DEV_SEM_ZDR: '1', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico-bem-longa-0123456789' }

  it('roda o caminho de produção: OpenAI apontando para o servidor falso, modelos da tabela de preços', () => {
    const env = ambienteDoWorkerE2e(shell, 'http://127.0.0.1:4010')
    expect(env).toMatchObject({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'e2e',
      OPENAI_BASE_URL: 'http://127.0.0.1:4010',
      AI_TRIAGE_MODELS: 'gpt-4.1-mini',
      AI_INGEST_MODELS: 'gpt-4.1-mini,gpt-4.1',
    })
  })

  it('nunca leva a chave nem a base do OpenRouter do .env local (o worker nunca chama a IA de verdade)', () => {
    const env = ambienteDoWorkerE2e(shell, 'http://127.0.0.1:4010')
    expect(env.OPENROUTER_API_KEY).toBe('')
    expect(env.OPENROUTER_BASE_URL).toBe('')
    expect(env.OPENROUTER_DEV_SEM_ZDR).toBe('0')
  })
})
