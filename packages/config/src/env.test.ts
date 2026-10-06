import { describe, expect, it } from 'vitest'
import { iaEnvSchema, loadEnv, secretsEnvSchema, workerEnvSchema, webEnvSchema } from './env.ts'

const key32 = Buffer.alloc(32, 7).toString('base64')
const valida = {
  DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
  PHONE_ENC_KEY: key32,
  WA_ID_PEPPER: key32,
  WHATSAPP_APP_SECRET: 'segredo',
  WHATSAPP_VERIFY_TOKEN: 'verifica',
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  OPENROUTER_API_KEY: 'sk-or-x',
  AI_TRIAGE_MODELS: 'a/modelo-1, b/modelo-2',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico-bem-longa-0123456789',
}

describe('loadEnv', () => {
  it('aceita env válida e aplica defaults', () => {
    const env = loadEnv(workerEnvSchema, valida)
    expect(env.WHATSAPP_GRAPH_VERSION).toBe('v24.0')
    expect(env.AI_TRIAGE_MODELS).toEqual(['a/modelo-1', 'b/modelo-2'])
    expect(env.LOG_LEVEL).toBe('info')
  })

  it('erro lista nomes das variáveis e nunca os valores', () => {
    const fn = () => loadEnv(secretsEnvSchema, { PHONE_ENC_KEY: 'curta-demais-SEGREDO', WA_ID_PEPPER: undefined })
    expect(fn).toThrowError(/PHONE_ENC_KEY/)
    expect(fn).toThrowError(/WA_ID_PEPPER/)
    expect(fn).not.toThrowError(/SEGREDO/)
  })

  it('rejeita chave que não tem 32 bytes', () => {
    const short = Buffer.alloc(16).toString('base64')
    expect(() => loadEnv(secretsEnvSchema, { PHONE_ENC_KEY: short, WA_ID_PEPPER: key32 })).toThrowError(/PHONE_ENC_KEY/)
  })

  it('aceita strings vazias para campos opcionais (URL e UUID)', () => {
    const env = loadEnv(webEnvSchema, {
      DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
      PHONE_ENC_KEY: key32,
      WA_ID_PEPPER: key32,
      WHATSAPP_APP_SECRET: 'segredo',
      WHATSAPP_VERIFY_TOKEN: 'verifica',
            WHATSAPP_PHONE_NUMBER_ID: '123',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-key',
      SENTRY_DSN: '',
      RESTAURANT_ID: '',
    })
    expect(env.SENTRY_DSN).toBeUndefined()
    expect(env.RESTAURANT_ID).toBeUndefined()
  })

  it('rejeita valores inválidos para campos opcionais', () => {
    const fn = () => loadEnv(webEnvSchema, {
      DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
      PHONE_ENC_KEY: key32,
      WA_ID_PEPPER: key32,
      WHATSAPP_APP_SECRET: 'segredo',
      WHATSAPP_VERIFY_TOKEN: 'verifica',
            WHATSAPP_PHONE_NUMBER_ID: '123',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-key',
      SENTRY_DSN: 'not-a-url',
      RESTAURANT_ID: 'not-a-uuid',
    })
    expect(fn).toThrowError(/SENTRY_DSN/)
  })

  it('web não exige token de envio do WhatsApp; worker exige', () => {
    const web = {
      DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
      PHONE_ENC_KEY: key32,
      WA_ID_PEPPER: key32,
      WHATSAPP_APP_SECRET: 'segredo',
      WHATSAPP_VERIFY_TOKEN: 'verifica',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-key',
    }
    const env = loadEnv(webEnvSchema, { ...web, WHATSAPP_ACCESS_TOKEN: 'nao-deve-vazar' })
    expect(env).not.toHaveProperty('WHATSAPP_ACCESS_TOKEN')
    expect(() =>
      loadEnv(workerEnvSchema, { ...web, OPENROUTER_API_KEY: 'sk-or-x', AI_TRIAGE_MODELS: 'a/m' }),
    ).toThrowError(/WHATSAPP_ACCESS_TOKEN/)
  })

  it('OPENROUTER_DEV_SEM_ZDR: desligado por padrão; "1" liga; outro valor é recusado', () => {
    expect(loadEnv(workerEnvSchema, valida).OPENROUTER_DEV_SEM_ZDR).toBe(false)
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_DEV_SEM_ZDR: '0' }).OPENROUTER_DEV_SEM_ZDR).toBe(false)
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_DEV_SEM_ZDR: '1' }).OPENROUTER_DEV_SEM_ZDR).toBe(true)
    expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_DEV_SEM_ZDR: 'sim' })).toThrow('OPENROUTER_DEV_SEM_ZDR')
  })

  it('OPENROUTER_DEV_SEM_ZDR nunca vale em produção', () => {
    expect(() => loadEnv(workerEnvSchema, { ...valida, NODE_ENV: 'production', OPENROUTER_DEV_SEM_ZDR: '1' })).toThrow('OPENROUTER_DEV_SEM_ZDR')
  })

  it('OPENROUTER_BASE_URL é opcional, vazio é ausente e só aceita host local (é só para teste)', () => {
    expect(loadEnv(workerEnvSchema, valida).OPENROUTER_BASE_URL).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: '' }).OPENROUTER_BASE_URL).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'http://localhost:4010/api/v1' }).OPENROUTER_BASE_URL).toBe('http://localhost:4010/api/v1')
    expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'https://evil.com' })).toThrow('OPENROUTER_BASE_URL')
    expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'http://127.0.0.1.evil.com' })).toThrow('OPENROUTER_BASE_URL')
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'http://127.0.0.1:4010' }).OPENROUTER_BASE_URL).toBe('http://127.0.0.1:4010')
    expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'ftp://x' })).toThrow('OPENROUTER_BASE_URL')
  })

  it('Storage do worker: SUPABASE_URL e chave de serviço obrigatórias; o erro nunca mostra a chave', () => {
    const env = loadEnv(workerEnvSchema, valida)
    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321')
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe(valida.SUPABASE_SERVICE_ROLE_KEY)
    expect(() => loadEnv(workerEnvSchema, { ...valida, SUPABASE_URL: undefined })).toThrow('SUPABASE_URL')
    expect(() => loadEnv(workerEnvSchema, { ...valida, SUPABASE_URL: 'nao-e-url' })).toThrow('SUPABASE_URL')
    const curta = () => loadEnv(workerEnvSchema, { ...valida, SUPABASE_SERVICE_ROLE_KEY: 'SEGREDO-curto' })
    expect(curta).toThrow('SUPABASE_SERVICE_ROLE_KEY')
    expect(curta).not.toThrow(/SEGREDO/)
  })

  it('AI_INGEST_MODELS é opcional (vazio = importação por IA desligada) e vira lista', () => {
    expect(loadEnv(workerEnvSchema, valida).AI_INGEST_MODELS).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...valida, AI_INGEST_MODELS: '' }).AI_INGEST_MODELS).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...valida, AI_INGEST_MODELS: 'g/visao-1, a/visao-2' }).AI_INGEST_MODELS).toEqual(['g/visao-1', 'a/visao-2'])
    expect(() => loadEnv(workerEnvSchema, { ...valida, AI_INGEST_MODELS: ' , ' })).toThrow('AI_INGEST_MODELS')
  })

  it('web nunca recebe a chave de serviço do Storage', () => {
    const env = loadEnv(webEnvSchema, {
      ...valida, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-key',
    })
    expect(env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY')
  })
  describe('provedor de IA (AI_PROVIDER)', () => {
    const semChaves = { ...valida, OPENROUTER_API_KEY: undefined }

    it('.env antigo sem AI_PROVIDER continua OpenRouter e exige OPENROUTER_API_KEY', () => {
      expect(loadEnv(workerEnvSchema, valida).AI_PROVIDER).toBe('openrouter')
      expect(loadEnv(workerEnvSchema, { ...valida, AI_PROVIDER: '' }).AI_PROVIDER).toBe('openrouter')
      expect(() => loadEnv(workerEnvSchema, semChaves)).toThrow('OPENROUTER_API_KEY')
      expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_API_KEY: '' })).toThrow('OPENROUTER_API_KEY')
    })

    it('openai exige OPENAI_API_KEY e não exige a do OpenRouter; o erro nunca mostra a chave', () => {
      const env = loadEnv(workerEnvSchema, { ...semChaves, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-proj-x' })
      expect(env.AI_PROVIDER).toBe('openai')
      expect(env.OPENAI_API_KEY).toBe('sk-proj-x')
      expect(env.OPENROUTER_API_KEY).toBeUndefined()
      expect(() => loadEnv(workerEnvSchema, { ...valida, AI_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY')
      const fn = () => loadEnv(workerEnvSchema, { ...valida, AI_PROVIDER: 'openai', OPENAI_API_KEY: '' })
      expect(fn).toThrow('OPENAI_API_KEY')
      expect(fn).not.toThrow(/sk-or-x/)
    })

    it('provedor desconhecido é recusado', () => {
      expect(() => loadEnv(workerEnvSchema, { ...valida, AI_PROVIDER: 'azure' })).toThrow('AI_PROVIDER')
    })

    it('produção exige AI_PROVIDER=openai (inclusive quando ausente)', () => {
      expect(() => loadEnv(workerEnvSchema, { ...valida, NODE_ENV: 'production' })).toThrow('AI_PROVIDER')
      expect(() => loadEnv(workerEnvSchema, { ...valida, NODE_ENV: 'production', AI_PROVIDER: 'openrouter' })).toThrow('AI_PROVIDER')
      const env = loadEnv(workerEnvSchema, { ...semChaves, NODE_ENV: 'production', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-proj-x' })
      expect(env.AI_PROVIDER).toBe('openai')
    })

    it('OPENAI_BASE_URL é opcional e só aceita host local (servidor falso do e2e)', () => {
      const openai = { ...semChaves, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-proj-x' }
      expect(loadEnv(workerEnvSchema, openai).OPENAI_BASE_URL).toBeUndefined()
      expect(loadEnv(workerEnvSchema, { ...openai, OPENAI_BASE_URL: '' }).OPENAI_BASE_URL).toBeUndefined()
      expect(loadEnv(workerEnvSchema, { ...openai, OPENAI_BASE_URL: 'http://127.0.0.1:4010' }).OPENAI_BASE_URL).toBe('http://127.0.0.1:4010')
      expect(() => loadEnv(workerEnvSchema, { ...openai, OPENAI_BASE_URL: 'https://evil.com/v1' })).toThrow('OPENAI_BASE_URL')
      expect(() => loadEnv(workerEnvSchema, { ...openai, OPENAI_BASE_URL: 'http://localhost.evil.com' })).toThrow('OPENAI_BASE_URL')
    })

    it('iaEnvSchema valida só a IA (smoke test do runbook, antes das variáveis de Storage)', () => {
      const env = loadEnv(iaEnvSchema, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-proj-x', AI_TRIAGE_MODELS: 'gpt-4.1-mini', AI_INGEST_MODELS: 'gpt-4.1-mini,gpt-4.1' })
      expect(env.AI_TRIAGE_MODELS).toEqual(['gpt-4.1-mini'])
      expect(env.AI_INGEST_MODELS).toEqual(['gpt-4.1-mini', 'gpt-4.1'])
      expect(() => loadEnv(iaEnvSchema, { AI_PROVIDER: 'openai', AI_TRIAGE_MODELS: 'gpt-4.1-mini' })).toThrow('OPENAI_API_KEY')
      expect(() => loadEnv(iaEnvSchema, { OPENROUTER_API_KEY: 'k', AI_TRIAGE_MODELS: 'a/b', NODE_ENV: 'production' })).toThrow('AI_PROVIDER')
    })
  })
})
