-- Etapa 08: RLS/grants de alertas, convites, limites e retenção; funções de exclusão do titular, resumo de acesso,
-- retenção diária e e-mails da equipe. Funções `security definer` com search_path vazio e EXECUTE só para quem precisa.

-- ============ budget_alerts: dono/gerente leem; só o worker grava ============
alter table public.budget_alerts enable row level security;--> statement-breakpoint
revoke all on public.budget_alerts from authenticated, web_app, worker_app, anon;--> statement-breakpoint
grant select on public.budget_alerts to authenticated;--> statement-breakpoint
grant select, insert on public.budget_alerts to worker_app;--> statement-breakpoint
create policy app_roles on public.budget_alerts for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy mfa_required on public.budget_alerts as restrictive for all to authenticated
  using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy gestao_read on public.budget_alerts for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));--> statement-breakpoint

-- ============ budget_limits: o dono só mexe em limite e % (cria a linha que faltar); ninguém apaga ============
revoke insert, update, delete on public.budget_limits from authenticated;--> statement-breakpoint
grant insert (restaurant_id, escopo, periodo, limite_usd, alerta_pct) on public.budget_limits to authenticated;--> statement-breakpoint
grant update (limite_usd, alerta_pct, updated_at) on public.budget_limits to authenticated;--> statement-breakpoint

-- ============ retention_settings: o dono só mexe nos dias (mínimos no check retention_dias_minimo) ============
revoke insert, update, delete on public.retention_settings from authenticated;--> statement-breakpoint
grant update (dias, updated_at) on public.retention_settings to authenticated;--> statement-breakpoint

-- ============ staff_invites: dono cria e reenvia; gerente lê; worker processa ============
alter table public.staff_invites enable row level security;--> statement-breakpoint
create or replace trigger touch_updated_at before update on public.staff_invites
  for each row execute function app.touch_updated_at();--> statement-breakpoint
revoke all on public.staff_invites from authenticated, web_app, worker_app, anon;--> statement-breakpoint
grant select on public.staff_invites to authenticated;--> statement-breakpoint
grant insert (restaurant_id, email, nome, papel, unidades, created_by) on public.staff_invites to authenticated;--> statement-breakpoint
grant update (status, erro, updated_at) on public.staff_invites to authenticated;--> statement-breakpoint
grant select on public.staff_invites to worker_app;--> statement-breakpoint
grant update (status, erro, user_id, updated_at) on public.staff_invites to worker_app;--> statement-breakpoint
create policy app_roles on public.staff_invites for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy mfa_required on public.staff_invites as restrictive for all to authenticated
  using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy gestao_read on public.staff_invites for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));--> statement-breakpoint
create policy dono_insert on public.staff_invites for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono'
    and created_by = (select auth.uid()) and status = 'pendente');--> statement-breakpoint
-- reenviar: o painel só devolve o convite a `pendente` (o worker é quem marca enviado/erro)
create policy dono_update on public.staff_invites for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono')
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) = 'dono' and status = 'pendente');--> statement-breakpoint

-- worker cria/atualiza o staff do convite aceito pelo Supabase Auth (nunca o `ativo` nem o restaurante de quem já existe)
grant insert (user_id, restaurant_id, nome, papel, unidades_permitidas) on public.staff to worker_app;--> statement-breakpoint
grant update (nome, papel, unidades_permitidas, updated_at) on public.staff to worker_app;--> statement-breakpoint

-- ============ Exclusão em cascata de um cliente (uso interno: exclusão do titular e retenção) ============
create or replace function app.apagar_cliente(p_customer uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_msgs int; n_conv int; n_av int; n_ev int;
begin
  delete from public.messages m using public.conversations c where m.conversation_id = c.id and c.customer_id = p_customer;
  get diagnostics n_msgs = row_count;
  -- ai_runs.conversation_id vira nulo (FK on delete set null): o custo fica, sem vínculo com a pessoa
  delete from public.conversations where customer_id = p_customer;
  get diagnostics n_conv = row_count;
  update public.attendance_notices set customer_id = null, nome = null, anonimizado = true, updated_at = now()
   where customer_id = p_customer;
  get diagnostics n_av = row_count;
  update public.event_requests
     set customer_id = null, nome = null, notas_internas = null, tipo_texto = null, observacoes = null, anonimizado = true,
         updated_at = now()
   where customer_id = p_customer;
  get diagnostics n_ev = row_count;
  update public.data_subject_requests set customer_id = null where customer_id = p_customer; -- o pedido fica, sem vínculo
  delete from public.customers where id = p_customer;
  return jsonb_build_object('mensagens', n_msgs, 'conversas', n_conv, 'avisos', n_av, 'eventos', n_ev);
end $$;--> statement-breakpoint
revoke all on function app.apagar_cliente(uuid) from public;--> statement-breakpoint

-- ============ Exclusão do titular (painel, como web_app): o ator tem de ser dono/gerente ativo do restaurante ============
create or replace function app.excluir_titular(p_customer uuid, p_ator uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rest uuid;
begin
  select restaurant_id into v_rest from public.customers where id = p_customer for update;
  if v_rest is null then return jsonb_build_object('ja_inexistente', true); end if;
  if not exists (select 1 from public.staff s where s.user_id = p_ator and s.restaurant_id = v_rest and s.ativo
                   and s.papel in ('dono','gerente')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  return app.apagar_cliente(p_customer);
end $$;--> statement-breakpoint
revoke all on function app.excluir_titular(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.excluir_titular(uuid, uuid) to web_app;--> statement-breakpoint

-- ============ Resumo de acesso do titular (painel, como web_app; sem telefone nem notas internas) ============
-- Lê tudo do cliente no restaurante (não só as unidades de quem pediu): a resposta ao titular é do restaurante.
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
$$;--> statement-breakpoint
revoke all on function app.resumo_titular(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.resumo_titular(uuid, uuid) to web_app;--> statement-breakpoint

-- ============ E-mails da equipe (auth.users) para dono/gerente com MFA; `entrou` = já fez login (convite aceito) ============
create or replace function app.emails_da_equipe() returns table (user_id uuid, email text, entrou boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id, u.email::text, u.last_sign_in_at is not null
    from public.staff s join auth.users u on u.id = s.user_id
   where s.restaurant_id = (select app.my_restaurant_id())
     and (select app.my_role()) in ('dono','gerente')
     and (select app.mfa_ok())
$$;--> statement-breakpoint
revoke all on function app.emails_da_equipe() from public;--> statement-breakpoint
grant execute on function app.emails_da_equipe() to authenticated;--> statement-breakpoint

-- ============ Relatório: custo real por unidade da conversa (dono/gerente com MFA, o restaurante todo) ============
-- Fora da RLS de conversations: para o gerente restrito, a conversa de outra unidade não pode cair em "sem unidade".
create or replace function app.custo_por_unidade(p_inicio timestamptz, p_fim timestamptz)
returns table (unit_id uuid, unidade text, real_usd numeric)
language sql stable security definer set search_path = '' as $$
  select c.unidade_contexto_id, u.nome, sum(r.cost_usd)
    from public.ai_runs r
    left join public.conversations c on c.id = r.conversation_id
    left join public.units u on u.id = c.unidade_contexto_id
   where r.restaurant_id = (select app.my_restaurant_id())
     and (select app.my_role()) in ('dono','gerente')
     and (select app.mfa_ok())
     and r.created_at >= p_inicio and r.created_at < p_fim
     and not r.simulado
   group by 1, 2
$$;--> statement-breakpoint
revoke all on function app.custo_por_unidade(timestamptz, timestamptz) from public;--> statement-breakpoint
grant execute on function app.custo_por_unidade(timestamptz, timestamptz) to authenticated;--> statement-breakpoint

-- ============ Retenção diária (worker), em lotes e idempotente ============
-- Cada regra apaga/anonimiza no máximo p_lote linhas; `pendente` = alguma regra bateu no lote (rodar de novo).
-- Simulações (> 7 dias) não têm prazo configurável. O audit_log continua append-only para os roles da aplicação.
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

  -- mensagens vencidas; depois as conversas encerradas que ficaram vazias e também venceram
  if d_msg is not null then
    delete from public.messages where id in (
      select id from public.messages
       where restaurant_id = p_restaurant and created_at < p_agora - make_interval(days => d_msg)
       order by created_at limit p_lote);
    get diagnostics n_msgs = row_count; v_pend := v_pend or n_msgs = p_lote;
    delete from public.conversations where id in (
      select c.id from public.conversations c
       where c.restaurant_id = p_restaurant and c.estado = 'encerrada'
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

  -- clientes inativos, sem conversa aberta, pedido do titular em aberto nem evento por vir: mesma cascata da exclusão
  if d_cli is not null then
    for v_cli in
      select cu.id from public.customers cu
       where cu.restaurant_id = p_restaurant and not cu.simulado
         and cu.ultima_interacao_at < p_agora - make_interval(days => d_cli)
         and not exists (select 1 from public.conversations cv where cv.customer_id = cu.id and cv.estado <> 'encerrada')
         and not exists (select 1 from public.data_subject_requests d
                          where d.customer_id = cu.id and d.status in ('aberto', 'em_andamento'))
         and not exists (select 1 from public.event_requests e
                          where e.customer_id = cu.id and e.status in ('novo', 'em_contato', 'confirmado') and e.data >= v_hoje)
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
