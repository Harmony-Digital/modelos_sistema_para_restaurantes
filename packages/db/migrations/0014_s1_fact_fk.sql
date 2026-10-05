-- FK composta: a lacuna só pode apontar para fato do mesmo restaurante;
-- ao apagar o fato só fact_id vira nulo (restaurant_id é NOT NULL).
alter table public.knowledge_gaps add constraint knowledge_gaps_fact_fk
  foreign key (fact_id, restaurant_id) references public.knowledge_facts (id, restaurant_id)
  on delete set null (fact_id);

-- PG17 concede MAINTAIN por padrão: o painel não deve ter.
revoke maintain on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke maintain on tables from authenticated;
