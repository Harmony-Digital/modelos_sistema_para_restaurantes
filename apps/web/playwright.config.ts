import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', locale: 'pt-BR' },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
})
