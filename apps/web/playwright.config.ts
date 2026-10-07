import { defineConfig, devices } from '@playwright/test'

// Porta do servidor de teste: E2E_PORT (padrão 3000), para rodar ao lado de outro `pnpm dev`.
const porta = Number(process.env.E2E_PORT ?? 3000)
const base = `http://localhost:${porta}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1, // as specs compartilham o banco e limpam usuários @teste.local
  use: { baseURL: base, locale: 'pt-BR' },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
  webServer: { command: `PORT=${porta} pnpm dev`, url: `${base}/login`, reuseExistingServer: true, timeout: 120_000 },
})
