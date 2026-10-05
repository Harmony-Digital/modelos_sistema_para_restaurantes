CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"estado" "conversation_state" DEFAULT 'ia' NOT NULL,
	"atendente_id" uuid,
	"unidade_contexto_id" uuid,
	"resumo" text,
	"falhas_consecutivas" integer DEFAULT 0 NOT NULL,
	"processed_up_to_id" bigint DEFAULT 0 NOT NULL,
	"window_expires_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"wa_id_hash" text NOT NULL,
	"telefone_cifrado" text NOT NULL,
	"nome_perfil" text,
	"unidade_preferida_id" uuid,
	"privacy_notice_sent_at" timestamp with time zone,
	"ultima_interacao_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"restaurant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direcao" "message_direction" NOT NULL,
	"autor" "message_author" NOT NULL,
	"wamid" text,
	"tipo" "message_type" NOT NULL,
	"texto" text,
	"transcrito" boolean DEFAULT false NOT NULL,
	"midia_ref" jsonb,
	"status_envio" text,
	"ai_run_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_atendente_id_users_id_fk" FOREIGN KEY ("atendente_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_unidade_contexto_id_units_id_fk" FOREIGN KEY ("unidade_contexto_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_unidade_preferida_id_units_id_fk" FOREIGN KEY ("unidade_preferida_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_one_open_per_customer_uq" ON "conversations" USING btree ("customer_id") WHERE estado <> 'encerrada';--> statement-breakpoint
CREATE INDEX "conversations_inbox_idx" ON "conversations" USING btree ("restaurant_id","estado","last_message_at" DESC NULLS LAST) WHERE estado <> 'encerrada';--> statement-breakpoint
CREATE UNIQUE INDEX "customers_restaurant_wa_id_hash_uq" ON "customers" USING btree ("restaurant_id","wa_id_hash");--> statement-breakpoint
CREATE INDEX "customers_ultima_interacao_idx" ON "customers" USING btree ("ultima_interacao_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_wamid_uq" ON "messages" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id","id");