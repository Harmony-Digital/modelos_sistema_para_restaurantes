-- Cardápio (S4) e importações: índices de expressão, updated_at, RLS/grants por coluna (padrão 0024) e Storage.

-- ============ FKs compostas (tenant): item na categoria do mesmo restaurante; exceção do item do mesmo restaurante ============
-- Aqui e não na 0026 porque o drizzle-kit cria as FKs antes dos índices únicos que elas referenciam.
alter table public.menu_items add constraint menu_items_category_fk
  foreign key (category_id, restaurant_id) references public.menu_categories (id, restaurant_id) on delete cascade;--> statement-breakpoint
alter table public.menu_item_units add constraint menu_item_units_item_fk
  foreign key (item_id, restaurant_id) references public.menu_items (id, restaurant_id) on delete cascade;--> statement-breakpoint

-- ============ Índices de expressão ============
-- nome único sem diferenciar caixa/acento (mesma normalização dos índices trigram da 0012)
create unique index menu_categories_restaurant_nome_uq on public.menu_categories (restaurant_id, app.f_unaccent(lower(nome)));--> statement-breakpoint
create unique index menu_items_category_nome_uq on public.menu_items (category_id, app.f_unaccent(lower(nome)));--> statement-breakpoint
-- busca por erro de digitação (pg_trgm) em nome e outros nomes
create index menu_items_nome_trgm_idx on public.menu_items
  using gin (app.f_unaccent(lower(nome)) extensions.gin_trgm_ops);--> statement-breakpoint
create index menu_items_outros_nomes_trgm_idx on public.menu_items
  using gin (app.f_unaccent(lower(app.f_juntar(outros_nomes))) extensions.gin_trgm_ops);--> statement-breakpoint
-- dedup de arquivo de cardápio: mesmo sha256 no mesmo escopo (geral = unit_id nulo, ou a unidade)
create unique index menu_files_escopo_sha256_uq on public.menu_files (restaurant_id, unit_id, sha256) nulls not distinct;--> statement-breakpoint

-- ============ updated_at automático ============
do $$ declare t text; begin
  foreach t in array array['menu_categories','menu_items','menu_item_units','menu_files','knowledge_documents'] loop
    execute format('create or replace trigger touch_updated_at before update on public.%I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;--> statement-breakpoint

-- ============ RLS + MFA + roles de aplicação ============
do $$ declare t text; begin
  foreach t in array array['menu_categories','menu_items','menu_item_units','menu_files','knowledge_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated
                    using ((select app.mfa_ok())) with check ((select app.mfa_ok()))', t);
    execute format('create policy app_roles on public.%I for all to web_app, worker_app using (true) with check (true)', t);
  end loop;
end $$;--> statement-breakpoint

-- Cardápio geral (categorias e itens): equipe lê; escreve dono/gerente que acessa todas as unidades
-- (gerente restrito a unidades só mexe nas exceções da sua unidade).
create policy equipe_read on public.menu_categories for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));--> statement-breakpoint
create policy gestao_write on public.menu_categories for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and (select app.acesso_todas_unidades()))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and (select app.acesso_todas_unidades()));--> statement-breakpoint
create policy equipe_read on public.menu_items for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()));--> statement-breakpoint
create policy gestao_write on public.menu_items for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and (select app.acesso_todas_unidades()))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente') and (select app.acesso_todas_unidades()));--> statement-breakpoint

-- Exceções por unidade: leitura e escrita respeitam a permissão por unidade
create policy equipe_read on public.menu_item_units for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_write on public.menu_item_units for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint

-- Arquivos de envio: geral (unit_id nulo) visível a todos, escrito só por quem acessa todas; caminho na pasta do restaurante
create policy equipe_read on public.menu_files for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and (unit_id is null or (select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_write on public.menu_files for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[]))
    and split_part(storage_path, '/', 2) = restaurant_id::text);--> statement-breakpoint

-- Importações: só dono/gerente. Nascem enviado (arquivo) ou rascunho (CSV) em nome de quem envia;
-- o painel só conclui (rascunho/erro ⇒ aprovado/rejeitado). Processar é do worker.
create policy gestao_read on public.knowledge_documents for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));--> statement-breakpoint
create policy gestao_insert on public.knowledge_documents for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and enviado_por = (select auth.uid()) and revisado_por is null and revisado_at is null
    and ((origem = 'csv' and status = 'rascunho') or (origem = 'arquivo' and status = 'enviado' and draft is null))
    and (storage_path is null or split_part(storage_path, '/', 2) = restaurant_id::text));--> statement-breakpoint
create policy gestao_update on public.knowledge_documents for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and status in ('rascunho','erro'))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and status in ('aprovado','rejeitado') and revisado_por = (select auth.uid()));--> statement-breakpoint

-- ============ Grants (por coluna para authenticated; sem DELETE para ninguém) ============
revoke all on public.menu_categories, public.menu_items, public.menu_item_units, public.menu_files, public.knowledge_documents
  from authenticated, web_app, worker_app;--> statement-breakpoint
grant select on public.menu_categories, public.menu_items, public.menu_item_units, public.menu_files, public.knowledge_documents
  to authenticated, web_app, worker_app;--> statement-breakpoint
grant insert (restaurant_id, nome, ordem, ativo) on public.menu_categories to authenticated;--> statement-breakpoint
grant update (nome, ordem, ativo, updated_at) on public.menu_categories to authenticated;--> statement-breakpoint
grant insert (restaurant_id, category_id, nome, descricao, preco_centavos, tags, outros_nomes, disponivel, ordem) on public.menu_items to authenticated;--> statement-breakpoint
grant update (category_id, nome, descricao, preco_centavos, tags, outros_nomes, disponivel, ordem, updated_at) on public.menu_items to authenticated;--> statement-breakpoint
grant insert (item_id, unit_id, restaurant_id, disponivel, preco_override_centavos) on public.menu_item_units to authenticated;--> statement-breakpoint
grant update (disponivel, preco_override_centavos, updated_at) on public.menu_item_units to authenticated;--> statement-breakpoint
grant insert (restaurant_id, unit_id, titulo, storage_path, mime, tamanho, sha256, ativo) on public.menu_files to authenticated;--> statement-breakpoint
grant update (titulo, ativo, updated_at) on public.menu_files to authenticated;--> statement-breakpoint
grant insert (restaurant_id, origem, status, storage_path, mime, tamanho, sha256, draft, enviado_por) on public.knowledge_documents to authenticated;--> statement-breakpoint
grant update (status, draft, revisado_por, revisado_at, updated_at) on public.knowledge_documents to authenticated;--> statement-breakpoint
grant insert, update on public.menu_categories, public.menu_items, public.menu_item_units, public.menu_files, public.knowledge_documents to web_app;--> statement-breakpoint
-- busca do cardápio (pg_trgm/unaccent ficam no schema extensions; authenticated já tem USAGE pelo Supabase)
grant usage on schema extensions to web_app, worker_app;--> statement-breakpoint
-- worker: lê o cardápio; grava só o cache de mídia da Meta e o resultado da leitura do documento
grant update (wa_media_id, wa_media_expires_at, updated_at) on public.menu_files to worker_app;--> statement-breakpoint
grant update (status, draft, erro, updated_at) on public.knowledge_documents to worker_app;--> statement-breakpoint

-- ============ Storage: buckets privados + policies por papel ============
-- Objeto: `<restaurant_id>/<arquivo>` dentro do bucket. Até 20 MB; PDF, JPEG, PNG, WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('cardapio', 'cardapio', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  ('importacoes', 'importacoes', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;--> statement-breakpoint
-- leitura: arquivo de envio para a equipe; documento importado só para dono/gerente
create policy atd_cardapio_select on storage.objects for select to authenticated
  using (bucket_id = 'cardapio'
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.mfa_ok()));--> statement-breakpoint
create policy atd_importacoes_select on storage.objects for select to authenticated
  using (bucket_id = 'importacoes'
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.my_role()) in ('dono','gerente')
    and (select app.mfa_ok()));--> statement-breakpoint
-- envio: dono/gerente, só na pasta do próprio restaurante. Sem UPDATE/DELETE (novo arquivo = novo objeto).
create policy atd_cardapio_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('cardapio', 'importacoes')
    and (storage.foldername(name))[1] = (select app.my_restaurant_id())::text
    and (select app.my_role()) in ('dono','gerente')
    and (select app.mfa_ok()));
