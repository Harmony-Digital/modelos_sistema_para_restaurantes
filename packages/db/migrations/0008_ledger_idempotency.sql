ALTER TABLE "spend_ledger" ADD COLUMN "reserva_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "spend_ledger_reserva_settled_uq" ON "spend_ledger" USING btree ("reserva_id") WHERE "spend_ledger"."tipo" in ('liquidacao','estorno');--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_valor_non_negative" CHECK ("spend_ledger"."valor_usd" >= 0);--> statement-breakpoint
grant select on public.spend_ledger to worker_app;
