-- Fix round 1 da Etapa 08 (revisão do Bloco A).
-- 1. Retenção: conversa `ia` não protege cliente inativo (a IA nunca encerra conversa); conversas vazias e vencidas
--    saem em qualquer estado; inativo = sem interação nem mensagem há mais de N dias; só conversa com humano ou pedido
--    do titular em aberto poupa o cliente (o pedido de evento fica, anonimizado).
-- 2. Defesa em profundidade: excluir_titular exige ator = usuário da sessão; resumo_titular exige que o usuário da
--    sessão seja dono/gerente ativo do restaurante; custo_por_unidade junta conversas só do mesmo restaurante.

create or replace function app.excluir_titular(p_customer uuid, p_ator uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rest uuid;
begin
  if p_ator is null or p_ator is distinct from (select auth.uid()) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  select restaurant_id into v_rest from public.customers where id = p_customer for update;
  if v_rest is null then return jsonb_build_object('ja_inexistente', true); end if;
  if not exists (select 1 from public.staff s where s.user_id = p_ator and s.restaurant_id = v_rest and s.ativo
                   and s.papel in ('dono','gerente')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return app.apagar_cliente(p_customer);
end $$;--> statement-breakpoint
create or replace function app.resumo_titular(p_customer uuid, p_restaurant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nomePerfil', c.nome_perfil,
    'primeiraInteracao', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ultimaInteracao', to_char(c.ultima_interacao_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'conversas', (select count(*) from public.conversations cv where cv.customer_id = c.id),
    'mensagens', (select count(*) from public.messages m join public.conversations cv on cv.id = m.conversation_id
                   where cv.customer_id = c.id),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'pessoas', a.pessoas, 'status', a.status, 'unidade', u.nome)
                                         order by a.data, a.created_at)
                          from public.attendance_notices a join public.units u on u.id = a.unit_id
                         where a.customer_id = c.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('data', e.data, 'convidados', e.convidados, 'tipo', e.tipo,
                                                             'status', e.status, 'unidade', u.nome)
                                          order by e.data, e.created_at)
                           from public.event_requests e join public.units u on u.id = e.unit_id
                          where e.customer_id = c.id), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('tipo', d.tipo, 'status', d.status,
                                                             'criadoEm', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                                          order by d.created_at, d.id)
                           from public.data_subject_requests d where d.customer_id = c.id), '[]'::jsonb)
  )
  from public.customers c
  where c.id = p_customer and c.restaurant_id = p_restaurant
    and exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid()) and s.restaurant_id = p_restaurant and s.ativo
                   and s.papel in ('dono','gerente'))
$$;--> statement-breakpoint
create or replace function app.custo_por_unidade(p_inicio timestamptz, p_fim timestamptz)
returns table (unit_id uuid, unidade text, real_usd numeric)
language sql stable security definer set search_path = '' as $$
  select c.unidade_contexto_id, u.nome, sum(r.cost_usd)
    from public.ai_runs r
    left join public.conversations c on c.id = r.conversation_id and c.restaurant_id = r.restaurant_id
    left join public.units u on u.id = c.unidade_contexto_id
   where r.restaurant_id = (select app.my_restaurant_id())
     and (select app.my_role()) in ('dono','gerente')
     and (select app.mfa_ok())
     and r.created_at >= p_inicio and r.created_at < p_fim
     and not r.simulado
   group by 1, 2
$$;--> statement-breakpoint
create or replace function app.aplicar_retencao(p_restaurant uuid, p_agora timestamptz, p_lote int default 5000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text; v_hoje date; v_sim timestamptz;
  d_msg int; d_av int; d_ev int; d_ai int; d_cli int; d_aud int;
  n int; n_msgs int := 0; n_conv int := 0; n_sim int := 0; n_av int := 0; n_ev int := 0; n_ai int := 0; n_cli int := 0;
  n_aud int := 0; v_pend boolean := false; v_cli uuid;
begin
  if p_lote is null or p_lote < 1 then raise exception 'lote_invalido' using errcode = '22023'; end if;
  select timezone into v_tz from public.restaurants where id = p_restaurant;
  if v_tz is null then return jsonb_build_object('ja_inexistente', true); end if;
  v_hoje := (p_agora at time zone v_tz)::date;
  v_sim := p_agora - interval '7 days';
  select max(dias) filter (where dado = 'messages'), max(dias) filter (where dado = 'attendance_notices'),
         max(dias) filter (where dado = 'event_requests'), max(dias) filter (where dado = 'ai_runs'),
         max(dias) filter (where dado = 'customers_inativos'), max(dias) filter (where dado = 'audit_log')
    into d_msg, d_av, d_ev, d_ai, d_cli, d_aud
    from public.retention_settings where restaurant_id = p_restaurant;

  -- simulações > 7 dias: cliente simulado (cascata: conversas e mensagens), avisos, eventos e ai_runs simulados
  delete from public.customers where id in (
    select id from public.customers
     where restaurant_id = p_restaurant and simulado and ultima_interacao_at < v_sim limit p_lote);
  get diagnostics n = row_count; n_sim := n_sim + n; v_pend := v_pend or n = p_lote;
  delete from public.attendance_notices where id in (
    select id from public.attendance_notices where restaurant_id = p_restaurant and simulado and created_at < v_sim limit p_lote);
  get diagnostics n = row_count; n_sim := n_sim + n; v_pend := v_pend or n = p_lote;
  delete from public.event_requests where id in (
    select id from public.event_requests where restaurant_id = p_restaurant and simulado and created_at < v_sim limit p_lote);
  get diagnostics n = row_count; n_sim := n_sim + n; v_pend := v_pend or n = p_lote;
  delete from public.ai_runs where id in (
    select id from public.ai_runs where restaurant_id = p_restaurant and simulado and created_at < v_sim limit p_lote);
  get diagnostics n = row_count; n_sim := n_sim + n; v_pend := v_pend or n = p_lote;

  -- mensagens vencidas; depois as conversas que ficaram vazias e também venceram, em qualquer estado (a IA nunca
  -- encerra conversa: sem isso a conversa `ia` antiga nunca sairia)
  if d_msg is not null then
    delete from public.messages where id in (
      select id from public.messages
       where restaurant_id = p_restaurant and created_at < p_agora - make_interval(days => d_msg)
       order by created_at limit p_lote);
    get diagnostics n_msgs = row_count; v_pend := v_pend or n_msgs = p_lote;
    delete from public.conversations where id in (
      select c.id from public.conversations c
       where c.restaurant_id = p_restaurant
         and c.last_message_at < p_agora - make_interval(days => d_msg)
         and not exists (select 1 from public.messages m where m.conversation_id = c.id)
       limit p_lote);
    get diagnostics n_conv = row_count; v_pend := v_pend or n_conv = p_lote;
  end if;

  -- avisos e eventos: prazo contado a partir da data do aviso/evento (no fuso do restaurante)
  if d_av is not null then
    update public.attendance_notices set customer_id = null, nome = null, anonimizado = true, updated_at = now()
     where id in (select id from public.attendance_notices
                   where restaurant_id = p_restaurant and not anonimizado and data < v_hoje - d_av limit p_lote);
    get diagnostics n_av = row_count; v_pend := v_pend or n_av = p_lote;
  end if;
  if d_ev is not null then
    update public.event_requests
       set customer_id = null, nome = null, notas_internas = null, tipo_texto = null, observacoes = null, anonimizado = true,
           updated_at = now()
     where id in (select id from public.event_requests
                   where restaurant_id = p_restaurant and not anonimizado and data < v_hoje - d_ev limit p_lote);
    get diagnostics n_ev = row_count; v_pend := v_pend or n_ev = p_lote;
  end if;

  if d_ai is not null then
    delete from public.ai_runs where id in (
      select id from public.ai_runs
       where restaurant_id = p_restaurant and created_at < p_agora - make_interval(days => d_ai)
       order by created_at limit p_lote);
    get diagnostics n_ai = row_count; v_pend := v_pend or n_ai = p_lote;
  end if;

  -- clientes inativos (sem interação nem mensagem em conversa há mais de N dias), salvo conversa com humano
  -- (`aguardando_humano`/`humano`) ou pedido do titular em aberto: mesma cascata da exclusão. Conversa `ia` não protege.
  if d_cli is not null then
    for v_cli in
      select cu.id from public.customers cu
       where cu.restaurant_id = p_restaurant and not cu.simulado
         and cu.ultima_interacao_at < p_agora - make_interval(days => d_cli)
         and not exists (select 1 from public.conversations cv
                          where cv.customer_id = cu.id
                            and (cv.estado in ('aguardando_humano', 'humano')
                                 or cv.last_message_at >= p_agora - make_interval(days => d_cli)))
         and not exists (select 1 from public.data_subject_requests d
                          where d.customer_id = cu.id and d.status in ('aberto', 'em_andamento'))
       order by cu.ultima_interacao_at
       limit p_lote
       for update skip locked
    loop
      perform app.apagar_cliente(v_cli);
      n_cli := n_cli + 1;
    end loop;
    v_pend := v_pend or n_cli = p_lote;
  end if;

  if d_aud is not null then
    delete from public.audit_log where id in (
      select id from public.audit_log
       where restaurant_id = p_restaurant and created_at < p_agora - make_interval(days => d_aud)
       order by created_at limit p_lote);
    get diagnostics n_aud = row_count; v_pend := v_pend or n_aud = p_lote;
  end if;

  return jsonb_build_object('mensagens', n_msgs, 'conversas', n_conv, 'simulacoes', n_sim, 'avisos', n_av, 'eventos', n_ev,
                            'aiRuns', n_ai, 'clientes', n_cli, 'auditoria', n_aud, 'pendente', v_pend);
end $$;--> statement-breakpoint
revoke all on function app.aplicar_retencao(uuid, timestamptz, int) from public;--> statement-breakpoint
grant execute on function app.aplicar_retencao(uuid, timestamptz, int) to worker_app;
