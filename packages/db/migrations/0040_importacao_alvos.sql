CREATE TYPE "public"."knowledge_document_mode" AS ENUM('completo', 'so_precos');--> statement-breakpoint
-- (manual) Alvos novos sem `ALTER TYPE ... ADD VALUE` (mesmo motivo da 0033: o migrator roda todas as migrations
-- pendentes numa transação só e valor novo de enum não pode ser usado antes do commit). Recriar o tipo deixa os valores
-- usáveis já aqui. Mesmo resultado do ADD VALUE gerado: ('cardapio', 'informacoes', 'horarios', 'espacos').
CREATE TYPE "public"."knowledge_document_target_v2" AS ENUM('cardapio', 'informacoes', 'horarios', 'espacos');--> statement-breakpoint
ALTER TABLE "public"."knowledge_documents" ALTER COLUMN "alvo" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."knowledge_documents" ALTER COLUMN "alvo" SET DATA TYPE "public"."knowledge_document_target_v2" USING "alvo"::text::"public"."knowledge_document_target_v2";--> statement-breakpoint
DROP TYPE "public"."knowledge_document_target";--> statement-breakpoint
ALTER TYPE "public"."knowledge_document_target_v2" RENAME TO "knowledge_document_target";--> statement-breakpoint
ALTER TABLE "public"."knowledge_documents" ALTER COLUMN "alvo" SET DEFAULT 'cardapio';--> statement-breakpoint
CREATE TABLE "knowledge_document_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"importacao_id" uuid NOT NULL,
	"ordem" smallint NOT NULL,
	"storage_path" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"sha256" text NOT NULL,
	"paginas" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_document_files_ordem_ck" CHECK ("knowledge_document_files"."ordem" between 1 and 10),
	CONSTRAINT "knowledge_document_files_storage_ck" CHECK ("knowledge_document_files"."storage_path" ~ '^importacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'),
	CONSTRAINT "knowledge_document_files_mime_ck" CHECK ("knowledge_document_files"."mime" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "knowledge_document_files_tamanho_ck" CHECK ("knowledge_document_files"."tamanho" between 1 and 20971520),
	CONSTRAINT "knowledge_document_files_sha256_ck" CHECK ("knowledge_document_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "knowledge_document_files_paginas_ck" CHECK ("knowledge_document_files"."paginas" is null or "knowledge_document_files"."paginas" between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_storage_ck";--> statement-breakpoint
DROP INDEX "knowledge_documents_arquivo_sha256_uq";--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "mime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "tamanho" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "modo" "knowledge_document_mode" DEFAULT 'completo' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "lote_atual" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "lotes_total" integer;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "draft_parcial" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_document_files" ADD CONSTRAINT "knowledge_document_files_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_files_ordem_uq" ON "knowledge_document_files" USING btree ("importacao_id","ordem");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_files_sha256_uq" ON "knowledge_document_files" USING btree ("importacao_id","sha256");--> statement-breakpoint
CREATE INDEX "knowledge_document_files_restaurant_idx" ON "knowledge_document_files" USING btree ("restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_id_restaurant_uq" ON "knowledge_documents" USING btree ("id","restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_arquivo_sha256_uq" ON "knowledge_documents" USING btree ("restaurant_id","alvo","modo","sha256") WHERE "knowledge_documents"."origem" = 'arquivo' and "knowledge_documents"."status" not in ('rejeitado', 'erro');--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_modo_ck" CHECK ("knowledge_documents"."modo" = 'completo' or "knowledge_documents"."alvo" = 'cardapio');--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_csv_alvo_ck" CHECK ("knowledge_documents"."origem" = 'arquivo' or "knowledge_documents"."alvo" = 'cardapio');--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_lotes_ck" CHECK ("knowledge_documents"."lote_atual" >= 0 and ("knowledge_documents"."lotes_total" is null or ("knowledge_documents"."lotes_total" between 1 and 1000 and "knowledge_documents"."lote_atual" <= "knowledge_documents"."lotes_total")));--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_storage_ck" CHECK (("knowledge_documents"."origem" = 'csv' and "knowledge_documents"."storage_path" is null and "knowledge_documents"."mime" is not null and "knowledge_documents"."tamanho" is not null and "knowledge_documents"."sha256" is not null) or ("knowledge_documents"."origem" = 'arquivo' and "knowledge_documents"."storage_path" ~ '^importacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' and "knowledge_documents"."mime" is not null and "knowledge_documents"."tamanho" is not null and "knowledge_documents"."sha256" is not null) or ("knowledge_documents"."origem" = 'arquivo' and "knowledge_documents"."storage_path" is null and "knowledge_documents"."mime" is null and "knowledge_documents"."tamanho" is null));