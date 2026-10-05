import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1, // as specs compartilham o banco e limpam usuários @teste.local
  use: { baseURL: 'http://localhost:3000', locale: 'pt-BR' },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
})
