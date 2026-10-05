import 'server-only'
import { keyFromBase64 } from '@atd/core'
import { loadEnv, webEnvSchema } from '@atd/config'

let cached: ReturnType<typeof build> | undefined

function build() {
  const e = loadEnv(webEnvSchema)
  return { ...e, phoneKey: keyFromBase64(e.PHONE_ENC_KEY), pepper: keyFromBase64(e.WA_ID_PEPPER) }
}

/** Preguiçoso: o `next build` não precisa das variáveis. */
export function env() {
  cached ??= build()
  return cached
}
