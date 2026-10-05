create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create schema if not exists app;
-- trigger genérica de updated_at, usada por todas as tabelas
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
