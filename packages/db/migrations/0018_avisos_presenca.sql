CREATE TYPE "public"."attendance_origin" AS ENUM('ia', 'painel');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('ativo', 'cancelado');--> statement-breakpoint
CREATE TABLE "attendance_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"customer_id" uuid,
	"nome" text,
	"data" date NOT NULL,
	"pessoas" smallint NOT NULL,
	"horario_aprox" text,
	"status" "attendance_status" DEFAULT 'ativo' NOT NULL,
	"origem" "attendance_origin" NOT NULL,
	"simulado" boolean DEFAULT false NOT NULL,
	"anonimizado" boolean DEFAULT false NOT NULL,
	"criado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_pessoas_ck" CHECK ("attendance_notices"."pessoas" between 1 and 60),
	CONSTRAINT "attendance_horario_ck" CHECK ("attendance_notices"."horario_aprox" is null or char_length("attendance_notices"."horario_aprox") <= 40)
);
--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD CONSTRAINT "attendance_notices_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD CONSTRAINT "attendance_notices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD CONSTRAINT "attendance_notices_criado_por_users_id_fk" FOREIGN KEY ("criado_por") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD CONSTRAINT "attendance_notices_unit_fk" FOREIGN KEY ("unit_id","restaurant_id") REFERENCES "public"."units"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_ativo_uq" ON "attendance_notices" USING btree ("customer_id","unit_id","data") WHERE status = 'ativo';--> statement-breakpoint
CREATE INDEX "attendance_previsao_idx" ON "attendance_notices" USING btree ("restaurant_id","unit_id","data");