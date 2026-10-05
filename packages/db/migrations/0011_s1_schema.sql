CREATE TYPE "public"."gap_status" AS ENUM('aberta', 'respondida', 'ignorada');--> statement-breakpoint
CREATE TYPE "public"."holiday_policy" AS ENUM('normal', 'fechado', 'como_domingo');--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'localizacao';--> statement-breakpoint
ALTER TYPE "public"."message_type" ADD VALUE 'lista';--> statement-breakpoint
CREATE TABLE "knowledge_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid,
	"tema" text NOT NULL,
	"exemplos" text[] DEFAULT '{}'::text[] NOT NULL,
	"texto" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese'::regconfig, app.f_unaccent("knowledge_facts"."tema" || ' ' || app.f_juntar("knowledge_facts"."exemplos") || ' ' || "knowledge_facts"."texto"))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_facts_tema_len" CHECK (char_length("knowledge_facts"."tema") between 1 and 120),
	CONSTRAINT "knowledge_facts_texto_len" CHECK (char_length("knowledge_facts"."texto") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "knowledge_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid,
	"chave_normalizada" text NOT NULL,
	"pergunta_mascarada" text,
	"ocorrencias" integer DEFAULT 1 NOT NULL,
	"primeira_vez" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_vez" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "gap_status" DEFAULT 'aberta' NOT NULL,
	"fact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_gaps_ocorrencias_pos" CHECK ("knowledge_gaps"."ocorrencias" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"texto" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_templates_texto_len" CHECK (char_length("reply_templates"."texto") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "unit_hour_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"data" date NOT NULL,
	"fechado" boolean DEFAULT false NOT NULL,
	"turnos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"motivo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_hour_exceptions_turnos_array" CHECK (jsonb_typeof("unit_hour_exceptions"."turnos") = 'array'),
	CONSTRAINT "unit_hour_exceptions_fechado_turnos" CHECK ("unit_hour_exceptions"."fechado" = (jsonb_array_length("unit_hour_exceptions"."turnos") = 0))
);
--> statement-breakpoint
CREATE TABLE "unit_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"turno" smallint NOT NULL,
	"abre" time NOT NULL,
	"fecha" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_hours_weekday_range" CHECK ("unit_hours"."weekday" between 0 and 6),
	CONSTRAINT "unit_hours_turno_range" CHECK ("unit_hours"."turno" between 1 and 6),
	CONSTRAINT "unit_hours_abre_fecha_diff" CHECK ("unit_hours"."abre" <> "unit_hours"."fecha")
);
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "politica_feriado" "holiday_policy" DEFAULT 'como_domingo' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "endereco" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "bairro" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "cidade" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "uf" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "cep" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "lat" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "lng" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "maps_url" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "telefone" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "apelidos" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "ordem" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pendente" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "simulada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "simulado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "simulado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "itens_validos" smallint;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "itens_respondidos" smallint;--> statement-breakpoint
CREATE UNIQUE INDEX "units_id_restaurant_uq" ON "units" USING btree ("id","restaurant_id");--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_facts" ADD CONSTRAINT "knowledge_facts_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_fact_id_knowledge_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."knowledge_facts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hour_exceptions" ADD CONSTRAINT "unit_hour_exceptions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hour_exceptions" ADD CONSTRAINT "unit_hour_exceptions_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hours" ADD CONSTRAINT "unit_hours_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_hours" ADD CONSTRAINT "unit_hours_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_facts_search_idx" ON "knowledge_facts" USING gin ("search");--> statement-breakpoint
CREATE INDEX "knowledge_facts_restaurant_ativo_idx" ON "knowledge_facts" USING btree ("restaurant_id") WHERE "knowledge_facts"."ativo";--> statement-breakpoint
CREATE INDEX "knowledge_gaps_fila_idx" ON "knowledge_gaps" USING btree ("restaurant_id","status","ultima_vez" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_restaurant_chave_uq" ON "reply_templates" USING btree ("restaurant_id","chave");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_hour_exceptions_unit_data_uq" ON "unit_hour_exceptions" USING btree ("unit_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_hours_unit_dia_turno_uq" ON "unit_hours" USING btree ("unit_id","weekday","turno");
