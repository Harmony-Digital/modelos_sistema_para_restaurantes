-- Reserva com lotação e logo (spec 2026-10-07 §2, §3, §6, §7): grants, policies, trava da unidade, bucket `marca` e
-- retenção/exclusão que também anulam o contato cifrado.

-- ============ attendance_notices (reserva) ============
-- o painel cria a reserva com horário e contato (cifrado no servidor); o resto das colunas segue o grant da 0022
grant insert (horario, contato_cifrado) on public.attendance_notices to authenticated;--> statement-breakpoint
-- o painel muda o status para confirmada, cancelada ou não veio (reconfirmar passa pela lotação na DAL, com a unidade
-- travada); continua só a coluna status (0020) e a mesma regra de papel e unidade
drop policy gestao_update on public.attendance_notices;--> statement-breakpoint
create policy gestao_update on public.attendance_notices for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint

-- ============ units: lotação editável por dono/gerente (policy gestao_write da 0016) ============
grant update (capacidade_pessoas) on public.units to authenticated;--> statement-breakpoint

-- Trava da unidade para a lotação no worker: SELECT ... FOR UPDATE exige UPDATE na tabela, que o worker não tem (nem
-- deve ter). A função só trava a linha e devolve a capacidade; nenhuma linha = unidade de outro restaurante/inexistente.
-- O painel (authenticated) trava direto, pela policy gestao_write.
create or replace function app.travar_unidade_reserva(p_restaurant uuid, p_unit uuid)
returns table (capacidade smallint)
language sql volatile security definer set search_path = '' as $$
  select u.capacidade_pessoas from public.units u
   where u.id = p_unit and u.restaurant_id = p_restaurant
     for update
$$;--> statement-breakpoint
revoke all on function app.travar_unidade_reserva(uuid, uuid) from public;--> statement-breakpoint
grant execute on function app.travar_unidade_reserva(uuid, uuid) to worker_app;--> statement-breakpoint

-- ============ restaurants: regras da reserva e logo (dono e gerente) ============
-- dono já atualiza tudo (dono_update, 0004). O gerente passa a atualizar a linha do próprio restaurante, mas o gatilho
-- abaixo recusa qualquer coluna além de regras_reserva, logo_path e updated_at.
create policy gerente_update_marca on public.restaurants for update to authenticated
  using (id = (select app.my_restaurant_id()) and (select app.my_role()) = 'gerente')
  with check (id = (select app.my_restaurant_id()) and (select app.my_role()) = 'gerente');--> statement-breakpoint
create or replace function app.restaurants_gerente_so_marca() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and (select app.my_role()) = 'gerente'
     and (to_jsonb(new) - 'regras_reserva' - 'logo_path' - 'updated_at')
         is distinct from (to_jsonb(old) - 'regras_reserva' - 'logo_path' - 'updated_at') then
    raise exception 'gerente só altera regras da reserva e logo' using errcode = '42501';
  end if;
  return new;
end $$;--> statement-breakpoint
create trigger restaurants_gerente_so_marca before update on public.restaurants
  for each row execute function app.restaurants_gerente_so_marca();--> statement-breakpoint

-- ============ Storage: bucket público `marca` (logo não é dado pessoal) ============
-- Objeto: `<restaurant_id>/logo-<sha256>.<ext>`. Até 1 MB; PNG, JPEG, WebP (sem SVG). Leitura pública pela URL do
-- bucket; gravar e remover só dono/gerente com MFA, na pasta do próprio restaurante. Sem UPDATE (troca = objeto novo).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('marca', 'marca', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;--> statement-breakpoint
create policy atd_marca_select on storage.objects for select to authenticated
  using (bucket_id = 'marca'
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.my_role()) in ('dono','gerente')
    and (select app.mfa_ok()));--> statement-breakpoint
create policy atd_marca_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'marca'
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.my_role()) in ('dono','gerente')
    and (select app.mfa_ok()));--> statement-breakpoint
create policy atd_marca_delete on storage.objects for delete to authenticated
  using (bucket_id = 'marca'
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.my_role()) in ('dono','gerente')
    and (select app.mfa_ok()));--> statement-breakpoint

-- ============ LGPD: exclusão do titular e retenção também anulam o contato da reserva ============
create or replace function app.apagar_cliente(p_customer uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_msgs int; n_conv int; n_av int; n_ev int;
begin
  delete from public.messages m using public.conversations c where m.conversation_id = c.id and c.customer_id = p_customer;
  get diagnostics n_msgs = row_count;
  -- ai_runs.conversation_id vira nulo (FK on delete set null): o custo fica, sem vínculo com a pessoa
  delete from public.conversations where customer_id = p_customer;
  get diagnostics n_conv = row_count;
  update public.attendance_notices set customer_id = null, nome = null, contato_cifrado = null, anonimizado = true, updated_at = now()
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
    update public.attendance_notices set customer_id = null, nome = null, contato_cifrado = null, anonimizado = true, updated_at = now()
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
