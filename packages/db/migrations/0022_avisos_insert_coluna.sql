-- authenticated (painel via Data API) insere só as colunas do formulário; simulado, status, anonimizado,
-- customer_id, id e datas ficam no default. A policy amarra origem, cliente, simulação e autoria.
revoke insert on public.attendance_notices from authenticated;--> statement-breakpoint
grant insert (restaurant_id, unit_id, data, pessoas, horario_aprox, nome, origem, criado_por) on public.attendance_notices to authenticated;--> statement-breakpoint
drop policy gestao_insert on public.attendance_notices;--> statement-breakpoint
create policy gestao_insert on public.attendance_notices for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[]))
    and origem = 'painel' and customer_id is null and simulado = false
    and criado_por = (select auth.uid()));
