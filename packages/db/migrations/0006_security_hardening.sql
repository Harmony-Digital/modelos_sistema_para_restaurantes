-- 1. authenticated: sem TRUNCATE/TRIGGER/REFERENCES (TRUNCATE ignora RLS)
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from authenticated;

-- 2. service_role (BYPASSRLS) não altera a auditoria (I11)
revoke update, delete, truncate on public.audit_log from service_role;

-- 3. UPDATE por coluna: impede reapontar linhas para outro tenant
revoke update on public.conversations from authenticated;
grant update (estado, atendente_id) on public.conversations to authenticated;
revoke update on public.data_subject_requests from authenticated;
grant update (status, resolvido_por, resposta) on public.data_subject_requests to authenticated;

-- 4. worker_app precisa de SELECT em ai_runs (UPDATE ... WHERE / INSERT ... RETURNING)
grant select on public.ai_runs to worker_app;

-- 5. staff só grava auditoria como ator 'staff'
drop policy self_insert on public.audit_log;
create policy self_insert on public.audit_log for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id())
              and ator_id = (select auth.uid())
              and ator_tipo = 'staff');

-- 6. anon: sem sequences nem EXECUTE em funções futuras
revoke usage, select on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 7. DSR: sem DELETE (evidência LGPD)
drop policy gestao_all on public.data_subject_requests;
create policy gestao_read on public.data_subject_requests for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy gestao_insert on public.data_subject_requests for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
create policy gestao_update on public.data_subject_requests for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));
