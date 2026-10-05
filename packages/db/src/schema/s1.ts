import { sql, type SQL } from 'drizzle-orm'
import {
  boolean, check, customType, date, foreignKey, index, integer, jsonb, pgTable, smallint, text, time, timestamp,
  uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { gapStatus } from './enums.ts'
import { restaurants, timestamps, units } from './restaurant.ts'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const restaurantFk = () =>
  uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' })

export type TurnoJson = { abre: string; fecha: string }

export const unitHours = pgTable(
  'unit_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id').notNull(),
    /** 0 = domingo … 6 = sábado */
    weekday: smallint('weekday').notNull(),
    turno: smallint('turno').notNull(),
    abre: time('abre').notNull(),
    /** fecha < abre ⇒ o turno termina no dia seguinte */
    fecha: time('fecha').notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'unit_hours_unit_fk' })
      .onDelete('cascade'),
    uniqueIndex('unit_hours_unit_dia_turno_uq').on(t.unitId, t.weekday, t.turno),
    check('unit_hours_weekday_range', sql`${t.weekday} between 0 and 6`),
    check('unit_hours_turno_range', sql`${t.turno} between 1 and 6`),
    check('unit_hours_abre_fecha_diff', sql`${t.abre} <> ${t.fecha}`),
  ],
)

export const unitHourExceptions = pgTable(
  'unit_hour_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id').notNull(),
    data: date('data', { mode: 'string' }).notNull(),
    fechado: boolean('fechado').notNull().default(false),
    turnos: jsonb('turnos').$type<TurnoJson[]>().notNull().default(sql`'[]'::jsonb`),
    motivo: text('motivo'),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'unit_hour_exceptions_unit_fk' })
      .onDelete('cascade'),
    uniqueIndex('unit_hour_exceptions_unit_data_uq').on(t.unitId, t.data),
    check('unit_hour_exceptions_turnos_array', sql`jsonb_typeof(${t.turnos}) = 'array'`),
    check('unit_hour_exceptions_fechado_turnos', sql`${t.fechado} = (jsonb_array_length(${t.turnos}) = 0)`),
  ],
)

export const knowledgeFacts = pgTable(
  'knowledge_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    /** null = vale para todas as unidades */
    unitId: uuid('unit_id'),
    tema: text('tema').notNull(),
    exemplos: text('exemplos').array().notNull().default(sql`'{}'::text[]`),
    texto: text('texto').notNull(),
    ativo: boolean('ativo').notNull().default(true),
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`to_tsvector('portuguese'::regconfig, app.f_unaccent(${knowledgeFacts.tema} || ' ' || app.f_juntar(${knowledgeFacts.exemplos}) || ' ' || ${knowledgeFacts.texto}))`,
      ),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'knowledge_facts_unit_fk' })
      .onDelete('cascade'),
    uniqueIndex('knowledge_facts_id_restaurant_uq').on(t.id, t.restaurantId),
    index('knowledge_facts_search_idx').using('gin', t.search),
    index('knowledge_facts_restaurant_ativo_idx').on(t.restaurantId).where(sql`${t.ativo}`),
    check('knowledge_facts_tema_len', sql`char_length(${t.tema}) between 1 and 120`),
    check('knowledge_facts_texto_len', sql`char_length(${t.texto}) between 1 and 1000`),
  ],
)

export const replyTemplates = pgTable(
  'reply_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    chave: text('chave').notNull(),
    texto: text('texto').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reply_templates_restaurant_chave_uq').on(t.restaurantId, t.chave),
    check('reply_templates_texto_len', sql`char_length(${t.texto}) between 1 and 1000`),
  ],
)

export const knowledgeGaps = pgTable(
  'knowledge_gaps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    unitId: uuid('unit_id'),
    chaveNormalizada: text('chave_normalizada').notNull(),
    /** redactPii aplicado; apagado pela retenção (90 dias, Etapa 08) */
    perguntaMascarada: text('pergunta_mascarada'),
    ocorrencias: integer('ocorrencias').notNull().default(1),
    primeiraVez: timestamp('primeira_vez', { withTimezone: true }).notNull().defaultNow(),
    ultimaVez: timestamp('ultima_vez', { withTimezone: true }).notNull().defaultNow(),
    status: gapStatus('status').notNull().default('aberta'),
    // FK composta (fact_id, restaurant_id) vive na migration custom s1_fact_fk:
    // o drizzle não expressa `on delete set null (fact_id)`.
    factId: uuid('fact_id'),
    ...timestamps,
  },
  (t) => [
    foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'knowledge_gaps_unit_fk' })
      .onDelete('cascade'),
    // único "aberta" por (restaurante, chave, unidade) com NULLS NOT DISTINCT: migration 0012 (custom)
    index('knowledge_gaps_fila_idx').on(t.restaurantId, t.status, t.ultimaVez.desc()),
    check('knowledge_gaps_ocorrencias_pos', sql`${t.ocorrencias} >= 1`),
  ],
)
