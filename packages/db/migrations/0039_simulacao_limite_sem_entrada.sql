-- Revisão final da Etapa 08 (Important 1): o polling de 1 s do simulador não varre mais o audit_log do restaurante.
-- Sem mensagem do cliente na conversa não há resposta a explicar: devolve false sem tocar no audit_log. Com mensagem,
-- a busca usa o índice parcial audit_log_sem_saldo_simulacao_idx (entidade_id, created_at) da 0038.
-- p_restaurant continua conferido: outro restaurante devolve false.
create or replace function app.simulacao_limite_atingido(p_restaurant uuid, p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with u as (
    select max(m.created_at) as t from public.messages m
    where m.conversation_id = p_conversation and m.direcao = 'in'
  )
  select u.t is not null and exists (
    select 1 from public.audit_log a
    where a.acao = 'orcamento.sem_saldo_simulacao'
      and a.entidade_id = p_conversation::text
      and a.created_at > u.t
      and a.restaurant_id = p_restaurant
      and a.entidade = 'conversation'
  )
  from u
$$;--> statement-breakpoint
revoke all on function app.simulacao_limite_atingido(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.simulacao_limite_atingido(uuid, uuid) to web_app;
