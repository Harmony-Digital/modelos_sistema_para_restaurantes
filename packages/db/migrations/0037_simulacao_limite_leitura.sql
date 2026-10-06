-- Integração do Bloco C: o simulador lê (como web_app, sem contexto de usuário) se a última resposta da conversa
-- simulada veio do limite de simulação. O audit_log não é legível por web_app, então a leitura vai por função
-- estreita (só um booleano, só desta conversa no restaurante informado).
create or replace function app.simulacao_limite_atingido(p_restaurant uuid, p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.audit_log a
    where a.restaurant_id = p_restaurant
      and a.entidade = 'conversation'
      and a.entidade_id = p_conversation::text
      and a.acao = 'orcamento.sem_saldo_simulacao'
      and a.created_at > coalesce(
        (select max(m.created_at) from public.messages m where m.conversation_id = p_conversation and m.direcao = 'in'),
        'epoch'::timestamptz)
  )
$$;--> statement-breakpoint
revoke all on function app.simulacao_limite_atingido(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.simulacao_limite_atingido(uuid, uuid) to web_app;
