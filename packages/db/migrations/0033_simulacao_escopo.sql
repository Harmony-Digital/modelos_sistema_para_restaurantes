CREATE TYPE "public"."invite_status" AS ENUM('pendente', 'enviado', 'erro', 'aceito');--> statement-breakpoint
-- (manual) Escopo `simulacao` sem `ALTER TYPE ... ADD VALUE`: o migrator do Drizzle aplica todas as migrations
-- pendentes numa transação só, e valor novo de enum não pode ser usado antes do commit ("unsafe use of new value").
-- Recriar o tipo na mesma transação deixa os valores usáveis já aqui (limites padrão abaixo) e nas seguintes.
-- Mesmo resultado do ADD VALUE gerado: ('ia', 'whatsapp', 'simulacao'), nesta ordem.
CREATE TYPE "public"."budget_scope_v2" AS ENUM('ia', 'whatsapp', 'simulacao');--> statement-breakpoint
ALTER TABLE "public"."budget_limits" ALTER COLUMN "escopo" SET DATA TYPE "public"."budget_scope_v2" USING "escopo"::text::"public"."budget_scope_v2";--> statement-breakpoint
ALTER TABLE "public"."budget_counters" ALTER COLUMN "escopo" SET DATA TYPE "public"."budget_scope_v2" USING "escopo"::text::"public"."budget_scope_v2";--> statement-breakpoint
ALTER TABLE "public"."spend_ledger" ALTER COLUMN "escopo" SET DATA TYPE "public"."budget_scope_v2" USING "escopo"::text::"public"."budget_scope_v2";--> statement-breakpoint
DROP TYPE "public"."budget_scope";--> statement-breakpoint
ALTER TYPE "public"."budget_scope_v2" RENAME TO "budget_scope";--> statement-breakpoint
-- (manual) limites padrão da simulação (US$ 1/dia, 10/mês) para os restaurantes já existentes; o bootstrap cobre os novos
INSERT INTO "public"."budget_limits" ("restaurant_id", "escopo", "periodo", "limite_usd")
  SELECT r."id", 'simulacao', p."periodo"::"public"."budget_period", p."limite"
    FROM "public"."restaurants" r
   CROSS JOIN (VALUES ('dia', 1::numeric), ('mes', 10::numeric)) AS p("periodo", "limite")
  ON CONFLICT DO NOTHING;
