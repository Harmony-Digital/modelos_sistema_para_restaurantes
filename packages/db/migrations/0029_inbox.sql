CREATE TYPE "public"."handoff_motivo" AS ENUM('pedido', 'frustracao', 'falhas', 'economico', 'servico');--> statement-breakpoint
CREATE TABLE "quick_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"texto" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quick_replies_titulo_ck" CHECK (char_length("quick_replies"."titulo") between 1 and 40),
	CONSTRAINT "quick_replies_texto_ck" CHECK (char_length("quick_replies"."texto") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_motivo" "handoff_motivo";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "aguardando_desde" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "atendente_id" uuid;--> statement-breakpoint
ALTER TABLE "quick_replies" ADD CONSTRAINT "quick_replies_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quick_replies_restaurant_ordem_idx" ON "quick_replies" USING btree ("restaurant_id","ordem");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_atendente_id_users_id_fk" FOREIGN KEY ("atendente_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_aguardando_idx" ON "conversations" USING btree ("restaurant_id","estado","aguardando_desde");--> statement-breakpoint
CREATE INDEX "conversations_unidade_idx" ON "conversations" USING btree ("restaurant_id","unidade_contexto_id","last_message_at" DESC NULLS LAST);