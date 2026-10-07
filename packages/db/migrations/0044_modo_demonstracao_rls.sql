-- Modo demonstração (07/10/2026): com o modo ligado, "tempo até assumir" também conta as conversas simuladas.
-- Desligado, igual à 0032 (só conversas reais).
create or replace function app.tempo_ate_assumir_hoje() returns double precision
language sql stable security definer set search_path = '' as $$
  select percentile_cont(0.5) within group (
           order by extract(epoch from (a.created_at - (a.diff ->> 'aguardandoDesde')::timestamptz)))
    from public.audit_log a
    join public.restaurants r on r.id = a.restaurant_id
    join public.conversations c on c.id::text = a.entidade_id and c.restaurant_id = a.restaurant_id
   where a.restaurant_id = (select app.my_restaurant_id())
     and (select app.mfa_ok())
     and a.acao = 'conversa.assumida'
     and a.entidade = 'conversation'
     and a.diff ->> 'aguardandoDesde' is not null
     and (a.diff ->> 'simulada' = 'false' or r.modo_demonstracao)
     and a.created_at >= (date_trunc('day', now() at time zone r.timezone) at time zone r.timezone)
     and ((select app.acesso_todas_unidades()) or c.unidade_contexto_id = any ((select app.minhas_unidades())::uuid[]))
$$;--> statement-breakpoint
revoke all on function app.tempo_ate_assumir_hoje() from public;--> statement-breakpoint
grant execute on function app.tempo_ate_assumir_hoje() to authenticated;
--> statement-breakpoint
-- O pedido de evento simulado era barrado na própria RLS (0024). Com o modo ligado, a equipe lê e atualiza como os reais
-- (mesma regra de unidade). Função security definer: lê só a coluna do restaurante de quem pergunta.
create or replace function app.modo_demonstracao() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.modo_demonstracao from public.restaurants r where r.id = (select app.my_restaurant_id())), false)
$$;--> statement-breakpoint
revoke all on function app.modo_demonstracao() from public;--> statement-breakpoint
grant execute on function app.modo_demonstracao() to authenticated;--> statement-breakpoint
drop policy equipe_read on public.event_requests;--> statement-breakpoint
create policy equipe_read on public.event_requests for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (not simulado or (select app.modo_demonstracao()))
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
drop policy equipe_update on public.event_requests;--> statement-breakpoint
create policy equipe_update on public.event_requests for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (not simulado or (select app.modo_demonstracao()))
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
