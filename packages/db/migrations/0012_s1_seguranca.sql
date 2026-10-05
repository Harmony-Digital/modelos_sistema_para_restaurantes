-- ============ Índices de busca (painel, plano 02-C) ============
create index units_nome_trgm_idx on public.units
  using gin (app.f_unaccent(lower(nome)) extensions.gin_trgm_ops);
create index units_apelidos_trgm_idx on public.units
  using gin (app.f_unaccent(lower(app.f_juntar(apelidos))) extensions.gin_trgm_ops);
create index knowledge_facts_tema_trgm_idx on public.knowledge_facts
  using gin (app.f_unaccent(lower(tema)) extensions.gin_trgm_ops);

-- ============ Lacuna aberta única (unidade nula conta como valor) ============
create unique index knowledge_gaps_aberta_uq on public.knowledge_gaps (restaurant_id, chave_normalizada, unit_id)
  nulls not distinct where status = 'aberta';

-- ============ updated_at automático nas tabelas novas ============
do $$ declare t text; begin
  foreach t in array array['unit_hours','unit_hour_exceptions','knowledge_facts','reply_templates','knowledge_gaps'] loop
    execute format('create or replace trigger touch_updated_at before update on public.%I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ============ Permissão por unidade ============
-- dono: todas; demais com unidades_permitidas vazio: todas; senão só as listadas.
-- uid NULL (registro "de todas as unidades") ⇒ só quem acessa todas.
create or replace function app.can_access_unit(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.papel = 'dono' or cardinality(s.unidades_permitidas) = 0 or uid = any (s.unidades_permitidas)
      from public.staff s
     where s.user_id = (select auth.uid()) and s.ativo
  ), false)
$$;
revoke all on function app.can_access_unit(uuid) from public;
grant execute on function app.can_access_unit(uuid) to authenticated;

-- ============ RLS + barreira MFA + roles de aplicação (padrão da 0004) ============
do $$ declare t text; begin
  foreach t in array array['unit_hours','unit_hour_exceptions','knowledge_facts','reply_templates','knowledge_gaps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated
                    using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
    execute format('create policy app_roles on public.%I for all to web_app, worker_app using (true) with check (true)', t);
  end loop;
end $$;

-- units: passa a respeitar unidades permitidas
drop policy staff_read on public.units;
create policy staff_read on public.units for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and app.can_access_unit(id));
drop policy gestao_write on public.units;
create policy gestao_write on public.units for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(id))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(id));

-- horários e exceções: por unidade
do $$ declare t text; begin
  foreach t in array array['unit_hours','unit_hour_exceptions'] loop
    execute format('create policy staff_read on public.%I for select to authenticated
      using (restaurant_id = (select app.my_restaurant_id()) and app.can_access_unit(unit_id))', t);
    execute format('create policy gestao_write on public.%I for all to authenticated
      using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'') and app.can_access_unit(unit_id))
      with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'') and app.can_access_unit(unit_id))', t);
  end loop;
end $$;

-- fatos: leitura de gerais + das unidades permitidas; escrita respeita unidade (geral ⇒ só quem acessa todas)
create policy staff_read on public.knowledge_facts for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (unit_id is null or app.can_access_unit(unit_id)));
create policy gestao_write on public.knowledge_facts for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(unit_id))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(unit_id));

-- modelos de texto: equipe lê; dono/gerente escrevem
create policy staff_read on public.reply_templates for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));
create policy gestao_write on public.reply_templates for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));

-- lacunas: equipe lê (por unidade); dono/gerente mudam status; só o worker cria
create policy staff_read on public.knowledge_gaps for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (unit_id is null or app.can_access_unit(unit_id)));
create policy gestao_update on public.knowledge_gaps for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(unit_id))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and app.can_access_unit(unit_id));

-- ============ Grants por coluna (painel): nunca trocar id/restaurant_id ============
revoke update on public.units, public.unit_hours, public.unit_hour_exceptions, public.knowledge_facts,
  public.reply_templates, public.knowledge_gaps from authenticated;
grant update (nome, slug, ativo, endereco, bairro, cidade, uf, cep, lat, lng, maps_url, telefone, apelidos, ordem)
  on public.units to authenticated;
grant update (weekday, turno, abre, fecha) on public.unit_hours to authenticated;
grant update (data, fechado, turnos, motivo) on public.unit_hour_exceptions to authenticated;
grant update (unit_id, tema, exemplos, texto, ativo) on public.knowledge_facts to authenticated;
grant update (texto) on public.reply_templates to authenticated;
grant update (status, fact_id) on public.knowledge_gaps to authenticated;
revoke insert, delete on public.knowledge_gaps from authenticated;

-- ============ worker_app ============
grant select on public.unit_hours, public.unit_hour_exceptions, public.knowledge_facts, public.reply_templates to worker_app;
grant select, insert on public.knowledge_gaps to worker_app;
grant update (ocorrencias, ultima_vez, pergunta_mascarada) on public.knowledge_gaps to worker_app;
