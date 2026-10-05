ALTER TABLE "conversations" ADD COLUMN "relogio_offset_segundos" integer;--> statement-breakpoint
CREATE INDEX "ai_runs_restaurant_created_idx" ON "ai_runs" USING btree ("restaurant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "knowledge_facts_unit_idx" ON "knowledge_facts" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "knowledge_gaps_unit_idx" ON "knowledge_gaps" USING btree ("unit_id");