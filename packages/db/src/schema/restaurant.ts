import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { holidayPolicy, staffRole } from './enums.ts'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const restaurants = pgTable('restaurants', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  personaIa: text('persona_ia').notNull().default(''),
  mensagensPadrao: jsonb('mensagens_padrao').notNull().default(sql`'{}'::jsonb`),
  horarioAtendimentoHumano: jsonb('horario_atendimento_humano').notNull().default(sql`'{}'::jsonb`),
  dpoNome: text('dpo_nome'),
  dpoContato: text('dpo_contato'),
  politicaUrl: text('politica_url'),
  politicaFeriado: holidayPolicy('politica_feriado').notNull().default('como_domingo'),
  ...timestamps,
})

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    slug: text('slug').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    endereco: text('endereco'),
    bairro: text('bairro'),
    cidade: text('cidade'),
    uf: text('uf'),
    cep: text('cep'),
    lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
    lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
    mapsUrl: text('maps_url'),
    telefone: text('telefone'),
    apelidos: text('apelidos').array().notNull().default(sql`'{}'::text[]`),
    ordem: integer('ordem').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('units_restaurant_slug_uq').on(t.restaurantId, t.slug),
    // alvo das FKs compostas (unit_id, restaurant_id): impede misturar unidade de outro restaurante
    uniqueIndex('units_id_restaurant_uq').on(t.id, t.restaurantId),
  ],
)

export const staff = pgTable(
  'staff',
  {
    userId: uuid('user_id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    papel: staffRole('papel').notNull(),
    unidadesPermitidas: uuid('unidades_permitidas').array().notNull().default(sql`'{}'::uuid[]`),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('staff_restaurant_idx').on(t.restaurantId)],
)

export { timestamps }
