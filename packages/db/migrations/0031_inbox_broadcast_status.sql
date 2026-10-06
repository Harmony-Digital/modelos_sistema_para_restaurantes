-- Realtime da inbox (revisão do Bloco A): status de entrega ao vivo na conversa aberta e aviso à unidade antiga
-- quando a conversa troca de unidade. Payload continua só com ids.
create or replace function app.inbox_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; payload jsonb;
begin
  if tg_table_name = 'messages' then
    select id, restaurant_id, unidade_contexto_id into c from public.conversations where id = new.conversation_id;
    if not found then return null; end if;
    payload := jsonb_build_object('conversation_id', c.id, 'evento', lower(tg_table_name || '_' || tg_op));
    -- mudança de status_envio (enviando/enviado/falhou) só interessa à conversa aberta
    if tg_op = 'UPDATE' then
      perform realtime.send(payload, 'mudou', 'conversa:' || c.id, true);
      return null;
    end if;
  else
    if tg_op = 'UPDATE' and new.estado is not distinct from old.estado and new.atendente_id is not distinct from old.atendente_id
       and new.last_message_at is not distinct from old.last_message_at and new.unidade_contexto_id is not distinct from old.unidade_contexto_id then
      return null;
    end if;
    c := new;
    payload := jsonb_build_object('conversation_id', c.id, 'evento', lower(tg_table_name || '_' || tg_op));
    -- a unidade antiga perde a conversa: avisa para a lista dela recarregar
    if tg_op = 'UPDATE' and old.unidade_contexto_id is not null
       and old.unidade_contexto_id is distinct from new.unidade_contexto_id then
      perform realtime.send(payload, 'mudou', 'inbox:u:' || old.unidade_contexto_id, true);
    end if;
  end if;
  perform realtime.send(payload, 'mudou', 'inbox:r:' || c.restaurant_id, true);
  if c.unidade_contexto_id is not null then
    perform realtime.send(payload, 'mudou', 'inbox:u:' || c.unidade_contexto_id, true);
  end if;
  perform realtime.send(payload, 'mudou', 'conversa:' || c.id, true);
  return null;
end $$;--> statement-breakpoint
revoke all on function app.inbox_broadcast() from public;--> statement-breakpoint
create trigger messages_status_broadcast after update of status_envio on public.messages
  for each row when (old.status_envio is distinct from new.status_envio)
  execute function app.inbox_broadcast();
