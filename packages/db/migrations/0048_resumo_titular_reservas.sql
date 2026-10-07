-- Revisão final de reservas-logo (I2): o resumo de acesso do titular traz, de cada reserva, o nome, o horário (HH:MM)
-- e se há telefone de contato informado (sim/não). O número decifrado nunca entra (ruling: só pelo "ver contato"
-- auditado). Mesma função da 0036, só com os três campos a mais em `avisos`.
create or replace function app.resumo_titular(p_customer uuid, p_restaurant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'nomePerfil', c.nome_perfil,
    'primeiraInteracao', to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'ultimaInteracao', to_char(c.ultima_interacao_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'conversas', (select count(*) from public.conversations cv where cv.customer_id = c.id),
    'mensagens', (select count(*) from public.messages m join public.conversations cv on cv.id = m.conversation_id
                   where cv.customer_id = c.id),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('data', a.data, 'pessoas', a.pessoas, 'status', a.status, 'unidade', u.nome,
                                                            'nome', a.nome, 'horario', to_char(a.horario, 'HH24:MI'),
                                                            'contatoInformado', a.contato_cifrado is not null)
                                         order by a.data, a.created_at)
                          from public.attendance_notices a join public.units u on u.id = a.unit_id
                         where a.customer_id = c.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('data', e.data, 'convidados', e.convidados, 'tipo', e.tipo,
                                                             'status', e.status, 'unidade', u.nome)
                                          order by e.data, e.created_at)
                           from public.event_requests e join public.units u on u.id = e.unit_id
                          where e.customer_id = c.id), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('tipo', d.tipo, 'status', d.status,
                                                             'criadoEm', to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                                          order by d.created_at, d.id)
                           from public.data_subject_requests d where d.customer_id = c.id), '[]'::jsonb)
  )
  from public.customers c
  where c.id = p_customer and c.restaurant_id = p_restaurant
    and exists (select 1 from public.staff s
                 where s.user_id = (select auth.uid()) and s.restaurant_id = p_restaurant and s.ativo
                   and s.papel in ('dono','gerente'))
$$;
