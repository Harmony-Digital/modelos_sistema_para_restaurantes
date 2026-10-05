-- Permissão por unidade avaliada UMA vez por consulta (initplan), em vez de uma chamada
-- SECURITY DEFINER por linha. Mesma regra de app.can_access_unit (migration 0012).

-- dono, ou qualquer papel com unidades_permitidas vazio: acessa todas. Sem staff ativo: false.
create or replace function app.acesso_todas_unidades() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.papel = 'dono' or cardinality(s.unidades_permitidas) = 0
      from public.staff s
     where s.user_id = (select auth.uid()) and s.ativo
  ), false)
$$;
--> statement-breakpoint
-- unidades listadas para quem é restrito; vazio para os demais (inclusive sem staff).
create or replace function app.minhas_unidades() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.unidades_permitidas
      from public.staff s
     where s.user_id = (select auth.uid()) and s.ativo
  ), '{}'::uuid[])
$$;
--> statement-breakpoint
revoke all on function app.acesso_todas_unidades(), app.minhas_unidades() from public;
--> statement-breakpoint
grant execute on function app.acesso_todas_unidades(), app.minhas_unidades() to authenticated;
--> statement-breakpoint

-- units
drop policy staff_read on public.units;
--> statement-breakpoint
create policy staff_read on public.units for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades())::uuid[])));
--> statement-breakpoint
drop policy gestao_write on public.units;
--> statement-breakpoint
create policy gestao_write on public.units for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades())::uuid[])));
--> statement-breakpoint

-- horários e exceções
do $$ declare t text; begin
  foreach t in array array['unit_hours','unit_hour_exceptions'] loop
    execute format('drop policy staff_read on public.%I', t);
    execute format('drop policy gestao_write on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated
      using (restaurant_id = (select app.my_restaurant_id())
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))', t);
    execute format('create policy gestao_write on public.%I for all to authenticated
      using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'')
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
      with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'')
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))', t);
  end loop;
end $$;
--> statement-breakpoint

-- fatos (unit_id nulo = todas as unidades: leitura para todos, escrita só para quem acessa todas)
drop policy staff_read on public.knowledge_facts;
--> statement-breakpoint
create policy staff_read on public.knowledge_facts for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and (unit_id is null or (select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
--> statement-breakpoint
drop policy gestao_write on public.knowledge_facts;
--> statement-breakpoint
create policy gestao_write on public.knowledge_facts for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
--> statement-breakpoint

-- lacunas
drop policy staff_read on public.knowledge_gaps;
--> statement-breakpoint
create policy staff_read on public.knowledge_gaps for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and (unit_id is null or (select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
--> statement-breakpoint
drop policy gestao_update on public.knowledge_gaps;
--> statement-breakpoint
create policy gestao_update on public.knowledge_gaps for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
