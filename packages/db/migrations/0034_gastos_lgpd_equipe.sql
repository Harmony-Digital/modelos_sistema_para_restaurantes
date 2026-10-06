CREATE TABLE "staff_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"papel" "staff_role" NOT NULL,
	"unidades" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "invite_status" DEFAULT 'pendente' NOT NULL,
	"erro" text,
	"user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invites_papel_ck" CHECK ("staff_invites"."papel" <> 'dono'),
	CONSTRAINT "staff_invites_email_ck" CHECK (char_length("staff_invites"."email") between 3 and 254 and position('@' in "staff_invites"."email") > 1),
	CONSTRAINT "staff_invites_nome_ck" CHECK (char_length("staff_invites"."nome") between 1 and 80),
	CONSTRAINT "staff_invites_erro_ck" CHECK ("staff_invites"."erro" is null or char_length("staff_invites"."erro") <= 60)
);
--> statement-breakpoint
CREATE TABLE "budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"escopo" "budget_scope" NOT NULL,
	"periodo" "budget_period" NOT NULL,
	"inicio_periodo" date NOT NULL,
	"nivel" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_alerts_nivel_ck" CHECK ("budget_alerts"."nivel" in (80, 100))
);
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cotacao_usd_brl" numeric(10, 4) DEFAULT '5.5' NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invites_email_uq" ON "staff_invites" USING btree ("restaurant_id",lower("email")) WHERE status <> 'aceito';--> statement-breakpoint
CREATE INDEX "staff_invites_restaurant_idx" ON "staff_invites" USING btree ("restaurant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alerts_uq" ON "budget_alerts" USING btree ("restaurant_id","escopo","periodo","inicio_periodo","nivel");--> statement-breakpoint
CREATE INDEX "messages_restaurant_created_idx" ON "messages" USING btree ("restaurant_id","created_at");--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_cotacao_ck" CHECK ("restaurants"."cotacao_usd_brl" between 0.5 and 50);--> statement-breakpoint
ALTER TABLE "retention_settings" ADD CONSTRAINT "retention_dias_minimo" CHECK ("retention_settings"."dado" = 'audio' or "retention_settings"."dias" >= case "retention_settings"."dado" when 'messages' then 7 else 30 end);