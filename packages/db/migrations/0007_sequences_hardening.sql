-- A. anon: nenhum privilégio em sequences existentes
revoke all on all sequences in schema public from anon;
-- B. authenticated/web_app/worker_app não podem setval (só USAGE/SELECT quando aplicável)
revoke update on all sequences in schema public from authenticated;
alter default privileges for role postgres in schema public revoke update on sequences from authenticated;
revoke update, select on all sequences in schema public from web_app, worker_app;
-- C. service_role: sem TRIGGER/REFERENCES em audit_log
revoke trigger, references on public.audit_log from service_role;
