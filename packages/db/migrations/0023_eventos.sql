CREATE TYPE "public"."event_status" AS ENUM('novo', 'em_contato', 'confirmado', 'recusado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('aniversario', 'casamento', 'corporativo', 'confraternizacao', 'outro');--> statement-breakpoint
CREATE TABLE "event_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"space_id" uuid,
	"customer_id" uuid,
	"nome" text,
	"data" date NOT NULL,
	"convidados" smallint NOT NULL,
	"tipo" "event_type" NOT NULL,
	"tipo_texto" text,
	"observacoes" text,
	"status" "event_status" DEFAULT 'novo' NOT NULL,
	"responsavel_id" uuid,
	"notas_internas" text,
	"simulado" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_requests_convidados_ck" CHECK ("event_requests"."convidados" between 1 and 1000),
	CONSTRAINT "event_requests_tipo_texto_ck" CHECK ("event_requests"."tipo_texto" is null or char_length("event_requests"."tipo_texto") <= 60),
	CONSTRAINT "event_requests_observacoes_ck" CHECK ("event_requests"."observacoes" is null or char_length("event_requests"."observacoes") <= 300),
	CONSTRAINT "event_requests_notas_ck" CHECK ("event_requests"."notas_internas" is null or char_length("event_requests"."notas_internas") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "event_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"capacidade_min" smallint NOT NULL,
	"capacidade_max" smallint NOT NULL,
	"descricao" text,
	"condicoes" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_spaces_capacidade_ck" CHECK (1 <= "event_spaces"."capacidade_min" and "event_spaces"."capacidade_min" <= "event_spaces"."capacidade_max" and "event_spaces"."capacidade_max" <= 1000)
);
--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_space_id_event_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."event_spaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_responsavel_id_users_id_fk" FOREIGN KEY ("responsavel_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_spaces" ADD CONSTRAINT "event_spaces_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_spaces" ADD CONSTRAINT "event_spaces_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_requests_fila_idx" ON "event_requests" USING btree ("restaurant_id","status","data");--> statement-breakpoint
CREATE INDEX "event_requests_unidade_idx" ON "event_requests" USING btree ("restaurant_id","unit_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "event_spaces_unit_nome_uq" ON "event_spaces" USING btree ("unit_id","nome");--> statement-breakpoint
CREATE INDEX "event_spaces_restaurant_unit_idx" ON "event_spaces" USING btree ("restaurant_id","unit_id");