CREATE TYPE "public"."knowledge_document_origin" AS ENUM('csv', 'arquivo');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_status" AS ENUM('enviado', 'processando', 'rascunho', 'aprovado', 'rejeitado', 'erro');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_target" AS ENUM('cardapio');--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"alvo" "knowledge_document_target" DEFAULT 'cardapio' NOT NULL,
	"origem" "knowledge_document_origin" NOT NULL,
	"status" "knowledge_document_status" NOT NULL,
	"storage_path" text,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"sha256" text NOT NULL,
	"draft" jsonb,
	"erro" text,
	"enviado_por" uuid,
	"revisado_por" uuid,
	"revisado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_documents_storage_ck" CHECK (("knowledge_documents"."origem" = 'csv' and "knowledge_documents"."storage_path" is null) or ("knowledge_documents"."origem" = 'arquivo' and "knowledge_documents"."storage_path" ~ '^importacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$')),
	CONSTRAINT "knowledge_documents_tamanho_ck" CHECK ("knowledge_documents"."tamanho" between 1 and 20971520),
	CONSTRAINT "knowledge_documents_sha256_ck" CHECK ("knowledge_documents"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_documents_erro_ck" CHECK ("knowledge_documents"."erro" is null or char_length("knowledge_documents"."erro") <= 300)
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_categories_nome_ck" CHECK (char_length("menu_categories"."nome") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "menu_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid,
	"titulo" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"sha256" text NOT NULL,
	"wa_media_id" text,
	"wa_media_expires_at" timestamp with time zone,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_files_titulo_ck" CHECK (char_length("menu_files"."titulo") between 1 and 120),
	CONSTRAINT "menu_files_storage_path_ck" CHECK ("menu_files"."storage_path" ~ '^(cardapio|importacoes)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'),
	CONSTRAINT "menu_files_mime_ck" CHECK ("menu_files"."mime" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "menu_files_tamanho_ck" CHECK ("menu_files"."tamanho" between 1 and 20971520),
	CONSTRAINT "menu_files_sha256_ck" CHECK ("menu_files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "menu_item_units" (
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"disponivel" boolean,
	"preco_override_centavos" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_item_units_pk" PRIMARY KEY("item_id","unit_id"),
	CONSTRAINT "menu_item_units_preco_ck" CHECK ("menu_item_units"."preco_override_centavos" is null or "menu_item_units"."preco_override_centavos" between 0 and 10000000)
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"preco_centavos" integer,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"outros_nomes" text[] DEFAULT '{}'::text[] NOT NULL,
	"disponivel" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('portuguese'::regconfig, app.f_unaccent("menu_items"."nome")), 'A') || setweight(to_tsvector('portuguese'::regconfig, app.f_unaccent(coalesce("menu_items"."descricao", '') || ' ' || app.f_juntar("menu_items"."outros_nomes") || ' ' || app.f_juntar("menu_items"."tags"))), 'B')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_items_nome_ck" CHECK (char_length("menu_items"."nome") between 1 and 80),
	CONSTRAINT "menu_items_descricao_ck" CHECK ("menu_items"."descricao" is null or char_length("menu_items"."descricao") <= 300),
	CONSTRAINT "menu_items_preco_ck" CHECK ("menu_items"."preco_centavos" is null or "menu_items"."preco_centavos" between 0 and 10000000),
	CONSTRAINT "menu_items_listas_ck" CHECK (cardinality("menu_items"."tags") <= 10 and cardinality("menu_items"."outros_nomes") <= 10)
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_enviado_por_users_id_fk" FOREIGN KEY ("enviado_por") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_revisado_por_users_id_fk" FOREIGN KEY ("revisado_por") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_files" ADD CONSTRAINT "menu_files_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_files" ADD CONSTRAINT "menu_files_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_units" ADD CONSTRAINT "menu_item_units_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_units" ADD CONSTRAINT "menu_item_units_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_documents_restaurant_idx" ON "knowledge_documents" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_categories_id_restaurant_uq" ON "menu_categories" USING btree ("id","restaurant_id");--> statement-breakpoint
CREATE INDEX "menu_categories_restaurant_idx" ON "menu_categories" USING btree ("restaurant_id","ordem");--> statement-breakpoint
CREATE INDEX "menu_files_envio_idx" ON "menu_files" USING btree ("restaurant_id","unit_id") WHERE "menu_files"."ativo";--> statement-breakpoint
CREATE INDEX "menu_item_units_unit_idx" ON "menu_item_units" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "menu_item_units_restaurant_idx" ON "menu_item_units" USING btree ("restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_items_id_restaurant_uq" ON "menu_items" USING btree ("id","restaurant_id");--> statement-breakpoint
CREATE INDEX "menu_items_search_idx" ON "menu_items" USING gin ("search");--> statement-breakpoint
CREATE INDEX "menu_items_category_idx" ON "menu_items" USING btree ("category_id","ordem");--> statement-breakpoint
CREATE INDEX "menu_items_restaurant_idx" ON "menu_items" USING btree ("restaurant_id");