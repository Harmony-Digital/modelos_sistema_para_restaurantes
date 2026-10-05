import { sql } from 'drizzle-orm'
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import {
  actorType, aiStage, budgetAction, budgetPeriod, budgetScope, dsrStatus, dsrType, ledgerKind, retentionAction,
} from './enums.ts'
import { conversations, customers } from './conversation.ts'
import { restaurants, timestamps } from './restaurant.ts'

const usd = (name: string) => numeric(name, { precision: 12, scale: 6, mode: 'string' })
const restaurantFk = () =>
  uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' })

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    restaurantId: restaurantFk(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    etapa: aiStage('etapa').notNull(),
    modelo: text('modelo').notNull(),
    promptVersion: text('prompt_version').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tokensCache: integer('tokens_cache').notNull().default(0),
    audioSegundos: numeric('audio_segundos', { precision: 8, scale: 2, mode: 'string' }),
    costUsd: usd('cost_usd').notNull().default('0'),
    latenciaMs: integer('latencia_ms'),
    intent: text('intent'),
    resultado: text('resultado'),
    erro: text('erro'),
    simulado: boolean('simulado').notNull().default(false),
    /** Itens de S1 pedidos / respondidos com dado (indicador "% respondido pela IA"). */
    itensValidos: smallint('itens_validos'),
    itensRespondidos: smallint('itens_respondidos'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_runs_created_brin').using('brin', t.createdAt),
    index('ai_runs_conversation_idx').on(t.conversationId),
    index('ai_runs_restaurant_created_idx').on(t.restaurantId, t.createdAt.desc()),
  ],
)

export const budgetLimits = pgTable(
  'budget_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    escopo: budgetScope('escopo').notNull(),
    periodo: budgetPeriod('periodo').notNull(),
    limiteUsd: usd('limite_usd').notNull(),
    alertaPct: integer('alerta_pct').notNull().default(80),
    acao: budgetAction('acao').notNull().default('modo_economico'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('budget_limits_scope_period_uq').on(t.restaurantId, t.escopo, t.periodo),
    check('budget_limits_limite_positive', sql`${t.limiteUsd} > 0`),
    check('budget_limits_alerta_range', sql`${t.alertaPct} between 1 and 100`),
  ],
)

export const budgetCounters = pgTable(
  'budget_counters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    escopo: budgetScope('escopo').notNull(),
    periodo: budgetPeriod('periodo').notNull(),
    inicioPeriodo: date('inicio_periodo', { mode: 'string' }).notNull(),
    reservado: usd('reservado').notNull().default('0'),
    gasto: usd('gasto').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('budget_counters_period_uq').on(t.restaurantId, t.escopo, t.periodo, t.inicioPeriodo),
    check('budget_counters_non_negative', sql`${t.reservado} >= 0 and ${t.gasto} >= 0`),
  ],
)

export const spendLedger = pgTable(
  'spend_ledger',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    restaurantId: restaurantFk(),
    escopo: budgetScope('escopo').notNull(),
    tipo: ledgerKind('tipo').notNull(),
    valorUsd: usd('valor_usd').notNull(),
    ref: text('ref'),
    reservaId: bigint('reserva_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('spend_ledger_created_brin').using('brin', t.createdAt),
    uniqueIndex('spend_ledger_reserva_settled_uq')
      .on(t.reservaId)
      .where(sql`${t.tipo} in ('liquidacao','estorno')`),
    check('spend_ledger_valor_non_negative', sql`${t.valorUsd} >= 0`),
  ],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    restaurantId: uuid('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    atorId: uuid('ator_id'),
    atorTipo: actorType('ator_tipo').notNull(),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: text('entidade_id'),
    diff: jsonb('diff'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_restaurant_created_idx').on(t.restaurantId, t.createdAt.desc())],
)

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: restaurantFk(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    tipo: dsrType('tipo').notNull(),
    status: dsrStatus('status').notNull().default('aberto'),
    prazo: timestamp('prazo', { withTimezone: true }).notNull().default(sql`now() + interval '15 days'`),
    resolvidoPor: uuid('resolvido_por'),
    resposta: text('resposta'),
    ...timestamps,
  },
  (t) => [index('dsr_status_prazo_idx').on(t.status, t.prazo)],
)

export const retentionSettings = pgTable(
  'retention_settings',
  {
    restaurantId: restaurantFk(),
    dado: text('dado').notNull(),
    dias: integer('dias').notNull(),
    acao: retentionAction('acao').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.restaurantId, t.dado] }), check('retention_dias_positive', sql`${t.dias} >= 0`)],
)

// Tabela de infraestrutura (sem dado de negócio): sem restaurant_id, mas com RLS (Task 7).
export const workerHeartbeats = pgTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  versao: text('versao').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})
