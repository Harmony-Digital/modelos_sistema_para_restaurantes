-- Bucket `marca` (0046): se já existia (ex.: criado à mão no hospedado), `on conflict do nothing` deixava a configuração
-- antiga. Aqui a configuração da spec §7 vale sempre: público, até 1 MB, só PNG/JPEG/WebP (sem SVG).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('marca', 'marca', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
