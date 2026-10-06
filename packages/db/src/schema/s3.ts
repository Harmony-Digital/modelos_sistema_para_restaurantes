import { sql } from 'drizzle-orm'
import {
  boolean, check, date, foreignKey, index, pgEnum, pgTable, smallint, text, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { customers } from './conversation.ts'
import { restaurants, timestamps, units } from './restaurant.ts'

const restaurantFk = () =>
  uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' })

export const TIPOS_EVENTO = ['aniversario', 'casamento', 'corporativo', 'confraternizacao', 'outro'] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]
export const eventType = pgEnum('event_type', TIPOS_EVENTO)
export const eventStatus = pgEnum('event_status', ['novo', 'em_contato', 'confirmado', 'recusado', 'cancelado'])

export const eventSpaces = pgTable(
  'event_spaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id').notNull(),
    nome: text('nome').notNull(),
    capacidadeMin: smallint('capacidade_min').notNull(),
    capacidadeMax: smallint('capacidade_max').notNull(),
    descricao: text('descricao'),
    condicoes: text('condicoes'),
    ativo: boolean('ativo').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'event_spaces_unit_fk' })
      .onDelete('cascade'),
    check('event_spaces_capacidade_ck', sql`1 <= ${t.capacidadeMin} and ${t.capacidadeMin} <= ${t.capacidadeMax} and ${t.capacidadeMax} <= 1000`),
    uniqueIndex('event_spaces_unit_nome_uq').on(t.unitId, t.nome),
    index('event_spaces_restaurant_unit_idx').on(t.restaurantId, t.unitId),
  ],
)

export const eventRequests = pgTable(
  'event_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id').notNull(),
    spaceId: uuid('space_id').references(() => eventSpaces.id, { onDelete: 'set null' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    nome: text('nome'),
    data: date('data', { mode: 'string' }).notNull(),
    convidados: smallint('convidados').notNull(),
    tipo: eventType('tipo').notNull(),
    tipoTexto: text('tipo_texto'),
    observacoes: text('observacoes'),
    status: eventStatus('status').notNull().default('novo'),
    responsavelId: uuid('responsavel_id').references(() => authUsers.id, { onDelete: 'set null' }),
    notasInternas: text('notas_internas'),
    simulado: boolean('simulado').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'event_requests_unit_fk' })
      .onDelete('cascade'),
    check('event_requests_convidados_ck', sql`${t.convidados} between 1 and 1000`),
    check('event_requests_tipo_texto_ck', sql`${t.tipoTexto} is null or char_length(${t.tipoTexto}) <= 60`),
    check('event_requests_observacoes_ck', sql`${t.observacoes} is null or char_length(${t.observacoes}) <= 300`),
    check('event_requests_notas_ck', sql`${t.notasInternas} is null or char_length(${t.notasInternas}) <= 2000`),
    index('event_requests_fila_idx').on(t.restaurantId, t.status, t.data),
    index('event_requests_unidade_idx').on(t.restaurantId, t.unitId, t.data),
  ],
)
