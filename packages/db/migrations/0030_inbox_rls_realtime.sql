-- Etapa 06 (inbox): visibilidade por unidade da conversa, respostas rápidas, Realtime privado sem conteúdo,
-- espera em `aguardando_humano` e métrica "tempo até assumir".

-- ============ Conversas e mensagens: visibilidade por unidade (initplan) ============
-- Unidade da conversa = unidade_contexto_id. Sem unidade ⇒ só quem acessa todas as unidades.
drop policy staff_read on public.conversations;--> statement-breakpoint
create policy staff_read on public.conversations for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unidade_contexto_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
drop policy staff_update on public.conversations;--> statement-breakpoint
create policy staff_update on public.conversations for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unidade_contexto_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unidade_contexto_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
drop policy staff_read on public.messages;--> statement-breakpoint
create policy staff_read on public.messages for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or conversation_id in (
      select c.id from public.conversations c
       where c.restaurant_id = (select app.my_restaurant_id())
         and c.unidade_contexto_id = any ((select app.minhas_unidades())::uuid[]))));--> statement-breakpoint
-- painel escreve em conversations/messages pela DAL como web_app (com a mesma regra de visibilidade no WHERE);
-- authenticated continua só com estado/atendente_id (0006) e sem INSERT/DELETE em messages
revoke delete, truncate on public.conversations, public.messages from authenticated;--> statement-breakpoint
revoke insert on public.messages from authenticated;--> statement-breakpoint

-- ============ Espera em aguardando_humano ============
-- Entrar em aguardando_humano marca o início (se ninguém marcou); sair zera. A DAL lê o valor anterior ao assumir.
create or replace function app.marcar_aguardando() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.estado = 'aguardando_humano' then
    if tg_op = 'INSERT' or old.estado is distinct from 'aguardando_humano' then
      new.aguardando_desde := coalesce(new.aguardando_desde, now());
    end if;
  else
    new.aguardando_desde := null;
  end if;
  return new;
end $$;--> statement-breakpoint
create trigger conversations_marcar_aguardando before insert or update of estado, aguardando_desde on public.conversations
  for each row execute function app.marcar_aguardando();--> statement-breakpoint
-- conversas já em espera antes desta migration
update public.conversations set aguardando_desde = last_message_at where estado = 'aguardando_humano' and aguardando_desde is null;--> statement-breakpoint

-- ============ Respostas rápidas ============
create or replace trigger touch_updated_at before update on public.quick_replies
  for each row execute function app.touch_updated_at();--> statement-breakpoint
alter table public.quick_replies enable row level security;--> statement-breakpoint
create policy mfa_required on public.quick_replies as restrictive for all to authenticated
  using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy app_roles on public.quick_replies for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy equipe_read on public.quick_replies for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));--> statement-breakpoint
create policy gestao_write on public.quick_replies for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));--> statement-breakpoint
revoke all on public.quick_replies from authenticated, web_app, worker_app, anon;--> statement-breakpoint
grant select on public.quick_replies to authenticated, web_app;--> statement-breakpoint
grant insert (restaurant_id, titulo, texto, ordem, ativo) on public.quick_replies to authenticated;--> statement-breakpoint
grant update (titulo, texto, ordem, ativo, updated_at) on public.quick_replies to authenticated;--> statement-breakpoint

-- ============ Métrica: tempo até assumir (hoje, só conversas reais) ============
-- audit_log só é lido pelo dono (RLS); a métrica vai para dono e gerente por esta função (mediana em segundos).
create or replace function app.tempo_ate_assumir_hoje() returns double precision
language sql stable security definer set search_path = '' as $$
  select percentile_cont(0.5) within group (
           order by extract(epoch from (a.created_at - (a.diff ->> 'aguardandoDesde')::timestamptz)))
    from public.audit_log a
    join public.restaurants r on r.id = a.restaurant_id
   where a.restaurant_id = (select app.my_restaurant_id())
     and (select app.mfa_ok())
     and a.acao = 'conversa.assumida'
     and a.diff ->> 'aguardandoDesde' is not null
     and a.diff ->> 'simulada' = 'false'
     and a.created_at >= (date_trunc('day', now() at time zone r.timezone) at time zone r.timezone)
$$;--> statement-breakpoint
revoke all on function app.tempo_ate_assumir_hoje() from public;--> statement-breakpoint
grant execute on function app.tempo_ate_assumir_hoje() to authenticated;--> statement-breakpoint

-- ============ Realtime: broadcast privado sem conteúdo ============
-- Payload só com ids ({ conversation_id, evento } + id da mensagem do Realtime); o painel relê pela DAL (RLS).
create or replace function app.inbox_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; payload jsonb;
begin
  if tg_table_name = 'messages' then
    select id, restaurant_id, unidade_contexto_id into c from public.conversations where id = new.conversation_id;
    if not found then return null; end if;
  else
    if tg_op = 'UPDATE' and new.estado is not distinct from old.estado and new.atendente_id is not distinct from old.atendente_id
       and new.last_message_at is not distinct from old.last_message_at and new.unidade_contexto_id is not distinct from old.unidade_contexto_id then
      return null;
    end if;
    c := new;
  end if;
  payload := jsonb_build_object('conversation_id', c.id, 'evento', lower(tg_table_name || '_' || tg_op));
  perform realtime.send(payload, 'mudou', 'inbox:r:' || c.restaurant_id, true);
  if c.unidade_contexto_id is not null then
    perform realtime.send(payload, 'mudou', 'inbox:u:' || c.unidade_contexto_id, true);
  end if;
  perform realtime.send(payload, 'mudou', 'conversa:' || c.id, true);
  return null;
end $$;--> statement-breakpoint
revoke all on function app.inbox_broadcast() from public;--> statement-breakpoint
create trigger conversations_inbox_broadcast after insert or update on public.conversations
  for each row execute function app.inbox_broadcast();--> statement-breakpoint
create trigger messages_inbox_broadcast after insert on public.messages
  for each row execute function app.inbox_broadcast();--> statement-breakpoint

-- Autorização: só escuta (SELECT); sem policy de INSERT, ninguém do navegador publica.
-- Tópico malformado nunca chega ao ::uuid (CASE avalia a regex antes): vira nulo e nega.
create policy inbox_listen on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and (select app.mfa_ok()) and (
    ((select realtime.topic()) = 'inbox:r:' || (select app.my_restaurant_id())::text and (select app.acesso_todas_unidades()))
    or (case when (select realtime.topic()) ~ '^inbox:u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then substr((select realtime.topic()), 9)::uuid end) = any ((select app.minhas_unidades())::uuid[])
    or exists (
      select 1 from public.conversations cv
       where cv.id = (case when (select realtime.topic()) ~ '^conversa:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then substr((select realtime.topic()), 10)::uuid end)
         and cv.restaurant_id = (select app.my_restaurant_id())
         and ((select app.acesso_todas_unidades()) or cv.unidade_contexto_id = any ((select app.minhas_unidades())::uuid[])))
  )
);
