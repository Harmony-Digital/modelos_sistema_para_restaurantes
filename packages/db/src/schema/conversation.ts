import { sql } from 'drizzle-orm'
import {
  bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { conversationState, handoffMotivo, messageAuthor, messageDirection, messageType } from './enums.ts'
import { restaurants, timestamps, units } from './restaurant.ts'

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    waIdHash: text('wa_id_hash').notNull(),
    telefoneCifrado: text('telefone_cifrado').notNull(),
    nomePerfil: text('nome_perfil'),
    unidadePreferidaId: uuid('unidade_preferida_id').references(() => units.id, { onDelete: 'set null' }),
    privacyNoticeSentAt: timestamp('privacy_notice_sent_at', { withTimezone: true }),
    ultimaInteracaoAt: timestamp('ultima_interacao_at', { withTimezone: true }).notNull().defaultNow(),
    bloqueadoAte: timestamp('bloqueado_ate', { withTimezone: true }),
    simulado: boolean('simulado').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customers_restaurant_wa_id_hash_uq').on(t.restaurantId, t.waIdHash),
    index('customers_ultima_interacao_idx').on(t.ultimaInteracaoAt),
    // simulador: "conversa aberta do usuário" varre só os clientes simulados do restaurante
    index('customers_simulado_idx').on(t.restaurantId, t.createdAt.desc()).where(sql`simulado`),
  ],
)

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    estado: conversationState('estado').notNull().default('ia'),
    atendenteId: uuid('atendente_id').references(() => authUsers.id, { onDelete: 'set null' }),
    unidadeContextoId: uuid('unidade_contexto_id').references(() => units.id, { onDelete: 'set null' }),
    resumo: text('resumo'),
    falhasConsecutivas: integer('falhas_consecutivas').notNull().default(0),
    processedUpToId: bigint('processed_up_to_id', { mode: 'number' }).notNull().default(0),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** Itens à espera da escolha de unidade pela lista: { itens, opcoes, expiraEm }. Só o worker escreve. */
    pendente: jsonb('pendente'),
    simulada: boolean('simulada').notNull().default(false),
    /** Só em conversa simulada: deslocamento do relógio (segundos) usado na resolução de S1. Nulo = relógio real. */
    relogioOffsetSegundos: integer('relogio_offset_segundos'),
    /** Por que a conversa foi para humano (sem texto livre). */
    handoffMotivo: handoffMotivo('handoff_motivo'),
    /** Entrada em `aguardando_humano`; o trigger da 0030 preenche ao entrar e zera ao sair. */
    aguardandoDesde: timestamp('aguardando_desde', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('conversations_one_open_per_customer_uq').on(t.customerId).where(sql`estado <> 'encerrada'`),
    index('conversations_inbox_idx')
      .on(t.restaurantId, t.estado, t.lastMessageAt.desc())
      .where(sql`estado <> 'encerrada'`),
    // inbox: aba Aguardando pela espera mais antiga
    index('conversations_aguardando_idx').on(t.restaurantId, t.estado, t.aguardandoDesde),
    // inbox: filtro por unidade, última mensagem primeiro
    index('conversations_unidade_idx').on(t.restaurantId, t.unidadeContextoId, t.lastMessageAt.desc()),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    direcao: messageDirection('direcao').notNull(),
    autor: messageAuthor('autor').notNull(),
    wamid: text('wamid'),
    tipo: messageType('tipo').notNull(),
    texto: text('texto'),
    transcrito: boolean('transcrito').notNull().default(false),
    midiaRef: jsonb('midia_ref'),
    payload: jsonb('payload'),
    statusEnvio: text('status_envio'),
    replyKey: text('reply_key'),
    aiRunId: bigint('ai_run_id', { mode: 'number' }),
    /** Quem escreveu a mensagem humana (autor `humano`). */
    atendenteId: uuid('atendente_id').references(() => authUsers.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_wamid_uq').on(t.wamid),
    // cobre "pendentes desta conversa" (id > processed_up_to_id) e "últimas N" (order by id desc)
    index('messages_conversation_id_idx').on(t.conversationId, t.id),
    // retenção diária: mensagens vencidas do restaurante, em lotes
    index('messages_restaurant_created_idx').on(t.restaurantId, t.createdAt),
  ],
)
