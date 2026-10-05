-- ============ Roles de aplicação (senhas definidas fora da migration) ============
do $$ begin
  if not exists (select from pg_roles where rolname = 'web_app') then
    create role web_app login noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'worker_app') then
    create role worker_app login noinherit;
  end if;
end $$;
grant web_app, worker_app to postgres;      -- permite SET ROLE nos testes/migrations
grant authenticated to web_app;            -- painel: withUserContext faz SET LOCAL ROLE authenticated
grant usage on schema public, app to web_app, worker_app, authenticated;

-- Fila: schema do pg-boss pertence ao worker (ele cria/migra as tabelas)
create schema if not exists pgboss authorization worker_app;
grant usage on schema pgboss to web_app;
alter default privileges for role worker_app in schema pgboss
  grant select, insert, update on tables to web_app;

-- ============ Defaults do Supabase: tirar privilégios amplos ============
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ============ updated_at automático ============
do $$ declare t text; begin
  for t in select table_name from information_schema.columns
            where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('create or replace trigger touch_updated_at before update on public.%I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ============ Funções auxiliares das policies ============
create or replace function app.my_restaurant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.restaurant_id from public.staff s where s.user_id = (select auth.uid()) and s.ativo
$$;

create or replace function app.my_role() returns public.staff_role
language sql stable security definer set search_path = '' as $$
  select s.papel from public.staff s where s.user_id = (select auth.uid()) and s.ativo
$$;

-- dono/gerente exigem MFA (aal2); atendente aceita aal1
create or replace function app.mfa_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.my_role() = 'atendente', false)
      or coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
$$;

revoke all on function app.my_restaurant_id(), app.my_role(), app.mfa_ok() from public;
grant execute on function app.my_restaurant_id(), app.my_role(), app.mfa_ok() to authenticated;

-- ============ RLS em todas as tabelas + barreira MFA restritiva ============
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    -- sem FORCE: o dono das tabelas (postgres: migrations/bootstrap) segue isento; web_app,
    -- worker_app e authenticated não são donos, então a RLS vale para todos eles.
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated
                    using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
  end loop;
end $$;

-- ============ Policies do painel (authenticated) ============
-- Leitura por restaurante
create policy staff_read on public.restaurants for select to authenticated
  using (id = (select app.my_restaurant_id()));
create policy dono_update on public.restaurants for update to authenticated
  using (id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono');

create policy staff_read on public.units for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));
create policy gestao_write on public.units for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));

create policy staff_read on public.staff for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));
create policy dono_write on public.staff for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono')
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono');

create policy staff_read on public.customers for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));
create policy staff_read on public.conversations for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));
create policy staff_update on public.conversations for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()))
  with check (restaurant_id = (select app.my_restaurant_id()));
create policy staff_read on public.messages for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));

-- Custos: só dono e gerente leem; só dono altera limites
create policy gestao_read on public.ai_runs for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy gestao_read on public.budget_limits for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy dono_write on public.budget_limits for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono')
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono');
create policy gestao_read on public.budget_counters for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy gestao_read on public.spend_ledger for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));

-- Auditoria: dono lê; qualquer membro grava a própria ação; ninguém altera/apaga
create policy dono_read on public.audit_log for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono');
create policy self_insert on public.audit_log for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id()) and ator_id = (select auth.uid()));

create policy gestao_all on public.data_subject_requests for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));

create policy gestao_read on public.retention_settings for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy dono_write on public.retention_settings for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono')
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono');

create policy staff_read on public.worker_heartbeats for select to authenticated
  using ((select app.my_role()) is not null);

-- ============ Roles de aplicação: policies amplas, GRANTS mínimos ============
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create policy app_roles on public.%I for all to web_app, worker_app using (true) with check (true)', t);
  end loop;
end $$;

-- web_app (webhook): ingestão
grant select on public.restaurants to web_app;
grant select, insert, update on public.customers, public.conversations, public.messages to web_app;

-- worker_app: processamento
grant select on public.restaurants, public.units, public.staff, public.budget_limits, public.retention_settings to worker_app;
grant select, insert, update on public.customers, public.conversations, public.messages,
  public.budget_counters, public.data_subject_requests, public.worker_heartbeats to worker_app;
grant insert on public.ai_runs, public.spend_ledger, public.audit_log to worker_app;
grant update (resultado, erro, cost_usd, tokens_in, tokens_out, tokens_cache, latencia_ms, intent) on public.ai_runs to worker_app;
grant usage on all sequences in schema public to web_app, worker_app;

-- ============ Auditoria imutável (I11) ============
revoke update, delete, truncate on public.audit_log from authenticated, web_app, worker_app, anon;
