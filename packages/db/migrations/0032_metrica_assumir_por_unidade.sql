-- Revisão final da Etapa 06: "tempo até assumir" respeita as unidades de quem vê (mesma regra da RLS de conversations).
-- Dono/acesso a todas as unidades: tudo (inclusive conversa sem unidade); demais: só unidade_contexto_id ∈ minhas_unidades.
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
     and a.diff ->> 'simulada' = 'false'
     and a.created_at >= (date_trunc('day', now() at time zone r.timezone) at time zone r.timezone)
     and ((select app.acesso_todas_unidades()) or c.unidade_contexto_id = any ((select app.minhas_unidades())::uuid[]))
$$;--> statement-breakpoint
revoke all on function app.tempo_ate_assumir_hoje() from public;--> statement-breakpoint
grant execute on function app.tempo_ate_assumir_hoje() to authenticated;
