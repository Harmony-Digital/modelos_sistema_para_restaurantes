alter table public.attendance_notices enable row level security;--> statement-breakpoint
grant select, insert, update on public.attendance_notices to authenticated;--> statement-breakpoint
grant select, insert, update on public.attendance_notices to worker_app, web_app;--> statement-breakpoint
revoke delete, truncate on public.attendance_notices from authenticated, worker_app, web_app;--> statement-breakpoint
create policy app_roles on public.attendance_notices for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy equipe_read on public.attendance_notices for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_insert on public.attendance_notices for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_update on public.attendance_notices for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
