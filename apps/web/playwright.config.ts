import { defineConfig, devices } from '@playwright/test'

// Porta do servidor de teste: E2E_PORT (padrão 3000), para rodar ao lado de outro `pnpm dev`.
const porta = Number(process.env.E2E_PORT ?? 3000)
const base = `http://localhost:${porta}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  workers: 1, // as specs compartilham o banco e limpam usuários @teste.local
  // modo demonstração desligado durante a suíte e restaurado ao estado inicial no fim
  globalSetup: './e2e/estado-inicial.ts',
  use: { baseURL: base, locale: 'pt-BR' },
  projects: [
    // celular: todas as specs da raiz; desktop: as specs de e2e/desktop (menu lateral, lista + detalhe, flutuante)
    { name: 'celular', testIgnore: 'desktop/**', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', testMatch: 'desktop/**/*.spec.ts', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: `PORT=${porta} pnpm dev`, url: `${base}/login`, reuseExistingServer: true, timeout: 120_000 },
})
