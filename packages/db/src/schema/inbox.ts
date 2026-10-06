import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { restaurants, timestamps } from './restaurant.ts'

/** Respostas rápidas da equipe (até 30 ativas por restaurante, limite na DAL). */
export const quickReplies = pgTable(
  'quick_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    titulo: text('titulo').notNull(),
    texto: text('texto').notNull(),
    ordem: integer('ordem').notNull().default(0),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('quick_replies_restaurant_ordem_idx').on(t.restaurantId, t.ordem),
    check('quick_replies_titulo_ck', sql`char_length(${t.titulo}) between 1 and 40`),
    check('quick_replies_texto_ck', sql`char_length(${t.texto}) between 1 and 1000`),
  ],
)
