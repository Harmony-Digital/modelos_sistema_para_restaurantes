CREATE TYPE "public"."actor_type" AS ENUM('staff', 'ia', 'sistema');--> statement-breakpoint
CREATE TYPE "public"."ai_stage" AS ENUM('triagem', 'resposta', 'stt', 'ingestao');--> statement-breakpoint
CREATE TYPE "public"."budget_action" AS ENUM('modo_economico', 'bloquear');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('dia', 'mes');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('ia', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('ia', 'aguardando_humano', 'humano', 'encerrada');--> statement-breakpoint
CREATE TYPE "public"."dsr_status" AS ENUM('aberto', 'em_andamento', 'concluido', 'negado');--> statement-breakpoint
CREATE TYPE "public"."dsr_type" AS ENUM('acesso', 'exclusao', 'correcao');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('reserva', 'liquidacao', 'estorno');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('cliente', 'ia', 'humano', 'sistema');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('texto', 'audio', 'imagem', 'documento', 'outro');--> statement-breakpoint
CREATE TYPE "public"."retention_action" AS ENUM('apagar', 'anonimizar');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('dono', 'gerente', 'atendente');--> statement-breakpoint
CREATE TABLE "restaurants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"persona_ia" text DEFAULT '' NOT NULL,
	"mensagens_padrao" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"horario_atendimento_humano" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dpo_nome" text,
	"dpo_contato" text,
	"politica_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"papel" "staff_role" NOT NULL,
	"unidades_permitidas" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_restaurant_idx" ON "staff" USING btree ("restaurant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_restaurant_slug_uq" ON "units" USING btree ("restaurant_id","slug");