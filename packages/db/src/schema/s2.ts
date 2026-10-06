import { sql } from 'drizzle-orm'
import {
  boolean, check, date, foreignKey, index, pgEnum, pgTable, smallint, text, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { customers } from './conversation.ts'
import { restaurants, timestamps, units } from './restaurant.ts'

const restaurantFk = () =>
  uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' })

export const attendanceStatus = pgEnum('attendance_status', ['ativo', 'cancelado'])
export const attendanceOrigin = pgEnum('attendance_origin', ['ia', 'painel'])

export const attendanceNotices = pgTable(
  'attendance_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id').notNull(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    nome: text('nome'),
    data: date('data', { mode: 'string' }).notNull(),
    pessoas: smallint('pessoas').notNull(),
    horarioAprox: text('horario_aprox'),
    status: attendanceStatus('status').notNull().default('ativo'),
    origem: attendanceOrigin('origem').notNull(),
    simulado: boolean('simulado').notNull().default(false),
    anonimizado: boolean('anonimizado').notNull().default(false),
    criadoPor: uuid('criado_por').references(() => authUsers.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'attendance_notices_unit_fk' })
      .onDelete('cascade'),
    check('attendance_pessoas_ck', sql`${t.pessoas} between 1 and 60`),
    check('attendance_horario_ck', sql`${t.horarioAprox} is null or char_length(${t.horarioAprox}) <= 40`),
    uniqueIndex('attendance_ativo_uq').on(t.customerId, t.unitId, t.data).where(sql`status = 'ativo'`),
    index('attendance_previsao_idx').on(t.restaurantId, t.unitId, t.data),
  ],
)
