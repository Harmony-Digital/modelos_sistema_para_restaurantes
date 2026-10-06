-- Importação por alvo (Etapa 07): arquivos por importação (FK de tenant, RLS, grants), início da leitura pelo painel,
-- progresso por lote pelo worker e guarda das transições.

-- ============ FK composta (tenant): arquivo da importação do mesmo restaurante ============
-- Aqui e não na 0040 porque o drizzle-kit cria as FKs antes dos índices únicos que elas referenciam.
alter table public.knowledge_document_files add constraint knowledge_document_files_importacao_fk
  foreign key (importacao_id, restaurant_id) references public.knowledge_documents (id, restaurant_id) on delete cascade;--> statement-breakpoint

create or replace trigger touch_updated_at before update on public.knowledge_document_files
  for each row execute function app.touch_updated_at();--> statement-breakpoint

-- ============ Guarda da importação (todos os papéis) ============
-- O hash (do arquivo ou do conjunto) não muda depois de gravado; nada volta a `enviado`; a importação de vários
-- arquivos só sai de `enviado` depois de iniciada (hash gravado) — exceto descartada.
create or replace function app.knowledge_documents_guarda() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'hash da importação é imutável' using errcode = '42501';
  end if;
  if new.status = 'enviado' and old.status <> 'enviado' then
    raise exception 'importação não volta a enviado' using errcode = '42501';
  end if;
  if new.status not in ('enviado', 'rejeitado') and new.sha256 is null then
    raise exception 'importação ainda não iniciada' using errcode = '42501';
  end if;
  return new;
end $$;--> statement-breakpoint
create trigger knowledge_documents_guarda before update on public.knowledge_documents
  for each row execute function app.knowledge_documents_guarda();--> statement-breakpoint

-- ============ knowledge_documents: iniciar a leitura (painel) e progresso (worker) ============
-- Enquanto recebe arquivos (enviado, sem hash), dono/gerente grava o hash do conjunto ao clicar "Ler arquivos".
create policy gestao_iniciar on public.knowledge_documents for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and status = 'enviado' and sha256 is null)
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and status = 'enviado' and draft is null);--> statement-breakpoint
grant insert (alvo, modo) on public.knowledge_documents to authenticated;--> statement-breakpoint
grant update (sha256) on public.knowledge_documents to authenticated;--> statement-breakpoint
grant update (lote_atual, lotes_total, draft_parcial) on public.knowledge_documents to worker_app;--> statement-breakpoint

-- ============ knowledge_document_files: RLS ============
alter table public.knowledge_document_files enable row level security;--> statement-breakpoint
create policy mfa_required on public.knowledge_document_files as restrictive for all to authenticated
  using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy app_roles on public.knowledge_document_files for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy gestao_read on public.knowledge_document_files for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente'));--> statement-breakpoint
-- só mudam enquanto a importação recebe arquivos (enviado, hash do conjunto ainda não gravado)
create policy gestao_insert on public.knowledge_document_files for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and split_part(storage_path, '/', 2) = restaurant_id::text
    and exists (select 1 from public.knowledge_documents d
                where d.id = knowledge_document_files.importacao_id and d.restaurant_id = knowledge_document_files.restaurant_id
                  and d.origem = 'arquivo' and d.storage_path is null and d.status = 'enviado' and d.sha256 is null));--> statement-breakpoint
create policy gestao_update on public.knowledge_document_files for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and exists (select 1 from public.knowledge_documents d
                where d.id = knowledge_document_files.importacao_id and d.status = 'enviado' and d.sha256 is null))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and exists (select 1 from public.knowledge_documents d
                where d.id = knowledge_document_files.importacao_id and d.status = 'enviado' and d.sha256 is null));--> statement-breakpoint
create policy gestao_delete on public.knowledge_document_files for delete to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and exists (select 1 from public.knowledge_documents d
                where d.id = knowledge_document_files.importacao_id and d.status = 'enviado' and d.sha256 is null));--> statement-breakpoint

-- ============ knowledge_document_files: grants (por coluna para authenticated) ============
revoke all on public.knowledge_document_files from authenticated, web_app, worker_app;--> statement-breakpoint
grant select on public.knowledge_document_files to authenticated, web_app, worker_app;--> statement-breakpoint
grant insert (restaurant_id, importacao_id, ordem, storage_path, mime, tamanho, sha256) on public.knowledge_document_files to authenticated;--> statement-breakpoint
grant update (ordem, updated_at) on public.knowledge_document_files to authenticated;--> statement-breakpoint
grant delete on public.knowledge_document_files to authenticated;--> statement-breakpoint
grant insert, update on public.knowledge_document_files to web_app;--> statement-breakpoint
-- worker: só as páginas do PDF
grant update (paginas, updated_at) on public.knowledge_document_files to worker_app;
