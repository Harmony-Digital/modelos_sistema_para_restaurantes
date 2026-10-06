import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const webAlias = { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) }

export default defineConfig({
  test: {
    // Transformações persistidas em node_modules/.vitest-cache entre rodadas.
    fsModuleCache: true,
    projects: [
      {
        plugins: [react()],
        resolve: { alias: webAlias },
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts', 'packages/ai/evals/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'apps/web/**/*.test.ts'],
          exclude: ['**/*.db.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/**/src/**/*.db.test.ts', 'apps/**/src/**/*.db.test.ts', 'apps/web/**/*.db.test.ts'],
          exclude: ['**/node_modules/**'],
          environment: 'node',
          // Um banco por processo (atd_test_<VITEST_POOL_ID>), clonado no global setup.
          globalSetup: ['packages/db/test/global-setup.ts'],
          fileParallelism: true,
          maxWorkers: Number(process.env.ATD_DB_WORKERS ?? 4),
          // maxWorkers próprio exige grupo próprio: roda depois de unit/ui (VITEST_POOL_ID fica em 1..maxWorkers).
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias: webAlias },
        test: {
          name: 'ui',
          include: ['apps/web/**/*.test.tsx'],
          exclude: ['**/node_modules/**'],
          environment: 'jsdom',
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
    ],
  },
})
