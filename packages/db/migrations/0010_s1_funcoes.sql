-- Funções IMUTÁVEIS para coluna gerada e índices de busca.
-- unaccent() e array_to_string() são STABLE; colunas geradas e índices exigem IMMUTABLE.
create or replace function app.f_unaccent(text) returns text
language sql immutable parallel safe strict set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;
--> statement-breakpoint
create or replace function app.f_juntar(text[]) returns text
language sql immutable parallel safe strict set search_path = ''
as $$ select array_to_string($1, ' ') $$;
--> statement-breakpoint
grant execute on function app.f_unaccent(text), app.f_juntar(text[]) to authenticated, web_app, worker_app;
