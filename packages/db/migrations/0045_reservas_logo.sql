-- Reserva (spec 2026-10-07 §2). O enum é renomeado no lugar (o drizzle-kit gerava DROP TYPE + cast de texto, que
-- perde o mapeamento e falha com a policy gestao_update): RENAME VALUE preserva os dados, o default, o índice único
-- parcial e as policies (guardam o OID do valor): ativo → confirmada, cancelado → cancelada. `nao_veio` entra com
-- ADD VALUE e não é usado nesta transação.
ALTER TYPE "public"."attendance_status" RENAME VALUE 'ativo' TO 'confirmada';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" RENAME VALUE 'cancelado' TO 'cancelada';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" ADD VALUE 'nao_veio';--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "regras_reserva" text DEFAULT 'Sua reserva está confirmada! Guardamos o lugar por até 15 minutos após o horário marcado; depois disso, o espaço pode ser liberado para outros clientes. Se precisar cancelar ou mudar o número de pessoas, é só avisar por aqui.' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "capacidade_pessoas" smallint;--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD COLUMN "horario" time;--> statement-breakpoint
ALTER TABLE "attendance_notices" ADD COLUMN "contato_cifrado" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_regras_reserva_ck" CHECK (char_length("restaurants"."regras_reserva") between 1 and 600);--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_logo_path_ck" CHECK ("restaurants"."logo_path" is null or "restaurants"."logo_path" ~ ('^' || "restaurants"."id"::text || '/logo-[0-9a-f]{64}[.](png|jpg|webp)$'));--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_capacidade_ck" CHECK ("units"."capacidade_pessoas" is null or "units"."capacidade_pessoas" between 1 and 5000);