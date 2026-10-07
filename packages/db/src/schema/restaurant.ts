import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { authUsers } from 'drizzle-orm/supabase'
import { holidayPolicy, inviteStatus, staffRole } from './enums.ts'

/** Texto padrão das regras enviadas depois de confirmar uma reserva (spec 2026-10-07 §2). */
export const REGRAS_RESERVA_PADRAO =
  'Sua reserva está confirmada! Guardamos o lugar por até 15 minutos após o horário marcado; depois disso, o espaço pode ser liberado para outros clientes. Se precisar cancelar ou mudar o número de pessoas, é só avisar por aqui.'
export const REGRAS_RESERVA_MAX = 600

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
  /** Cotação US$ → R$ só para exibição (o dinheiro fica em USD). Editável pelo dono. */
  cotacaoUsdBrl: numeric('cotacao_usd_brl', { precision: 10, scale: 4, mode: 'string' }).notNull().default('5.5'),
  /** Modo demonstração: o painel mostra os dados do simulador como se fossem reais, com o selo "Simulação". Só o dono muda. */
  modoDemonstracao: boolean('modo_demonstracao').notNull().default(false),
  /** Regras enviadas ao cliente depois de confirmar a reserva. Dono e gerente editam. */
  regrasReserva: text('regras_reserva').notNull().default(REGRAS_RESERVA_PADRAO),
  /** Logo no bucket público `marca`: `<restaurant_id>/logo-<sha256>.<ext>`. Nulo = sem logo. */
  logoPath: text('logo_path'),
  ...timestamps,
}, (t) => [
  check('restaurants_cotacao_ck', sql`${t.cotacaoUsdBrl} between 0.5 and 50`),
  check('restaurants_regras_reserva_ck', sql`char_length(${t.regrasReserva}) between 1 and 600`),
  check('restaurants_logo_path_ck', sql`${t.logoPath} is null or ${t.logoPath} ~ ('^' || ${t.id}::text || '/logo-[0-9a-f]{64}[.](png|jpg|webp)$')`),
])

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
    /** Lotação máxima de pessoas por dia (reservas `confirmada`). Nulo = sem controle de lotação. */
    capacidadePessoas: smallint('capacidade_pessoas'),
    ...timestamps,
  },
  (t) => [
    check('units_capacidade_ck', sql`${t.capacidadePessoas} is null or ${t.capacidadePessoas} between 1 and 5000`),
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

/**
 * Convite de equipe (Etapa 08): o dono cria pelo painel; o worker chama o convite do Supabase Auth (chave de serviço
 * só no worker) e cria o `staff`. E-mail é PII: nunca em log nem no `diff` da auditoria. `unidades` vazio = todas.
 */
export const staffInvites = pgTable(
  'staff_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: uuid('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    nome: text('nome').notNull(),
    papel: staffRole('papel').notNull(),
    unidades: uuid('unidades').array().notNull().default(sql`'{}'::uuid[]`),
    status: inviteStatus('status').notNull().default('pendente'),
    /** Código do erro (sem PII), p.ex. `email_existente`. */
    erro: text('erro'),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => authUsers.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    // um convite em aberto por e-mail no restaurante
    uniqueIndex('staff_invites_email_uq').on(t.restaurantId, sql`lower(${t.email})`).where(sql`status <> 'aceito'`),
    index('staff_invites_restaurant_idx').on(t.restaurantId, t.createdAt.desc()),
    check('staff_invites_papel_ck', sql`${t.papel} <> 'dono'`),
    check('staff_invites_email_ck', sql`char_length(${t.email}) between 3 and 254 and position('@' in ${t.email}) > 1`),
    check('staff_invites_nome_ck', sql`char_length(${t.nome}) between 1 and 80`),
    check('staff_invites_erro_ck', sql`${t.erro} is null or char_length(${t.erro}) <= 60`),
  ],
)

export { timestamps }
