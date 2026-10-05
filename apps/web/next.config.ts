import type { NextConfig } from 'next'

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
  agentRules: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default config
