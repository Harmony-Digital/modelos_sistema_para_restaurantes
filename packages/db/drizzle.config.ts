import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' },
  schemaFilter: ['public'],
  entities: { roles: { provider: 'supabase' } },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  strict: true,
  verbose: true,
})
