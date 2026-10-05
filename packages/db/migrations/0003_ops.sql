CREATE TABLE "ai_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"restaurant_id" uuid NOT NULL,
	"conversation_id" uuid,
	"etapa" "ai_stage" NOT NULL,
	"modelo" text NOT NULL,
	"prompt_version" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"tokens_cache" integer DEFAULT 0 NOT NULL,
	"audio_segundos" numeric(8, 2),
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latencia_ms" integer,
	"intent" text,
	"resultado" text,
	"erro" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"restaurant_id" uuid NOT NULL,
	"ator_id" uuid,
	"ator_tipo" "actor_type" NOT NULL,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"diff" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"escopo" "budget_scope" NOT NULL,
	"periodo" "budget_period" NOT NULL,
	"inicio_periodo" date NOT NULL,
	"reservado" numeric(12, 6) DEFAULT '0' NOT NULL,
	"gasto" numeric(12, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_counters_non_negative" CHECK ("budget_counters"."reservado" >= 0 and "budget_counters"."gasto" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"escopo" "budget_scope" NOT NULL,
	"periodo" "budget_period" NOT NULL,
	"limite_usd" numeric(12, 6) NOT NULL,
	"alerta_pct" integer DEFAULT 80 NOT NULL,
	"acao" "budget_action" DEFAULT 'modo_economico' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limits_limite_positive" CHECK ("budget_limits"."limite_usd" > 0),
	CONSTRAINT "budget_limits_alerta_range" CHECK ("budget_limits"."alerta_pct" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"customer_id" uuid,
	"tipo" "dsr_type" NOT NULL,
	"status" "dsr_status" DEFAULT 'aberto' NOT NULL,
	"prazo" timestamp with time zone DEFAULT now() + interval '15 days' NOT NULL,
	"resolvido_por" uuid,
	"resposta" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_settings" (
	"restaurant_id" uuid NOT NULL,
	"dado" text NOT NULL,
	"dias" integer NOT NULL,
	"acao" "retention_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_settings_restaurant_id_dado_pk" PRIMARY KEY("restaurant_id","dado"),
	CONSTRAINT "retention_dias_positive" CHECK ("retention_settings"."dias" >= 0)
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"restaurant_id" uuid NOT NULL,
	"escopo" "budget_scope" NOT NULL,
	"tipo" "ledger_kind" NOT NULL,
	"valor_usd" numeric(12, 6) NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"versao" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_counters" ADD CONSTRAINT "budget_counters_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_settings" ADD CONSTRAINT "retention_settings_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_created_brin" ON "ai_runs" USING brin ("created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_conversation_idx" ON "ai_runs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "audit_log_restaurant_created_idx" ON "audit_log" USING btree ("restaurant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "budget_counters_period_uq" ON "budget_counters" USING btree ("restaurant_id","escopo","periodo","inicio_periodo");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_limits_scope_period_uq" ON "budget_limits" USING btree ("restaurant_id","escopo","periodo");--> statement-breakpoint
CREATE INDEX "dsr_status_prazo_idx" ON "data_subject_requests" USING btree ("status","prazo");--> statement-breakpoint
CREATE INDEX "spend_ledger_created_brin" ON "spend_ledger" USING brin ("created_at");