ALTER TABLE "knowledge_gaps" DROP CONSTRAINT "knowledge_gaps_fact_id_knowledge_facts_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_facts_id_restaurant_uq" ON "knowledge_facts" USING btree ("id","restaurant_id");