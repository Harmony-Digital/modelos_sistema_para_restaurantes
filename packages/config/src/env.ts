import { z } from 'zod'

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'precisa ter 32 bytes em base64')

const csvList = z
  .string()
  .min(1)
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.string().min(1)).min(1))

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional())

const optionalUuid = z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional())

export const dbEnvSchema = z.object({
  DATABASE_URL: z.url(),
})

export const secretsEnvSchema = z.object({
  PHONE_ENC_KEY: base64Key32,
  WA_ID_PEPPER: base64Key32,
})

/** Webhook (web): validar assinatura, desafio e o número de destino. Não envia mensagens. */
export const whatsappWebhookEnvSchema = z.object({
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
})

/** Worker: tudo do webhook + o que é preciso para enviar pela Graph API. */
export const whatsappEnvSchema = whatsappWebhookEnvSchema.extend({
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v24.0'),
})

export const openrouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  AI_TRIAGE_MODELS: csvList,
  /** Só para teste (e2e com OpenRouter falso). Em produção fica vazio. */
  // só para teste (OpenRouter falso do e2e): nunca aponta para fora da máquina
  OPENROUTER_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url({ protocol: /^https?$/, hostname: /^(127\.0\.0\.1|localhost)$/ }).optional(),
  ),
  /**
   * SÓ DESENVOLVIMENTO LOCAL, com dados inventados: "1" deixa de exigir ZDR/data_collection=deny
   * para usar modelos grátis. Nunca em produção (o worker recusa) — remover antes do go-live.
   */
  OPENROUTER_DEV_SEM_ZDR: z.enum(['0', '1']).default('0').transform((v) => v === '1'),
})

/** Worker: lê o Storage (bucket privado) por REST com a chave de serviço. Nunca vai para o web/navegador. */
export const storageWorkerEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** Modelos (csv) que leem PDF/imagem na importação do cardápio; vazio = importação por IA desligada (só CSV). */
  AI_INGEST_MODELS: z.preprocess((v) => (v === '' ? undefined : v), csvList.optional()),
})

const common = z.object({
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SENTRY_DSN: optionalUrl,
  RESTAURANT_ID: optionalUuid,
})

export const webEnvSchema = common
  .extend(dbEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend(whatsappWebhookEnvSchema.shape)
  .extend({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  })

export const workerEnvSchema = common
  .extend(dbEnvSchema.shape)
  .extend(secretsEnvSchema.shape)
  .extend(whatsappEnvSchema.shape)
  .extend(openrouterEnvSchema.shape)
  .extend(storageWorkerEnvSchema.shape)
  .extend({ NODE_ENV: z.string().optional() })
  .superRefine((e, ctx) => {
    // LGPD (PRD §10): em produção toda chamada exige data_collection=deny + zdr
    if (e.OPENROUTER_DEV_SEM_ZDR && e.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['OPENROUTER_DEV_SEM_ZDR'], message: 'proibido em produção' })
    }
  })

export function loadEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source)
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? '?')))]
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${names.join(', ')}`)
  }
  return result.data
}
