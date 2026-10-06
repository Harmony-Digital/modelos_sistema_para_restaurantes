-- authenticated (painel): lê sob RLS por unidade; grava espaço (dono/gerente) e só status/responsável/notas do pedido.
-- Pedido de evento nasce só pelo worker (sem INSERT para authenticated); simulado nunca aparece no painel.
alter table public.event_spaces enable row level security;--> statement-breakpoint
alter table public.event_requests enable row level security;--> statement-breakpoint
revoke all on public.event_spaces, public.event_requests from authenticated;--> statement-breakpoint
grant select on public.event_spaces, public.event_requests to authenticated;--> statement-breakpoint
grant insert (restaurant_id, unit_id, nome, capacidade_min, capacidade_max, descricao, condicoes, ativo) on public.event_spaces to authenticated;--> statement-breakpoint
grant update (nome, capacidade_min, capacidade_max, descricao, condicoes, ativo, updated_at) on public.event_spaces to authenticated;--> statement-breakpoint
grant update (status, responsavel_id, notas_internas, updated_at) on public.event_requests to authenticated;--> statement-breakpoint
grant select, insert, update on public.event_spaces, public.event_requests to web_app, worker_app;--> statement-breakpoint
revoke delete, truncate on public.event_spaces, public.event_requests from authenticated, web_app, worker_app;--> statement-breakpoint
create policy app_roles on public.event_spaces for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy app_roles on public.event_requests for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy mfa_required on public.event_spaces as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy mfa_required on public.event_requests as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy equipe_read on public.event_spaces for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_write on public.event_spaces for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy equipe_read on public.event_requests for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and not simulado
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy equipe_update on public.event_requests for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and not simulado
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
