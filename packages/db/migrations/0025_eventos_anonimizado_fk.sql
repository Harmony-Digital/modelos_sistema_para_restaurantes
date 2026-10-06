ALTER TABLE "event_requests" DROP CONSTRAINT "event_requests_space_id_event_spaces_id_fk";
--> statement-breakpoint
ALTER TABLE "event_requests" ADD COLUMN "anonimizado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "event_requests_cliente_idx" ON "event_requests" USING btree ("customer_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "event_spaces_id_unit_uq" ON "event_spaces" USING btree ("id","unit_id");--> statement-breakpoint
-- (manual) FK composta: o espaço do pedido é da mesma unidade (e, pela FK da unidade, do mesmo restaurante);
-- ao apagar o espaço só space_id vira nulo (unit_id é NOT NULL). Padrão da 0014. authenticated não ganha
-- UPDATE em anonimizado (grants por coluna da 0024).
ALTER TABLE "event_requests" ADD CONSTRAINT "event_requests_space_fk"
  FOREIGN KEY ("space_id", "unit_id") REFERENCES "public"."event_spaces" ("id", "unit_id")
  ON DELETE SET NULL ("space_id");
