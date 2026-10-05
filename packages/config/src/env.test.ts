import { describe, expect, it } from 'vitest'
import { loadEnv, secretsEnvSchema, workerEnvSchema, webEnvSchema } from './env.ts'

const key32 = Buffer.alloc(32, 7).toString('base64')

describe('loadEnv', () => {
  it('aceita env válida e aplica defaults', () => {
    const env = loadEnv(workerEnvSchema, {
      DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
      PHONE_ENC_KEY: key32,
      WA_ID_PEPPER: key32,
      WHATSAPP_APP_SECRET: 'segredo',
      WHATSAPP_VERIFY_TOKEN: 'verifica',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      OPENROUTER_API_KEY: 'sk-or-x',
      AI_TRIAGE_MODELS: 'a/modelo-1, b/modelo-2',
    })
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
      WHATSAPP_ACCESS_TOKEN: 'token',
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
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk-key',
      SENTRY_DSN: 'not-a-url',
      RESTAURANT_ID: 'not-a-uuid',
    })
    expect(fn).toThrowError(/SENTRY_DSN/)
  })
})
