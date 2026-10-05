import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'apps/web/lib/**/*.test.ts'],
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
    ],
  },
})
