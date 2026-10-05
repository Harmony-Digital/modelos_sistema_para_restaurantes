revoke update on public.attendance_notices from authenticated;--> statement-breakpoint
grant update (status, updated_at) on public.attendance_notices to authenticated;--> statement-breakpoint
drop policy gestao_update on public.attendance_notices;--> statement-breakpoint
create policy gestao_update on public.attendance_notices for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[]))
    and status = 'cancelado');
