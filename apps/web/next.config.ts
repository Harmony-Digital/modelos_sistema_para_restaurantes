import type { NextConfig } from 'next'
import { REDIRECIONAMENTOS } from './lib/redirecionamentos.ts'

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const config: NextConfig = {
  transpilePackages: ['@atd/config', '@atd/core', '@atd/db', '@atd/whatsapp'],
  serverExternalPackages: ['pg-boss'],
  poweredByHeader: false,
  devIndicators: false, // o selo do dev cobre o 1º item da navegação inferior no celular (e intercepta cliques do E2E)
  agentRules: false,
  // upload de cardápio/importação (20 MB + campos do formulário): o padrão das Server Actions é 1 MB e o proxy.ts
  // (que cobre /conteudo) corta o corpo em 10 MB — os dois limites precisam subir juntos
  experimental: { serverActions: { bodySizeLimit: '21mb' }, proxyClientMaxBodySize: '21mb' },
  // endereços antigos (/mais/*) seguem funcionando: links salvos e favoritos levam à tela nova
  async redirects() {
    return [...REDIRECIONAMENTOS]
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default config
