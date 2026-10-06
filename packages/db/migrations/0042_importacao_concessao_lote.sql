ALTER TABLE "knowledge_documents" ADD COLUMN "lote_lendo_desde" timestamp with time zone;--> statement-breakpoint
-- (manual) o worker grava e limpa a concessão do lote
grant update (lote_lendo_desde) on public.knowledge_documents to worker_app;--> statement-breakpoint
-- (manual) guarda da importação com as transições de status válidas (todos os papéis), além do hash imutável:
-- enviado → processando | rejeitado; processando → rascunho | erro; rascunho → aprovado | rejeitado; erro → rejeitado.
-- Sem hash (vários arquivos ainda recebendo) só sai de enviado para rejeitado. Fecha a combinação das policies
-- gestao_iniciar + gestao_update (gravar hash e aprovar sem leitura num UPDATE só).
create or replace function app.knowledge_documents_guarda() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'hash da importação é imutável' using errcode = '42501';
  end if;
  if new.status <> old.status and not (
       (old.status = 'enviado' and new.status in ('processando', 'rejeitado'))
    or (old.status = 'processando' and new.status in ('rascunho', 'erro'))
    or (old.status = 'rascunho' and new.status in ('aprovado', 'rejeitado'))
    or (old.status = 'erro' and new.status = 'rejeitado')
  ) then
    raise exception 'transição de status da importação inválida' using errcode = '42501';
  end if;
  if new.status not in ('enviado', 'rejeitado') and new.sha256 is null then
    raise exception 'importação ainda não iniciada' using errcode = '42501';
  end if;
  return new;
end $$;
