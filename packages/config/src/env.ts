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

const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

// só para teste (servidores falsos do e2e): nunca aponta para fora da máquina
const urlSoLocal = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.url({ protocol: /^https?$/, hostname: /^(127\.0\.0\.1|localhost)$/ }).optional(),
)

/**
 * IA do worker. `AI_PROVIDER`: `openrouter` (padrão; desenvolvimento local, modelos grátis) | `openai` (produção).
 * A chave obrigatória depende do provedor (ver `refinarIa`). Os nomes em `AI_*_MODELS` são os do provedor escolhido.
 */
const iaEnvBase = z.object({
  AI_PROVIDER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['openrouter', 'openai']).default('openrouter')),
  OPENROUTER_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  AI_TRIAGE_MODELS: csvList,
  /** Modelos (csv) que leem PDF/imagem na importação do cardápio; vazio = importação por IA desligada (só CSV). */
  AI_INGEST_MODELS: z.preprocess((v) => (v === '' ? undefined : v), csvList.optional()),
  /** Só para teste (e2e com OpenRouter falso). Em produção fica vazio. */
  OPENROUTER_BASE_URL: urlSoLocal,
  /** Só para teste (e2e com o servidor falso no caminho OpenAI). Em produção fica vazio (padrão https://api.openai.com/v1). */
  OPENAI_BASE_URL: urlSoLocal,
  /**
   * SÓ DESENVOLVIMENTO LOCAL, com dados inventados: "1" deixa de exigir ZDR/data_collection=deny
   * para usar modelos grátis. Nunca em produção (o worker recusa) — remover antes do go-live.
   */
  OPENROUTER_DEV_SEM_ZDR: z.enum(['0', '1']).default('0').transform((v) => v === '1'),
  NODE_ENV: z.string().optional(),
})

export type IaEnv = z.infer<typeof iaEnvBase>

/** Regras entre variáveis da IA (valem para `iaEnvSchema` e `workerEnvSchema`; refinamento não passa por `.extend`). */
function refinarIa(e: IaEnv, ctx: z.RefinementCtx) {
  if (e.AI_PROVIDER === 'openrouter' && !e.OPENROUTER_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['OPENROUTER_API_KEY'], message: 'obrigatória com AI_PROVIDER=openrouter' })
  }
  if (e.AI_PROVIDER === 'openai' && !e.OPENAI_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'obrigatória com AI_PROVIDER=openai' })
  }
  // PRD I8: produção só pela OpenAI (store: false); o OpenRouter fica no desenvolvimento local
  if (e.NODE_ENV === 'production' && e.AI_PROVIDER !== 'openai') {
    ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'produção exige openai' })
  }
  // LGPD (PRD §10): a chave de desenvolvimento sem ZDR nunca vale em produção
  if (e.OPENROUTER_DEV_SEM_ZDR && e.NODE_ENV === 'production') {
    ctx.addIssue({ code: 'custom', path: ['OPENROUTER_DEV_SEM_ZDR'], message: 'proibido em produção' })
  }
}

/** Só a IA, com as regras: smoke test do runbook (roda antes das variáveis de Storage existirem). */
export const iaEnvSchema = iaEnvBase.superRefine(refinarIa)

/** Worker: lê o Storage (bucket privado) por REST com a chave de serviço. Nunca vai para o web/navegador. */
export const storageWorkerEnvSchema = z.object({
  SUPABASE_URL: z.url({ protocol: /^https?$/ }),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
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
  .extend(iaEnvBase.shape)
  .extend(storageWorkerEnvSchema.shape)
  .superRefine(refinarIa)

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
