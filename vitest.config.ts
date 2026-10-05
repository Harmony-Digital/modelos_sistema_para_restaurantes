import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const webAlias = { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: webAlias },
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'apps/web/**/*.test.ts'],
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
          fileParallelism: false,
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
