# Etapa 02-C — Telas de Unidades e Respostas, Início completo e simulador ligado ao pipeline real

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o dono/gerente cadastra no painel tudo o que a IA usa para responder S1 (unidades, horários, exceções, informações, textos), responde as perguntas que a IA não soube, acompanha o "% respondido pela IA" e testa tudo num simulador de WhatsApp que passa pelo **mesmo pipeline real** do atendimento.

**Architecture:** o painel lê e grava sob RLS (`withUserContext`) com auditoria na mesma transação, por funções em `packages/db/src/painel-*.ts`; as telas são Server Components que chamam essas funções, e os formulários são Client Components (React Hook Form + o mesmo schema Zod no cliente e na Server Action). O simulador grava a mensagem como uma conversa `simulada` (cliente `sim:<usuário>:<n>`), enfileira o mesmo job do webhook, e o worker processa normalmente; só a **entrega** muda: conversa simulada nunca chama a Meta (adaptador de canal "simulador"). O painel consulta as mensagens por polling de ~1 s numa Server Action autenticada. Um relógio simulado (deslocamento em segundos guardado na conversa) vale só para a resolução de S1 daquela conversa.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Tailwind v4 + shadcn/ui, React Hook Form 7 + Zod 4, Drizzle 0.45, Postgres (Supabase), pg-boss 12, Vitest 5, Playwright 1.63.

**Spec:** [docs/specs/2026-10-05-etapa-02-s1-design.md](../specs/2026-10-05-etapa-02-s1-design.md) (§4 Painel, §5.3 Simulador, §6.2 E2E, §7 critério de pronto; escopo 02-C em §8). PRD §10 (invariantes) vence qualquer conflito.

## Global Constraints

- Branch: `etapa-02c-painel-simulador` (criada a partir da `main` atualizada, com o 02-B mesclado). Nunca commitar na `main`, nunca `git push --force`.
- Commits pequenos, em português no imperativo, terminando com a linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Textos de UI em pt-BR; identificadores seguem o arquivo vizinho (domínio S1 em português).
- **Toda Server Action** chama `requireStaff(...)` primeiro (com os papéis exigidos), valida a entrada com o **mesmo schema Zod** usado no formulário e devolve `ActionResult` (`apps/web/lib/action-result.ts`). Nunca confiar só no `proxy.ts`.
- **Toda mutação do painel grava `audit_log`** (ator, ação, entidade, `diff`) **na mesma transação** (`withUserContext`). Nada de PII no `diff`.
- Escrita do painel: só `dono`/`gerente` (o restaurante: só `dono`); `atendente` só lê. Permissão por unidade é imposta pela RLS (migration 0012/0016) — o código não reimplementa a regra, mas trata a recusa (`42501` ⇒ mensagem "Você não tem permissão para alterar esta unidade.").
- Padrões de UI (spec §4): estado vazio que ensina o próximo passo, skeleton, toast ao salvar, **confirmação antes de apagar**, erro em português com a ação para corrigir, alvos ≥ 44 px, foco visível, datas `dd/mm/aaaa`, horas `HH:mm`, formulário em *bottom sheet* no celular e diálogo no desktop. Nunca `text-primary` (laranja) como cor de texto — usar `text-link`.
- I2: nenhum horário/endereço inventado; o simulador mostra **exatamente** o que o pipeline gravou como saída.
- Simulação isolada: conversa/cliente/execução marcados `simulada`/`simulado`; nunca saem pela Meta; fora de indicadores, lacunas, fila "aguardando atendente" e contagens do Início; custo de IA real e sujeito ao mesmo teto.
- Migrations só via `drizzle-kit generate` (ou `--custom`); **nunca editar 0000–0014**. Banco local: `pnpm db:migrate`.
- `pnpm test`/`test:db`/projeto `db` **apagam o banco local** (`resetDb`).
- Código que roda no navegador (componentes `'use client'`, schemas dos formulários) importa só de `@atd/core/s1` (o índice de `@atd/core` puxa `node:crypto`) e nunca importa valores de `@atd/db` (só `import type`).
- Não commitar `apps/web/next-env.d.ts` alterado pelo `next dev`.
- Antes de declarar pronto: `pnpm lint && pnpm typecheck` + os testes da tarefa; na última tarefa, `pnpm check` e o e2e.

## Decisões deste plano (registrar no ledger; custo se estiverem erradas)

1. **Simulador só para dono e gerente** (o botão flutuante some para atendente): toda mensagem simulada gasta IA real. Custo se errado: liberar o papel numa linha.
2. **Ingestão do simulador pelo papel `web_app`** (o mesmo do webhook), depois de `requireStaff(['dono','gerente'])`, porque `authenticated` não insere conversas/mensagens. O cliente simulado é por usuário (`wa_id_hash = 'sim:<userId>:<epoch>'`), e só o próprio usuário lê a própria conversa simulada.
3. **Relógio simulado = deslocamento em segundos** em `conversations.relogio_offset_segundos` (nulo = relógio real). Vale para a resolução de S1, a expiração do pendente e o "aberto agora"; orçamento e timestamps continuam reais.
4. **Polling por Server Action** (`buscarSimulador`) a cada 1 s com a janela aberta, em vez de rota HTTP nova.
5. **Link curto do Google Maps** (`maps.app.goo.gl`) é resolvido no servidor seguindo redirecionamentos **só para hosts do Google Maps** (no máximo 3 saltos, 5 s), sem baixar o corpo; links completos são lidos sem rede.
6. **Horário do atendimento humano** (tela Mais) fica para a Etapa 06, onde é usado; a seção Restaurante do 02-C tem nome, política de feriado e link da política de privacidade.
7. **Permissão por unidade em forma de *initplan*** (`app.minhas_unidades()` avaliada uma vez por consulta) substitui `app.can_access_unit(id)` por linha nas policies — mesmo comportamento, revisado com `EXPLAIN` (pendência do 02-B).
8. **E2E do simulador sem IA paga:** o worker do e2e aponta para um OpenRouter falso local (`OPENROUTER_BASE_URL`), que responde a triagem por um mapa fixo de mensagens.
9. **Pendências do 02-B incluídas:** validação de turno que invade o dia seguinte (formulário de horários), validação de modelos mais estrita (variável escrita com espaço e variável essencial ausente — tela de Mensagens), `lista_expirada` respeitando os modelos personalizados, índices por `unit_id` em fatos/lacunas e `ai_runs (restaurant_id, created_at)`, permissão por unidade em *initplan* com `EXPLAIN`. **Continuam adiadas** (ledger do 02-B): data relativa do pendente resolvida na hora da escolha, prefixo nos ids da lista para botões futuros, "fim de semana" respondendo só sábado, ajustes finos de texto.
10. **Unidade não é apagada pelo painel** — desativar (`ativo = false`) tira da IA e preserva o histórico; apagar exceção e informação pede confirmação.
11. **E2E entra como dono com MFA real:** o teste lê o segredo TOTP exibido na tela de MFA e calcula o código (RFC 6238, `node:crypto`), sem burlar a autenticação.
12. **Adiados para a Etapa 08 (spec §5.3):** apagar simulações com mais de 7 dias entra no cron de retenção (`pg_cron` chega na Etapa 08; `web_app` não tem `DELETE`); custo da simulação mostrado à parte no quadro de gastos entra com os limites no painel. Até lá, o custo simulado já fica marcado em `ai_runs.simulado` e conta no mesmo teto. Custo se errado: conversas simuladas antigas ocupam espaço por algumas semanas.

## Review Focus

1. **Formulário enviado duas vezes / clique duplo em "Salvar"** — a segunda gravação não pode duplicar unidade, exceção ou fato: unidade por `slug` único, exceção por `upsert (unit_id, data)`, horário por substituição da semana inteira; testes na Task 3.
2. **Gerente restrito a uma unidade tenta abrir ou salvar outra pela URL** — a tela mostra "não encontrada" e a ação devolve erro de permissão, sem vazar dados; testes nas Tasks 3 e 6.
3. **Simulação vazando para o real** — conversa simulada que pede atendente não aparece em "Aguardando atendente", não entra nas contagens nem na taxa e não gera lacuna; nunca chama `sendText`; testes nas Tasks 12 e 13.
4. **Relógio simulado mudando o que não deve** — com o relógio em domingo 12h, a resposta de "está aberto agora?" usa o domingo, mas o orçamento continua no dia real; teste na Task 12.
5. **Colar link inválido ou malicioso do Maps** (`http://evil.com/@1,2`, link curto que redireciona para fora do Google) — não extrai coordenadas nem segue redirecionamento para outro host; testes nas Tasks 2 e 5.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/db/src/schema/{conversation,s1,ops}.ts` + migrations `0015` (gerada) e `0016` (custom) | relógio simulado, índices, policies por unidade em *initplan* |
| `packages/core/src/s1/mapas.ts` | extrair lat/lng de link do Google Maps; reconhecer link curto |
| `packages/core/src/s1/horarios.ts` (`validarSemana`), `modelos.ts` (`validarModelo` mais estrito) | regras compartilhadas painel/worker |
| `packages/db/src/painel-unidades.ts` | ler/gravar unidades, horários, exceções, restaurante (RLS + auditoria) |
| `packages/db/src/painel-respostas.ts` | lacunas, fatos, modelos, resumo do Início (RLS + auditoria) |
| `packages/db/src/painel-comum.ts` | `ResultadoPainel`, `semPermissaoVira`, `exigirPapel`, `registrarAuditoria(tx, claims, …)` |
| `packages/db/src/simulador.ts` + migration `0017` (gerada) | conversa simulada do usuário: obter/criar, mensagens, relógio, detalhes; índice do cliente simulado |
| `apps/web/lib/schemas/*.ts` | schemas Zod compartilhados (cliente e Server Action) |
| `apps/web/lib/maps-link.ts` | resolver link curto do Maps com lista de hosts permitidos |
| `apps/web/app/(painel)/unidades/**` | lista com selo "Aberta agora", detalhe com abas Dados / Horários / Exceções |
| `apps/web/app/(painel)/respostas/**` | abas Sem resposta / Informações / Mensagens |
| `apps/web/app/(painel)/page.tsx`, `mais/**` | Início completo; seção Restaurante |
| `apps/web/components/painel/*` | peças de UI reutilizadas pelas telas (folha de formulário, confirmação, abas) |
| `apps/web/app/(painel)/simulador-actions.ts`, `apps/web/lib/simulador-tela.ts`, `apps/web/components/simulator/*` | simulador ligado ao pipeline (Server Actions, polling, novo cliente, relógio, detalhes) |
| `apps/worker/src/jobs/process-conversation.ts`, `apps/worker/src/main.ts` | entrega pelo canal simulador, relógio, lista expirada com modelo personalizado; `baseUrl` do OpenRouter |
| `packages/ai/src/openrouter.ts` | `baseUrl` configurável (e2e) |
| `packages/config/src/env.ts`, `apps/web/e2e/*` | `OPENROUTER_BASE_URL` (só teste); OpenRouter falso, worker no e2e, TOTP, specs do 02-C |

---
### Task 1: Banco — relógio simulado, índices e permissão por unidade em *initplan*

**Files:**
- Modify: `packages/db/src/schema/conversation.ts`, `packages/db/src/schema/s1.ts`, `packages/db/src/schema/ops.ts`
- Generate: `packages/db/migrations/0015_painel_simulador.sql`
- Create: `packages/db/migrations/0016_unidades_initplan.sql` (custom), `packages/db/src/s1-rls-initplan.db.test.ts`

**Interfaces:**
- Produces: coluna `conversations.relogio_offset_segundos integer null` (Drizzle `relogioOffsetSegundos`); índices `knowledge_facts_unit_idx`, `knowledge_gaps_unit_idx`, `ai_runs_restaurant_created_idx`; funções SQL `app.acesso_todas_unidades() → boolean` e `app.minhas_unidades() → uuid[]`; policies de `units`, `unit_hours`, `unit_hour_exceptions`, `knowledge_facts`, `knowledge_gaps` reescritas com `((select app.acesso_todas_unidades()) or <coluna> = any ((select app.minhas_unidades())))` — **mesma semântica** de `app.can_access_unit` (dono ou lista vazia: todas; senão só as listadas; registro "de todas as unidades" (`unit_id` nulo) só para quem acessa todas).

- [ ] **Step 1: Teste (vai falhar)**

`packages/db/src/s1-rls-initplan.db.test.ts`:
```ts
import { afterAll, describe, expect, it } from 'vitest'
import { getTestDb } from './test-utils.ts'

const { sql } = getTestDb()
afterAll(() => sql.end())

const TABELAS = ['units', 'unit_hours', 'unit_hour_exceptions', 'knowledge_facts', 'knowledge_gaps']

describe('permissão por unidade em initplan', () => {
  it('nenhuma policy chama can_access_unit por linha; todas usam as funções de initplan', async () => {
    const rows = await sql<{ t: string; name: string; expr: string }[]>`
      select tablename as t, policyname as name, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies where schemaname = 'public' and tablename = any(${TABELAS})
         and policyname in ('staff_read', 'gestao_write', 'gestao_update')`
    expect(rows.length).toBe(10)
    for (const r of rows) {
      expect(r.expr, `${r.t}.${r.name}`).not.toContain('can_access_unit')
      expect(r.expr, `${r.t}.${r.name}`).toContain('acesso_todas_unidades')
      expect(r.expr, `${r.t}.${r.name}`).toContain('minhas_unidades')
    }
  })

  it('índices novos existem', async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where indexname in
        ('knowledge_facts_unit_idx', 'knowledge_gaps_unit_idx', 'ai_runs_restaurant_created_idx')`
    expect(rows.map((r) => r.indexname).sort()).toEqual(['ai_runs_restaurant_created_idx', 'knowledge_facts_unit_idx', 'knowledge_gaps_unit_idx'])
  })

  it('conversa tem relógio simulado opcional', async () => {
    const [c] = await sql<{ is_nullable: string; data_type: string }[]>`
      select is_nullable, data_type from information_schema.columns
       where table_name = 'conversations' and column_name = 'relogio_offset_segundos'`
    expect(c).toEqual({ is_nullable: 'YES', data_type: 'integer' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project db packages/db/src/s1-rls-initplan.db.test.ts`
Expected: FAIL (policies ainda chamam `can_access_unit`; índices e coluna não existem).

- [ ] **Step 3: Schema e migration gerada**

`packages/db/src/schema/conversation.ts` — em `conversations`, depois de `simulada`:
```ts
    /** Só em conversa simulada: deslocamento do relógio (segundos) usado na resolução de S1. Nulo = relógio real. */
    relogioOffsetSegundos: integer('relogio_offset_segundos'),
```
`packages/db/src/schema/s1.ts` — no bloco de índices de `knowledgeFacts`, acrescentar `index('knowledge_facts_unit_idx').on(t.unitId),`; no de `knowledgeGaps`, `index('knowledge_gaps_unit_idx').on(t.unitId),`.
`packages/db/src/schema/ops.ts` — no bloco de índices de `aiRuns`, acrescentar `index('ai_runs_restaurant_created_idx').on(t.restaurantId, t.createdAt.desc()),`.

Run: `pnpm --filter @atd/db exec drizzle-kit generate --name=painel_simulador`
Expected: `0015_painel_simulador.sql` com `ALTER TABLE "conversations" ADD COLUMN "relogio_offset_segundos" integer` e os três `CREATE INDEX` — **nada mais** (sem DROP). Leia o SQL inteiro.

- [ ] **Step 4: Migration custom das policies**

Run: `pnpm --filter @atd/db exec drizzle-kit generate --custom --name=unidades_initplan`

Conteúdo de `packages/db/migrations/0016_unidades_initplan.sql`:
```sql
-- Permissão por unidade avaliada UMA vez por consulta (initplan), em vez de uma chamada
-- SECURITY DEFINER por linha. Mesma regra de app.can_access_unit (migration 0012).

-- dono, ou qualquer papel com unidades_permitidas vazio: acessa todas. Sem staff ativo: false.
create or replace function app.acesso_todas_unidades() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.papel = 'dono' or cardinality(s.unidades_permitidas) = 0
      from public.staff s
     where s.user_id = (select auth.uid()) and s.ativo
  ), false)
$$;

-- unidades listadas para quem é restrito; vazio para os demais (inclusive sem staff).
create or replace function app.minhas_unidades() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select s.unidades_permitidas
      from public.staff s
     where s.user_id = (select auth.uid()) and s.ativo
  ), '{}'::uuid[])
$$;

revoke all on function app.acesso_todas_unidades(), app.minhas_unidades() from public;
grant execute on function app.acesso_todas_unidades(), app.minhas_unidades() to authenticated;

-- units
drop policy staff_read on public.units;
create policy staff_read on public.units for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades()))));
drop policy gestao_write on public.units;
create policy gestao_write on public.units for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades()))))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or id = any ((select app.minhas_unidades()))));

-- horários e exceções
do $$ declare t text; begin
  foreach t in array array['unit_hours','unit_hour_exceptions'] loop
    execute format('drop policy staff_read on public.%I', t);
    execute format('drop policy gestao_write on public.%I', t);
    execute format('create policy staff_read on public.%I for select to authenticated
      using (restaurant_id = (select app.my_restaurant_id())
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))))', t);
    execute format('create policy gestao_write on public.%I for all to authenticated
      using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'')
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))))
      with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in (''dono'',''gerente'')
             and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))))', t);
  end loop;
end $$;

-- fatos (unit_id nulo = todas as unidades: leitura para todos, escrita só para quem acessa todas)
drop policy staff_read on public.knowledge_facts;
create policy staff_read on public.knowledge_facts for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and (unit_id is null or (select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))));
drop policy gestao_write on public.knowledge_facts;
create policy gestao_write on public.knowledge_facts for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))));

-- lacunas
drop policy staff_read on public.knowledge_gaps;
create policy staff_read on public.knowledge_gaps for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
         and (unit_id is null or (select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))));
drop policy gestao_update on public.knowledge_gaps;
create policy gestao_update on public.knowledge_gaps for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
         and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades()))));
```
`unit_id = any(...)` com `unit_id` nulo dá NULL (falso) — preserva a regra "geral só para quem acessa todas".

- [ ] **Step 5: Aplicar, testar e conferir o plano**

Run: `pnpm db:migrate && pnpm vitest run --project db packages/db/src/s1-rls-initplan.db.test.ts packages/db/src/s1-rls.db.test.ts packages/db/src/rls.db.test.ts`
Expected: PASS em todos (os testes de RLS por unidade do 02-B são a regressão da mesma regra).

Depois, com o banco local (psql em `DATABASE_URL`), cole no relatório o `EXPLAIN` de uma leitura de `unit_hours` como gerente restrito, mostrando `InitPlan` para as duas funções:
```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<user_id de um gerente restrito>', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
explain select * from unit_hours;
rollback;
```
(Crie o gerente com `insert into staff …` num restaurante de teste se não houver; desfaça depois.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema packages/db/migrations packages/db/src/s1-rls-initplan.db.test.ts
git commit -m "Adiciona relógio simulado, índices do painel e permissão por unidade em initplan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras — link do Google Maps, semana de horários e validação de modelos

**Files:**
- Create: `packages/core/src/s1/mapas.ts`, `packages/core/src/s1/mapas.test.ts`
- Modify: `packages/core/src/s1/horarios.ts`, `packages/core/src/s1/horarios.test.ts`, `packages/core/src/s1/modelos.ts`, `packages/core/src/s1/modelos.test.ts`, `packages/core/src/s1/index.ts`, `packages/core/package.json` (export `./s1`)

**Interfaces:**
- Produces:
  - `type Coordenadas = { lat: number; lng: number }`
  - `ehHostGoogleMaps(host: string): boolean` — `google.com`, `www.google.com`, `google.com.br`, `www.google.com.br`, `maps.google.com`, `maps.google.com.br`, `maps.app.goo.gl`, `goo.gl`
  - `ehLinkCurtoMaps(link: string): boolean` — `https://maps.app.goo.gl/...` ou `https://goo.gl/maps/...`
  - `ehLinkGoogleMaps(link: string): boolean` — link curto, ou `https` em host do Google com caminho `/maps…` (ou host `maps.google.*`)
  - `extrairCoordenadas(link: string): Coordenadas | null` — sem rede; prioridade: pino `!3d<lat>!4d<lng>`, depois `@<lat>,<lng>`, depois parâmetros `q`, `query`, `ll`, `center`, `destination` no formato `lat,lng`; faixa válida; 6 casas
  - `validarSemana(semanal: readonly (readonly Turno[])[]): { dia: number; erro: string } | null` — `validarTurnos` de cada dia + turno da madrugada que invade o primeiro turno do dia seguinte
  - `validarModelo` passa a recusar variável escrita com espaço (`{ unidade }`) e texto sem uma variável essencial (todas as do modelo, exceto `unidade`)

- [ ] **Step 1: Testes (vão falhar)**

`packages/core/src/s1/mapas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ehLinkCurtoMaps, ehLinkGoogleMaps, extrairCoordenadas } from './mapas.ts'

describe('link do Google Maps', () => {
  it('extrai do pino, do @ e dos parâmetros', () => {
    expect(extrairCoordenadas('https://www.google.com/maps/place/Casa/@-15.8100,-47.8900,17z/data=!3d-15.8136123!4d-47.8960456'))
      .toEqual({ lat: -15.813612, lng: -47.896046 })
    expect(extrairCoordenadas('https://www.google.com.br/maps/@-15.8136,-47.896,17z')).toEqual({ lat: -15.8136, lng: -47.896 })
    expect(extrairCoordenadas('https://maps.google.com/?q=-15.78,-47.88')).toEqual({ lat: -15.78, lng: -47.88 })
    expect(extrairCoordenadas('https://www.google.com/maps/search/?api=1&query=-15.78%2C-47.88')).toEqual({ lat: -15.78, lng: -47.88 })
  })
  it('recusa host de fora, http, fora da faixa e link sem coordenada', () => {
    expect(extrairCoordenadas('https://evil.com/maps/@-15.8,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('http://www.google.com/maps/@-15.8,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/maps/@95.0,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/maps/place/Casa+Harmonia')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/search?q=-15.8,-47.8')).toBeNull()
    expect(extrairCoordenadas('não é link')).toBeNull()
  })
  it('link curto é reconhecido mas não lido sem rede', () => {
    expect(ehLinkCurtoMaps('https://maps.app.goo.gl/AbCd123')).toBe(true)
    expect(ehLinkCurtoMaps('https://goo.gl/maps/AbCd123')).toBe(true)
    expect(ehLinkCurtoMaps('https://goo.gl/outra-coisa')).toBe(false)
    expect(ehLinkGoogleMaps('https://maps.app.goo.gl/AbCd123')).toBe(true)
    expect(extrairCoordenadas('https://maps.app.goo.gl/AbCd123')).toBeNull()
    expect(ehLinkGoogleMaps('https://www.google.com/search?q=x')).toBe(false)
  })
})
```

Acrescentar a `packages/core/src/s1/horarios.test.ts` (importar `validarSemana`):
```ts
describe('validarSemana', () => {
  const vazio = (): Turno[][] => [[], [], [], [], [], [], []]
  it('semana válida, inclusive com madrugada que não encosta no dia seguinte', () => {
    const s = vazio()
    s[5] = [{ abre: '18:00', fecha: '02:00' }]
    s[6] = [{ abre: '11:30', fecha: '15:00' }]
    expect(validarSemana(s)).toBeNull()
  })
  it('erro do dia (formato/sobreposição) aponta o dia', () => {
    const s = vazio()
    s[2] = [{ abre: '11:00', fecha: '11:00' }]
    expect(validarSemana(s)).toEqual({ dia: 2, erro: 'Turno 1: a abertura e o fechamento não podem ser iguais.' })
  })
  it('madrugada de sábado invade o turno de domingo', () => {
    const s = vazio()
    s[6] = [{ abre: '18:00', fecha: '03:00' }]
    s[0] = [{ abre: '02:00', fecha: '10:00' }]
    expect(validarSemana(s)).toEqual({
      dia: 6,
      erro: 'O turno de sábado vai até 03:00 do dia seguinte e encosta no turno de domingo que abre às 02:00. Ajuste um dos dois.',
    })
  })
})
```
(Inclua `type Turno` no import de `./horarios.ts` no topo do arquivo de teste.)

Acrescentar ao `describe('modelos')` de `packages/core/src/s1/modelos.test.ts`:
```ts
  it('recusa variável com espaço e variável essencial ausente', () => {
    expect(validarModelo('aberto_sim', 'A { unidade } fecha {fecha}')).toBe('Escreva as variáveis sem espaços, como {unidade}.')
    expect(validarModelo('horario_dia', '{quando}, abrimos.')).toBe('Inclua {turnos} no texto: é ali que entra a informação.')
    expect(validarModelo('horario_dia', '{quando}: {turnos}')).toBeNull() // {unidade} é opcional
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit packages/core/src/s1`
Expected: FAIL (`mapas.ts` inexistente; `validarSemana` não exportado; `validarModelo` ainda aceita os casos novos).

- [ ] **Step 3: Implementar**

`packages/core/src/s1/mapas.ts`:
```ts
export type Coordenadas = { lat: number; lng: number }

const HOSTS_GOOGLE = new Set(['google.com', 'www.google.com', 'google.com.br', 'www.google.com.br'])
const HOSTS_MAPS = new Set(['maps.google.com', 'maps.google.com.br'])

function lerUrl(link: string): URL | null {
  try {
    return new URL(link.trim())
  } catch {
    return null
  }
}

export function ehHostGoogleMaps(host: string): boolean {
  return HOSTS_GOOGLE.has(host) || HOSTS_MAPS.has(host) || host === 'maps.app.goo.gl' || host === 'goo.gl'
}

export function ehLinkCurtoMaps(link: string): boolean {
  const u = lerUrl(link)
  if (!u || u.protocol !== 'https:') return false
  return u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps'))
}

export function ehLinkGoogleMaps(link: string): boolean {
  if (ehLinkCurtoMaps(link)) return true
  const u = lerUrl(link)
  if (!u || u.protocol !== 'https:') return false
  return HOSTS_MAPS.has(u.hostname) || (HOSTS_GOOGLE.has(u.hostname) && u.pathname.startsWith('/maps'))
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'
const PINO = new RegExp(`!3d${NUM}!4d${NUM}`)
const ARROBA = new RegExp(`@${NUM},${NUM}`)
const PAR = new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`)
const PARAMETROS = ['q', 'query', 'll', 'center', 'destination']
const seis = (n: number) => Math.round(n * 1e6) / 1e6

/** Coordenadas de um link completo do Google Maps (sem rede). Link curto: resolver antes no servidor. */
export function extrairCoordenadas(link: string): Coordenadas | null {
  if (!ehLinkGoogleMaps(link) || ehLinkCurtoMaps(link)) return null
  const u = lerUrl(link)!
  let caminho = u.pathname
  try {
    caminho = decodeURIComponent(u.pathname)
  } catch {
    // caminho com % inválido: usa como veio
  }
  let par = PINO.exec(caminho) ?? ARROBA.exec(caminho)
  if (!par) {
    for (const k of PARAMETROS) {
      const v = u.searchParams.get(k)
      const m = v ? PAR.exec(v) : null
      if (m) {
        par = m
        break
      }
    }
  }
  if (!par) return null
  const lat = Number(par[1])
  const lng = Number(par[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat: seis(lat), lng: seis(lng) }
}
```

`packages/core/src/s1/horarios.ts` — acrescentar no fim:
```ts
const NOMES_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const

/** Semana inteira (formulário do painel): cada dia válido e nenhuma madrugada invadindo o dia seguinte. */
export function validarSemana(semanal: readonly (readonly Turno[])[]): { dia: number; erro: string } | null {
  for (let d = 0; d < 7; d++) {
    const erro = validarTurnos(semanal[d] ?? [])
    if (erro) return { dia: d, erro }
  }
  for (let d = 0; d < 7; d++) {
    const proximo = (d + 1) % 7
    for (const t of semanal[d] ?? []) {
      if (!cruzaMeiaNoite(t)) continue
      const fim = minutosDe(t.fecha)
      const conflito = (semanal[proximo] ?? []).find((n) => minutosDe(n.abre) < fim)
      if (conflito) {
        return {
          dia: d,
          erro: `O turno de ${NOMES_DIA[d]} vai até ${t.fecha} do dia seguinte e encosta no turno de ${NOMES_DIA[proximo]} que abre às ${conflito.abre}. Ajuste um dos dois.`,
        }
      }
    }
  }
  return null
}
```

`packages/core/src/s1/modelos.ts` — substituir `validarModelo` por:
```ts
const VARIAVEL_COM_ESPACO = /\{\s+\w+\s*\}|\{\w+\s+\}/

export function validarModelo(chave: ChaveModelo, texto: string): string | null {
  if (!texto.trim()) return 'Escreva o texto do modelo.'
  if (texto.length > 1000) return 'Use no máximo 1000 caracteres.'
  if (VARIAVEL_COM_ESPACO.test(texto)) return 'Escreva as variáveis sem espaços, como {unidade}.'
  const permitidas: readonly string[] = MODELOS_S1[chave].variaveis
  for (const [, nome] of texto.matchAll(VARIAVEL)) {
    if (!permitidas.includes(nome!)) {
      const uso = permitidas.length ? `Use: ${permitidas.map((v) => `{${v}}`).join(', ')}.` : 'Este modelo não usa variáveis.'
      return `A variável {${nome}} não existe neste modelo. ${uso}`
    }
  }
  // {unidade} pode sair (resposta de uma unidade só); as demais carregam a informação
  const faltando = permitidas.find((v) => v !== 'unidade' && !texto.includes(`{${v}}`))
  if (faltando) return `Inclua {${faltando}} no texto: é ali que entra a informação.`
  return null
}
```

`packages/core/src/s1/index.ts` — acrescentar `export * from './mapas.ts'`.

`packages/core/package.json` — em `exports`, acrescentar `"./s1": "./src/s1/index.ts"`. **Motivo:** o índice de `@atd/core` importa `node:crypto` (cifra do telefone); componentes e schemas que rodam no navegador devem importar **só** `@atd/core/s1` (domínio puro de S1). Hoje `packages/core/src/s1/**` só importa `../normalize.ts` de fora da pasta; mantenha assim.

- [ ] **Step 4: Rodar**

Run: `pnpm vitest run --project unit packages/core packages/ai/evals && pnpm --filter @atd/core typecheck`
Expected: PASS (os evals da camada 2 não mudam: só a validação ficou mais estrita).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/s1
git commit -m "Lê coordenadas de link do Maps, valida a semana de horários e endurece os modelos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Banco do painel — unidades, horários, exceções e restaurante (RLS + auditoria)

**Files:**
- Create: `packages/db/src/painel-comum.ts`, `packages/db/src/painel-unidades.ts`, `packages/db/src/painel-unidades.db.test.ts`
- Modify: `packages/db/src/s1.ts` (extrai `montarUnidades`), `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `withUserContext`, `JwtClaims`, `Tx` (`./rls.ts`); `UnidadeS1`, `Turno`, `PoliticaFeriado`, `normalizeText`, `agoraLocal` (`@atd/core`); policies da Task 1.
- Produces:
  - `painel-comum.ts`: `type ErroPainel = 'sem_permissao' | 'nao_encontrada' | 'nome_duplicado'`; `type ResultadoPainel<T = null> = { ok: true; valor: T } | { ok: false; erro: ErroPainel }`; `ok(valor)`, `falha(erro)`; `semPermissaoVira(fn, unicas?)` (recusa `42501` ⇒ `sem_permissao`; violação de única mapeada ⇒ erro); `exigirPapel(tx, papeis): Promise<boolean>`; `registrarAuditoria(tx, claims, { restaurantId, acao, entidade, entidadeId, diff? })`
  - `s1.ts`: `montarUnidades(us, hs, exs): UnidadeS1[]` (mesma montagem do `carregarContextoS1`)
  - `painel-unidades.ts`: `type UnidadePainel = UnidadeS1 & { ativo; slug; cep; telefone }`; `type RestaurantePainel = { id; nome; timezone; politicaFeriado; politicaUrl }`; `type DadosUnidade`; `type ExcecaoInput = { data: DataIso; fechado: boolean; turnos: Turno[]; motivo: string | null }`;
    `carregarUnidadesPainel(db, claims, agora?) → { restaurante, unidades }` (exceções do ano corrente em diante),
    `salvarUnidade(db, claims, restaurantId, id | null, dados) → ResultadoPainel<{ id }>`,
    `salvarHorarios(db, claims, restaurantId, unitId, semanal) → ResultadoPainel`,
    `salvarExcecao(db, claims, restaurantId, unitId, excecao)`, `removerExcecao(db, claims, restaurantId, unitId, data)`,
    `salvarRestaurante(db, claims, restaurantId, { nome, politicaFeriado, politicaUrl })` (só dono)
  - Ações de auditoria: `unidade.criada`, `unidade.atualizada`, `unidade.horarios`, `unidade.excecao_salva`, `unidade.excecao_removida`, `restaurante.atualizado`.

- [ ] **Step 1: Testes (vão falhar)**

`packages/db/src/painel-unidades.db.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  carregarUnidadesPainel, removerExcecao, salvarExcecao, salvarHorarios, salvarRestaurante, salvarUnidade, type DadosUnidade,
} from './painel-unidades.ts'
import { auditLog, restaurants, staff, unitHourExceptions, unitHours, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const AGORA = new Date('2026-10-05T14:00:00-03:00')
const dados = (nome: string): DadosUnidade => ({
  nome, endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', cep: '71625205', telefone: '6133334444',
  apelidos: ['lago'], mapsUrl: null, lat: -15.84, lng: -47.87, ativo: true,
})
const semana = () => {
  const s = [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][]
  s[6] = [{ abre: '18:00', fecha: '02:00' }]
  s[0] = [{ abre: '11:30', fecha: '16:00' }]
  return s
}

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente }
}
const acoes = (entidadeId: string) =>
  db.select({ acao: auditLog.acao }).from(auditLog).where(eq(auditLog.entidadeId, entidadeId)).orderBy(auditLog.id)

describe('painel — unidades', () => {
  it('dono cria, configura horários e exceção; tudo auditado', async () => {
    const c = await cenario()
    const r = await salvarUnidade(db, as(c.dono), c.restaurantId, null, dados('Lago Sul'))
    expect(r.ok).toBe(true)
    const id = r.ok ? r.valor.id : ''
    expect((await salvarHorarios(db, as(c.dono), c.restaurantId, id, semana())).ok).toBe(true)
    expect((await salvarExcecao(db, as(c.dono), c.restaurantId, id, { data: '2026-12-25', fechado: true, turnos: [], motivo: 'Natal' })).ok).toBe(true)

    const { unidades, restaurante } = await carregarUnidadesPainel(db, as(c.dono), AGORA)
    expect(restaurante).toMatchObject({ id: c.restaurantId, politicaFeriado: 'como_domingo' })
    const u = unidades.find((x) => x.id === id)!
    expect(u).toMatchObject({ nome: 'Lago Sul', slug: 'lago-sul', ativo: true, cep: '71625205', apelidos: ['lago'], lat: -15.84 })
    expect(u.semanal[6]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(u.excecoes['2026-12-25']).toEqual({ fechado: true, turnos: [], motivo: 'Natal' })
    expect((await acoes(id)).map((a) => a.acao)).toEqual(['unidade.criada', 'unidade.horarios', 'unidade.excecao_salva'])

    expect((await removerExcecao(db, as(c.dono), c.restaurantId, id, '2026-12-25')).ok).toBe(true)
    expect(await removerExcecao(db, as(c.dono), c.restaurantId, id, '2026-12-25')).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('repetir o envio não duplica', async () => {
    const c = await cenario()
    expect(await salvarUnidade(db, as(c.dono), c.restaurantId, null, dados('Asa Norte'))).toEqual({ ok: false, erro: 'nome_duplicado' })
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(2)
    await salvarExcecao(db, as(c.dono), c.restaurantId, c.u1, { data: '2026-12-24', fechado: false, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Véspera' })
    await salvarExcecao(db, as(c.dono), c.restaurantId, c.u1, { data: '2026-12-24', fechado: true, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Fechado' })
    const exs = await db.select().from(unitHourExceptions).where(eq(unitHourExceptions.unitId, c.u1))
    expect(exs).toHaveLength(1)
    expect(exs[0]).toMatchObject({ fechado: true, turnos: [], motivo: 'Fechado' }) // fechado ⇒ sem turnos
  })

  it('falha no meio desfaz tudo, inclusive a auditoria', async () => {
    const c = await cenario()
    await salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, semana())
    const ruim = semana()
    ruim[2] = [{ abre: '11:00', fecha: '11:00' }]
    await expect(salvarHorarios(db, as(c.dono), c.restaurantId, c.u1, ruim)).rejects.toMatchObject({ cause: { code: '23514' } })
    expect(await db.select().from(unitHours).where(eq(unitHours.unitId, c.u1))).toHaveLength(2)
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entidadeId, c.u1), eq(auditLog.acao, 'unidade.horarios')))).toHaveLength(1)
  })

  it('gerente restrito: vê só a sua; a outra é "não encontrada"; não cria unidade nova', async () => {
    const c = await cenario()
    const { unidades } = await carregarUnidadesPainel(db, as(c.gerenteU1), AGORA)
    expect(unidades.map((u) => u.id)).toEqual([c.u1])
    expect(await salvarHorarios(db, as(c.gerenteU1), c.restaurantId, c.u2, semana())).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarUnidade(db, as(c.gerenteU1), c.restaurantId, c.u2, dados('Asa Norte'))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await salvarUnidade(db, as(c.gerenteU1), c.restaurantId, null, dados('Nova'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await salvarHorarios(db, as(c.gerenteU1), c.restaurantId, c.u1, semana())).ok).toBe(true)
  })

  it('atendente não altera nada; só o dono altera o restaurante', async () => {
    const c = await cenario()
    expect(await salvarUnidade(db, as(c.atendente, 'aal1'), c.restaurantId, null, dados('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect(await salvarHorarios(db, as(c.atendente, 'aal1'), c.restaurantId, c.u1, [[], [], [], [], [], [], []])).toEqual({ ok: false, erro: 'sem_permissao' })
    const novo = { nome: 'Casa Harmonia', politicaFeriado: 'fechado' as const, politicaUrl: 'https://casa.test/privacidade' }
    expect(await salvarRestaurante(db, as(c.gerenteU1), c.restaurantId, novo)).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await salvarRestaurante(db, as(c.dono), c.restaurantId, novo)).ok).toBe(true)
    const [r] = await db.select().from(restaurants).where(eq(restaurants.id, c.restaurantId))
    expect(r).toMatchObject(novo)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project db packages/db/src/painel-unidades.db.test.ts`
Expected: FAIL (`./painel-unidades.ts` inexistente).

- [ ] **Step 3: `montarUnidades` em `s1.ts`**

Em `packages/db/src/s1.ts`, extrair o trecho que monta `porId`/`unidades`/`semanal`/`excecoes` para uma função exportada e usá-la em `carregarContextoS1`:
```ts
type LinhaUnidade = typeof units.$inferSelect
type LinhaHorario = { unitId: string; weekday: number; abre: string; fecha: string }
type LinhaExcecao = { unitId: string; data: string; fechado: boolean; turnos: { abre: string; fecha: string }[]; motivo: string | null }

/** Monta as unidades com agenda (turnos HH:MM) na ordem de `us`. Compartilhado com o painel. */
export function montarUnidades(us: readonly LinhaUnidade[], hs: readonly LinhaHorario[], exs: readonly LinhaExcecao[]): UnidadeS1[] {
  const porId = new Map<string, UnidadeS1>()
  const unidades = us.map((u) => {
    const x: UnidadeS1 = {
      id: u.id, nome: u.nome, apelidos: u.apelidos, ordem: u.ordem,
      endereco: u.endereco, bairro: u.bairro, cidade: u.cidade, uf: u.uf,
      lat: u.lat, lng: u.lng, mapsUrl: u.mapsUrl,
      semanal: Array.from({ length: 7 }, () => [] as Turno[]),
      excecoes: {},
    }
    porId.set(u.id, x)
    return x
  })
  for (const h of hs) porId.get(h.unitId)?.semanal[h.weekday]?.push({ abre: hhmm(h.abre), fecha: hhmm(h.fecha) })
  for (const e of exs) {
    const u = porId.get(e.unitId)
    if (u) u.excecoes[e.data] = { fechado: e.fechado, turnos: e.turnos.map((t) => ({ abre: hhmm(t.abre), fecha: hhmm(t.fecha) })), motivo: e.motivo }
  }
  return unidades
}
```
e em `carregarContextoS1` trocar o bloco antigo por `const unidades = montarUnidades(us, hs, exs)`.

- [ ] **Step 4: `painel-comum.ts`**

```ts
import { sql } from 'drizzle-orm'
import type { JwtClaims, Tx } from './rls.ts'
import { auditLog } from './schema/ops.ts'

export type ErroPainel = 'sem_permissao' | 'nao_encontrada' | 'nome_duplicado'
export type ResultadoPainel<T = null> = { ok: true; valor: T } | { ok: false; erro: ErroPainel }

export const ok = <T>(valor: T): ResultadoPainel<T> => ({ ok: true, valor })
export const falha = <T = never>(erro: ErroPainel): ResultadoPainel<T> => ({ ok: false, erro })

// o Drizzle 0.45 embrulha o erro do driver em `cause`
function erroPg(err: unknown): { code?: string; constraint_name?: string } {
  const c = (err as { cause?: unknown } | null)?.cause ?? err
  return (typeof c === 'object' && c !== null ? c : {}) as { code?: string; constraint_name?: string }
}

/** Recusa de RLS/grant (42501) vira `sem_permissao`; violação de única listada vira o erro indicado. */
export async function semPermissaoVira<T>(
  fn: () => Promise<ResultadoPainel<T>>,
  unicas: Record<string, ErroPainel> = {},
): Promise<ResultadoPainel<T>> {
  try {
    return await fn()
  } catch (err) {
    const e = erroPg(err)
    if (e.code === '42501') return falha('sem_permissao')
    if (e.code === '23505' && e.constraint_name && unicas[e.constraint_name]) return falha(unicas[e.constraint_name]!)
    throw err
  }
}

/** Papel do usuário da transação (RLS ativa). Necessário porque DELETE que a policy filtra não dá erro. */
export async function exigirPapel(tx: Tx, papeis: readonly ('dono' | 'gerente' | 'atendente')[]): Promise<boolean> {
  const rows = await tx.execute<{ papel: string | null }>(sql`select app.my_role()::text as papel`)
  const papel = rows[0]?.papel ?? null
  return papel !== null && (papeis as readonly string[]).includes(papel)
}

export async function registrarAuditoria(
  tx: Tx,
  claims: JwtClaims,
  a: { restaurantId: string; acao: string; entidade: string; entidadeId: string | null; diff?: unknown },
): Promise<void> {
  await tx.insert(auditLog).values({
    restaurantId: a.restaurantId,
    atorId: claims.sub,
    atorTipo: 'staff',
    acao: a.acao,
    entidade: a.entidade,
    entidadeId: a.entidadeId,
    diff: a.diff ?? null,
  })
}
```
(Se `tx.execute<…>` não aceitar o genérico na versão do Drizzle, use `const rows = (await tx.execute(sql\`…\`)) as unknown as { papel: string | null }[]`.)

- [ ] **Step 5: `painel-unidades.ts`**

```ts
import { and, asc, eq, gte, inArray } from 'drizzle-orm'
import { agoraLocal, normalizeText, type DataIso, type PoliticaFeriado, type Turno, type UnidadeS1 } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { montarUnidades } from './s1.ts'
import { restaurants, units } from './schema/restaurant.ts'
import { unitHourExceptions, unitHours } from './schema/s1.ts'

export type UnidadePainel = UnidadeS1 & { ativo: boolean; slug: string; cep: string | null; telefone: string | null }
export type RestaurantePainel = { id: string; nome: string; timezone: string; politicaFeriado: PoliticaFeriado; politicaUrl: string | null }
export type DadosUnidade = {
  nome: string
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  telefone: string | null
  apelidos: string[]
  mapsUrl: string | null
  lat: number | null
  lng: number | null
  ativo: boolean
}
export type ExcecaoInput = { data: DataIso; fechado: boolean; turnos: Turno[]; motivo: string | null }

const GESTAO = ['dono', 'gerente'] as const
const slugDe = (nome: string) => normalizeText(nome).replace(/ /g, '-').slice(0, 60) || 'unidade'

/** Unidades visíveis ao usuário (RLS por unidade), com agenda e exceções do ano corrente em diante. */
export function carregarUnidadesPainel(
  db: Db,
  claims: JwtClaims,
  agora: Date = new Date(),
): Promise<{ restaurante: RestaurantePainel; unidades: UnidadePainel[] }> {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx
      .select({ id: restaurants.id, nome: restaurants.nome, timezone: restaurants.timezone, politicaFeriado: restaurants.politicaFeriado, politicaUrl: restaurants.politicaUrl })
      .from(restaurants)
      .limit(1)
    if (!r) throw new Error('Restaurante não encontrado')
    const inicioAno = `${agoraLocal(agora, r.timezone).data.slice(0, 4)}-01-01`
    const us = await tx.select().from(units).orderBy(asc(units.ordem), asc(units.nome))
    const ids = us.map((u) => u.id)
    const hs = ids.length === 0 ? [] : await tx
      .select({ unitId: unitHours.unitId, weekday: unitHours.weekday, abre: unitHours.abre, fecha: unitHours.fecha })
      .from(unitHours)
      .where(inArray(unitHours.unitId, ids))
      .orderBy(asc(unitHours.unitId), asc(unitHours.weekday), asc(unitHours.abre))
    const exs = ids.length === 0 ? [] : await tx
      .select({ unitId: unitHourExceptions.unitId, data: unitHourExceptions.data, fechado: unitHourExceptions.fechado, turnos: unitHourExceptions.turnos, motivo: unitHourExceptions.motivo })
      .from(unitHourExceptions)
      .where(and(inArray(unitHourExceptions.unitId, ids), gte(unitHourExceptions.data, inicioAno)))
      .orderBy(asc(unitHourExceptions.data))
    const linhas = new Map(us.map((u) => [u.id, u]))
    const unidades = montarUnidades(us, hs, exs).map((b) => {
      const u = linhas.get(b.id)!
      return { ...b, ativo: u.ativo, slug: u.slug, cep: u.cep, telefone: u.telefone }
    })
    return { restaurante: r, unidades }
  })
}

export function salvarUnidade(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  id: string | null,
  dados: DadosUnidade,
): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(
    () => withUserContext(db, claims, async (tx) => {
      if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
      const valores = { ...dados, slug: slugDe(dados.nome) }
      if (id === null) {
        const [u] = await tx.insert(units).values({ restaurantId, ...valores }).returning({ id: units.id })
        await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.criada', entidade: 'unit', entidadeId: u!.id, diff: valores })
        return ok({ id: u!.id })
      }
      const [u] = await tx.update(units).set(valores).where(eq(units.id, id)).returning({ id: units.id })
      if (!u) return falha('nao_encontrada')
      await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.atualizada', entidade: 'unit', entidadeId: u.id, diff: valores })
      return ok({ id: u.id })
    }),
    { units_restaurant_slug_uq: 'nome_duplicado' },
  )
}

async function unidadeVisivel(tx: Tx, unitId: string): Promise<boolean> {
  const [u] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId))
  return Boolean(u)
}

/** Substitui a semana inteira da unidade (reenvio não duplica). */
export function salvarHorarios(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, semanal: Turno[][]): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (!(await unidadeVisivel(tx, unitId))) return falha('nao_encontrada')
    await tx.delete(unitHours).where(eq(unitHours.unitId, unitId))
    const linhas = semanal.flatMap((dia, weekday) => dia.map((t, i) => ({ restaurantId, unitId, weekday, turno: i + 1, abre: t.abre, fecha: t.fecha })))
    if (linhas.length > 0) await tx.insert(unitHours).values(linhas)
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.horarios', entidade: 'unit', entidadeId: unitId, diff: { semanal } })
    return ok(null)
  }))
}

export function salvarExcecao(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, e: ExcecaoInput): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (!(await unidadeVisivel(tx, unitId))) return falha('nao_encontrada')
    const valores = { fechado: e.fechado, turnos: e.fechado ? [] : e.turnos, motivo: e.motivo }
    await tx
      .insert(unitHourExceptions)
      .values({ restaurantId, unitId, data: e.data, ...valores })
      .onConflictDoUpdate({ target: [unitHourExceptions.unitId, unitHourExceptions.data], set: valores })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.excecao_salva', entidade: 'unit', entidadeId: unitId, diff: { data: e.data, ...valores } })
    return ok(null)
  }))
}

export function removerExcecao(db: Db, claims: JwtClaims, restaurantId: string, unitId: string, data: DataIso): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const apagadas = await tx
      .delete(unitHourExceptions)
      .where(and(eq(unitHourExceptions.unitId, unitId), eq(unitHourExceptions.data, data)))
      .returning({ id: unitHourExceptions.id })
    if (apagadas.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'unidade.excecao_removida', entidade: 'unit', entidadeId: unitId, diff: { data } })
    return ok(null)
  }))
}

export function salvarRestaurante(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  d: { nome: string; politicaFeriado: PoliticaFeriado; politicaUrl: string | null },
): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, ['dono']))) return falha('sem_permissao')
    const [r] = await tx.update(restaurants).set(d).where(eq(restaurants.id, restaurantId)).returning({ id: restaurants.id })
    if (!r) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'restaurante.atualizado', entidade: 'restaurant', entidadeId: restaurantId, diff: d })
    return ok(null)
  }))
}
```
`packages/db/src/index.ts` — acrescentar:
```ts
export * from './painel-comum.ts'
export * from './painel-unidades.ts'
```

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run --project db packages/db/src/painel-unidades.db.test.ts packages/db/src/s1-dados.db.test.ts && pnpm --filter @atd/db typecheck`
Expected: PASS (o `s1-dados` confirma que a extração de `montarUnidades` não mudou o contexto do worker).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src
git commit -m "Adiciona funções do painel para unidades, horários, exceções e restaurante com auditoria

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Banco do painel — lacunas, informações, modelos e resumo do Início

**Files:**
- Create: `packages/db/src/painel-respostas.ts`, `packages/db/src/painel-respostas.db.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `painel-comum.ts` (Task 3); `taxaRespostaIa` (`./s1.ts`); `MODELOS_S1`, `ChaveModelo` (`@atd/core`).
- Produces:
  - `type LacunaPainel = { id; chave; unitId: string | null; unidade: string | null; pergunta: string | null; ocorrencias: number; ultimaVez: Date }`
  - `listarLacunas(db, claims, limite = 100): Promise<LacunaPainel[]>` — só abertas, mais frequentes e recentes primeiro
  - `type FatoInput = { tema: string; exemplos: string[]; texto: string; unitId: string | null; ativo: boolean }`
  - `responderLacuna(db, claims, restaurantId, lacunaId, fato): ResultadoPainel<{ factId: string }>` — cria o fato e marca a lacuna `respondida` (com `fact_id`) na mesma transação
  - `ignorarLacuna(db, claims, restaurantId, lacunaId): ResultadoPainel`
  - `type FatoPainel = FatoInput & { id: string; unidade: string | null }`; `listarFatos(db, claims)`; `salvarFato(db, claims, restaurantId, id | null, fato): ResultadoPainel<{ id }>`; `removerFato(db, claims, restaurantId, id)`
  - `listarModelos(db, claims): Promise<Partial<Record<ChaveModelo, string>>>`; `salvarModelo(db, claims, restaurantId, chave, texto)`; `restaurarModelo(db, claims, restaurantId, chave)`
  - `resumoInicio(db, claims, agora?) → { taxa: { hoje: { validos; respondidos }; seteDias: { validos; respondidos } }; lacunas: LacunaPainel[] /* top 3 */ }`
  - Ações de auditoria: `lacuna.respondida`, `lacuna.ignorada`, `fato.criado`, `fato.atualizado`, `fato.removido`, `modelo.salvo`, `modelo.restaurado`.

- [ ] **Step 1: Testes (vão falhar)**

`packages/db/src/painel-respostas.db.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import type { JwtClaims } from './rls.ts'
import {
  ignorarLacuna, listarFatos, listarLacunas, listarModelos, removerFato, responderLacuna, restaurarModelo, resumoInicio,
  salvarFato, salvarModelo,
} from './painel-respostas.ts'
import { auditLog, knowledgeFacts, knowledgeGaps, replyTemplates, staff, units } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const as = (sub: string, aal: 'aal1' | 'aal2' = 'aal2'): JwtClaims => ({ sub, role: 'authenticated', aal })
const fato = (tema: string, unitId: string | null = null) => ({ tema, exemplos: ['tem?'], texto: `Sobre ${tema}: sim.`, unitId, ativo: true })

async function cenario() {
  const { restaurantId, unitId: u1 } = await seedRestaurant(db)
  const [u2] = await db.insert(units).values({ restaurantId, nome: 'Asa Norte', slug: 'asa-norte' }).returning()
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerenteU1 = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  await db.update(staff).set({ unidadesPermitidas: [u1] }).where(eq(staff.userId, gerenteU1))
  const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
  const [gGeral, gU2, gU1] = await db.insert(knowledgeGaps).values([
    { restaurantId, chaveNormalizada: 'info:estacionamento', perguntaMascarada: 'tem estacionamento?', ocorrencias: 5 },
    { restaurantId, unitId: u2!.id, chaveNormalizada: 'info:wifi', perguntaMascarada: 'tem wifi?', ocorrencias: 3 },
    { restaurantId, unitId: u1, chaveNormalizada: 'horario', perguntaMascarada: 'abre que horas?', ocorrencias: 1 },
  ]).returning()
  return { restaurantId, u1, u2: u2!.id, dono, gerenteU1, atendente, gGeral: gGeral!.id, gU2: gU2!.id, gU1: gU1!.id }
}

describe('painel — lacunas', () => {
  it('responder cria o fato, fecha a lacuna e audita', async () => {
    const c = await cenario()
    const r = await responderLacuna(db, as(c.dono), c.restaurantId, c.gGeral, fato('Estacionamento'))
    expect(r.ok).toBe(true)
    const factId = r.ok ? r.valor.factId : ''
    const [g] = await db.select().from(knowledgeGaps).where(eq(knowledgeGaps.id, c.gGeral))
    expect(g).toMatchObject({ status: 'respondida', factId })
    const [f] = await db.select().from(knowledgeFacts).where(eq(knowledgeFacts.id, factId))
    expect(f).toMatchObject({ tema: 'Estacionamento', unitId: null, ativo: true })
    expect((await db.select().from(auditLog).where(eq(auditLog.entidadeId, c.gGeral))).map((a) => a.acao)).toEqual(['lacuna.respondida'])
    expect((await listarLacunas(db, as(c.dono))).map((l) => l.id)).toEqual([c.gU2, c.gU1])
    expect(await responderLacuna(db, as(c.dono), c.restaurantId, c.gGeral, fato('x'))).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('ignorar tira da fila; a lista vem com nome da unidade e mais frequentes primeiro', async () => {
    const c = await cenario()
    const lista = await listarLacunas(db, as(c.dono))
    expect(lista.map((l) => [l.chave, l.unidade, l.ocorrencias])).toEqual([
      ['info:estacionamento', null, 5], ['info:wifi', 'Asa Norte', 3], ['horario', 'Asa Sul', 1],
    ])
    expect((await ignorarLacuna(db, as(c.dono), c.restaurantId, c.gU1)).ok).toBe(true)
    expect(await ignorarLacuna(db, as(c.dono), c.restaurantId, c.gU1)).toEqual({ ok: false, erro: 'nao_encontrada' })
  })

  it('gerente restrito: não vê lacuna de outra unidade; lacuna geral exige acesso a todas', async () => {
    const c = await cenario()
    expect((await listarLacunas(db, as(c.gerenteU1))).map((l) => l.id)).toEqual([c.gGeral, c.gU1])
    expect(await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gU2, fato('Wi-Fi', c.u2))).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect(await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gGeral, fato('Estacionamento'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await responderLacuna(db, as(c.gerenteU1), c.restaurantId, c.gU1, fato('Horário', c.u1))).ok).toBe(true)
  })
})

describe('painel — informações e modelos', () => {
  it('cria, edita e remove informação com auditoria; atendente só lê', async () => {
    const c = await cenario()
    const r = await salvarFato(db, as(c.dono), c.restaurantId, null, fato('Pet friendly'))
    const id = r.ok ? r.valor.id : ''
    expect((await salvarFato(db, as(c.dono), c.restaurantId, id, { ...fato('Pet friendly'), texto: 'Aceitamos pets.' })).ok).toBe(true)
    expect((await listarFatos(db, as(c.atendente, 'aal1'))).map((f) => [f.tema, f.texto])).toEqual([['Pet friendly', 'Aceitamos pets.']])
    expect(await salvarFato(db, as(c.atendente, 'aal1'), c.restaurantId, null, fato('X'))).toEqual({ ok: false, erro: 'sem_permissao' })
    expect((await removerFato(db, as(c.dono), c.restaurantId, id)).ok).toBe(true)
    expect(await removerFato(db, as(c.dono), c.restaurantId, id)).toEqual({ ok: false, erro: 'nao_encontrada' })
    expect((await db.select().from(auditLog).where(eq(auditLog.entidadeId, id))).map((a) => a.acao)).toEqual(['fato.criado', 'fato.atualizado', 'fato.removido'])
  })

  it('modelo personalizado: salva, atualiza e restaura o padrão', async () => {
    const c = await cenario()
    await salvarModelo(db, as(c.dono), c.restaurantId, 'lacuna', 'Vou confirmar com a equipe.')
    await salvarModelo(db, as(c.dono), c.restaurantId, 'lacuna', 'Vou confirmar e já te digo.')
    expect(await listarModelos(db, as(c.dono))).toEqual({ lacuna: 'Vou confirmar e já te digo.' })
    expect(await db.select().from(replyTemplates)).toHaveLength(1)
    expect((await restaurarModelo(db, as(c.dono), c.restaurantId, 'lacuna')).ok).toBe(true)
    expect(await listarModelos(db, as(c.dono))).toEqual({})
  })

  it('resumo do Início traz as 3 lacunas mais frequentes e a taxa', async () => {
    const c = await cenario()
    const r = await resumoInicio(db, as(c.dono), new Date('2026-10-05T14:00:00-03:00'))
    expect(r.lacunas.map((l) => l.chave)).toEqual(['info:estacionamento', 'info:wifi', 'horario'])
    expect(r.taxa).toEqual({ hoje: { validos: 0, respondidos: 0 }, seteDias: { validos: 0, respondidos: 0 } })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project db packages/db/src/painel-respostas.db.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`packages/db/src/painel-respostas.ts`:
```ts
import { and, asc, desc, eq } from 'drizzle-orm'
import { MODELOS_S1, type ChaveModelo } from '@atd/core'
import type { Db } from './client.ts'
import { exigirPapel, falha, ok, registrarAuditoria, semPermissaoVira, type ResultadoPainel } from './painel-comum.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { taxaRespostaIa } from './s1.ts'
import { units } from './schema/restaurant.ts'
import { knowledgeFacts, knowledgeGaps, replyTemplates } from './schema/s1.ts'

const GESTAO = ['dono', 'gerente'] as const
const ehChaveModelo = (c: string): c is ChaveModelo => Object.hasOwn(MODELOS_S1, c)

export type LacunaPainel = {
  id: string
  chave: string
  unitId: string | null
  unidade: string | null
  pergunta: string | null
  ocorrencias: number
  ultimaVez: Date
}
export type FatoInput = { tema: string; exemplos: string[]; texto: string; unitId: string | null; ativo: boolean }
export type FatoPainel = FatoInput & { id: string; unidade: string | null }

export function listarLacunas(db: Db, claims: JwtClaims, limite = 100): Promise<LacunaPainel[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: knowledgeGaps.id,
        chave: knowledgeGaps.chaveNormalizada,
        unitId: knowledgeGaps.unitId,
        unidade: units.nome,
        pergunta: knowledgeGaps.perguntaMascarada,
        ocorrencias: knowledgeGaps.ocorrencias,
        ultimaVez: knowledgeGaps.ultimaVez,
      })
      .from(knowledgeGaps)
      .leftJoin(units, eq(units.id, knowledgeGaps.unitId))
      .where(eq(knowledgeGaps.status, 'aberta'))
      .orderBy(desc(knowledgeGaps.ocorrencias), desc(knowledgeGaps.ultimaVez))
      .limit(limite),
  )
}

export function responderLacuna(
  db: Db,
  claims: JwtClaims,
  restaurantId: string,
  lacunaId: string,
  fato: FatoInput,
): Promise<ResultadoPainel<{ factId: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const [g] = await tx
      .select({ id: knowledgeGaps.id })
      .from(knowledgeGaps)
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
    if (!g) return falha('nao_encontrada')
    const [f] = await tx.insert(knowledgeFacts).values({ restaurantId, ...fato }).returning({ id: knowledgeFacts.id })
    const fechadas = await tx
      .update(knowledgeGaps)
      .set({ status: 'respondida', factId: f!.id })
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
      .returning({ id: knowledgeGaps.id })
    // lacuna visível mas não atualizável (policy) ou fechada por outra pessoa agora: desfaz o fato
    if (fechadas.length === 0) throw Object.assign(new Error('lacuna não pôde ser fechada'), { cause: { code: '42501' } })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'lacuna.respondida', entidade: 'knowledge_gap', entidadeId: lacunaId, diff: { factId: f!.id, tema: fato.tema } })
    return ok({ factId: f!.id })
  }))
}

export function ignorarLacuna(db: Db, claims: JwtClaims, restaurantId: string, lacunaId: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const r = await tx
      .update(knowledgeGaps)
      .set({ status: 'ignorada' })
      .where(and(eq(knowledgeGaps.id, lacunaId), eq(knowledgeGaps.status, 'aberta')))
      .returning({ id: knowledgeGaps.id })
    if (r.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'lacuna.ignorada', entidade: 'knowledge_gap', entidadeId: lacunaId })
    return ok(null)
  }))
}

export function listarFatos(db: Db, claims: JwtClaims): Promise<FatoPainel[]> {
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: knowledgeFacts.id,
        tema: knowledgeFacts.tema,
        exemplos: knowledgeFacts.exemplos,
        texto: knowledgeFacts.texto,
        unitId: knowledgeFacts.unitId,
        ativo: knowledgeFacts.ativo,
        unidade: units.nome,
      })
      .from(knowledgeFacts)
      .leftJoin(units, eq(units.id, knowledgeFacts.unitId))
      .orderBy(asc(knowledgeFacts.tema)),
  )
}

export function salvarFato(db: Db, claims: JwtClaims, restaurantId: string, id: string | null, fato: FatoInput): Promise<ResultadoPainel<{ id: string }>> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    if (id === null) {
      const [f] = await tx.insert(knowledgeFacts).values({ restaurantId, ...fato }).returning({ id: knowledgeFacts.id })
      await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.criado', entidade: 'knowledge_fact', entidadeId: f!.id, diff: fato })
      return ok({ id: f!.id })
    }
    const [f] = await tx.update(knowledgeFacts).set(fato).where(eq(knowledgeFacts.id, id)).returning({ id: knowledgeFacts.id })
    if (!f) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.atualizado', entidade: 'knowledge_fact', entidadeId: f.id, diff: fato })
    return ok({ id: f.id })
  }))
}

export function removerFato(db: Db, claims: JwtClaims, restaurantId: string, id: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    const r = await tx.delete(knowledgeFacts).where(eq(knowledgeFacts.id, id)).returning({ id: knowledgeFacts.id })
    if (r.length === 0) return falha('nao_encontrada')
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'fato.removido', entidade: 'knowledge_fact', entidadeId: id })
    return ok(null)
  }))
}

export function listarModelos(db: Db, claims: JwtClaims): Promise<Partial<Record<ChaveModelo, string>>> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx.select({ chave: replyTemplates.chave, texto: replyTemplates.texto }).from(replyTemplates)
    const out: Partial<Record<ChaveModelo, string>> = {}
    for (const r of rows) if (ehChaveModelo(r.chave)) out[r.chave] = r.texto
    return out
  })
}

export function salvarModelo(db: Db, claims: JwtClaims, restaurantId: string, chave: ChaveModelo, texto: string): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    await tx
      .insert(replyTemplates)
      .values({ restaurantId, chave, texto })
      .onConflictDoUpdate({ target: [replyTemplates.restaurantId, replyTemplates.chave], set: { texto } })
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'modelo.salvo', entidade: 'reply_template', entidadeId: chave, diff: { texto } })
    return ok(null)
  }))
}

export function restaurarModelo(db: Db, claims: JwtClaims, restaurantId: string, chave: ChaveModelo): Promise<ResultadoPainel> {
  return semPermissaoVira(() => withUserContext(db, claims, async (tx) => {
    if (!(await exigirPapel(tx, GESTAO))) return falha('sem_permissao')
    await tx.delete(replyTemplates).where(eq(replyTemplates.chave, chave))
    await registrarAuditoria(tx, claims, { restaurantId, acao: 'modelo.restaurado', entidade: 'reply_template', entidadeId: chave })
    return ok(null)
  }))
}

export async function resumoInicio(db: Db, claims: JwtClaims, agora: Date = new Date()) {
  // em sequência: o web usa uma conexão só (pooler em modo transaction)
  const taxa = await taxaRespostaIa(db, claims, agora)
  const lacunas = await listarLacunas(db, claims, 3)
  return { taxa, lacunas }
}
```

`packages/db/src/index.ts` — acrescentar `export * from './painel-respostas.ts'`.

- [ ] **Step 4: Rodar**

Run: `pnpm vitest run --project db packages/db/src/painel-respostas.db.test.ts && pnpm --filter @atd/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src
git commit -m "Adiciona funções do painel para lacunas, informações, modelos e resumo do Início

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Servidor das telas — schemas compartilhados, link do Maps e Server Actions

**Files:**
- Create: `apps/web/lib/schemas/unidades.ts`, `apps/web/lib/schemas/respostas.ts`, `apps/web/lib/schemas/restaurante.ts`, `apps/web/lib/schemas/schemas.test.ts`, `apps/web/lib/maps-link.ts`, `apps/web/lib/maps-link.test.ts`, `apps/web/lib/painel-erros.ts`, `apps/web/app/(painel)/unidades/actions.ts`, `apps/web/app/(painel)/unidades/actions.test.ts`, `apps/web/app/(painel)/respostas/actions.ts`, `apps/web/app/(painel)/respostas/actions.test.ts`, `apps/web/app/(painel)/mais/actions.ts`

**Interfaces:**
- Regra de import: tudo que roda no navegador (schemas, componentes) importa de **`@atd/core/s1`**, nunca de `@atd/core` (que puxa `node:crypto`); e nunca importa valores de `@atd/db` (só `import type`).
- Consumes: funções do painel (Tasks 3–4); `ehLinkGoogleMaps`, `ehLinkCurtoMaps`, `ehHostGoogleMaps`, `extrairCoordenadas`, `validarSemana`, `validarTurnos`, `validarModelo`, `MODELOS_S1`, `ChaveModelo` (`@atd/core`); `hora`, `dataBr`, `telefoneBr` (`@/lib/validation`); `ActionResult`, `actionErrorFromZod`; `requireStaff`.
- Produces (usados pelas telas das Tasks 6–11):
  - schemas: `dadosUnidadeSchema` (+ `DadosUnidadeForm`), `horariosSchema` (+ `HorariosForm`), `excecaoSchema` (+ `ExcecaoForm`), `restauranteSchema` (+ `RestauranteForm`), `fatoSchema` (+ `FatoForm`; `unitId: ''` = todas as unidades), `modeloSchema(chave)` (+ `ModeloForm`)
  - `coordenadasDoLink(link, fetch?): Promise<Coordenadas | null>` (segue no máximo 3 redirecionamentos de link curto, só para hosts do Google Maps, 5 s cada)
  - `resultadoDoPainel(r, campos?)`: `ResultadoPainel` ⇒ `ActionResult` (mensagem em pt-BR; `nome_duplicado` vai para o campo `nome`)
  - actions (unidades): `salvarDadosUnidadeAction(id | null, DadosUnidadeForm) → ActionResult<{ id }>`, `salvarHorariosAction(unitId, HorariosForm) → ActionResult<null>`, `salvarExcecaoAction(unitId, ExcecaoForm)`, `removerExcecaoAction(unitId, dataIso)`
  - actions (respostas): `responderLacunaAction(lacunaId, FatoForm) → ActionResult<{ factId }>`, `ignorarLacunaAction(lacunaId)`, `salvarFatoAction(id | null, FatoForm) → ActionResult<{ id }>`, `removerFatoAction(id)`, `salvarModeloAction(chave, ModeloForm)`, `restaurarModeloAction(chave)`
  - action (mais): `salvarRestauranteAction(RestauranteForm)` (só dono)

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/schemas/schemas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fatoSchema, modeloSchema } from './respostas'
import { restauranteSchema } from './restaurante'
import { dadosUnidadeSchema, excecaoSchema, horariosSchema } from './unidades'

const unidade = { nome: 'Asa Sul', endereco: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true }
const msgs = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))

describe('schemas do painel', () => {
  it('unidade: mensagens exatas e normalização', () => {
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, nome: ' ' }))).toEqual({ nome: 'Informe o nome da unidade, como "Asa Sul"' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, uf: 'Distrito' }))).toEqual({ uf: 'Use a sigla do estado, como DF' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, cep: '7039' }))).toEqual({ cep: 'Use os 8 números do CEP, como 70390-040' })
    expect(msgs(dadosUnidadeSchema.safeParse({ ...unidade, mapsUrl: 'https://evil.com/maps' }))).toEqual({
      mapsUrl: 'Cole um link do Google Maps (no app: Compartilhar → Copiar link)',
    })
    const ok = dadosUnidadeSchema.parse({ ...unidade, uf: 'df', cep: '70390-040', telefone: '(61) 3333-4444' })
    expect(ok).toMatchObject({ uf: 'DF', cep: '70390040', telefone: '6133334444' })
  })

  it('horários: erro no dia certo; madrugada invadindo o dia seguinte', () => {
    const semanal = [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][]
    semanal[2] = [{ abre: '11:00', fecha: '11:00' }]
    expect(msgs(horariosSchema.safeParse({ semanal }))).toEqual({ 'semanal.2': 'Turno 1: a abertura e o fechamento não podem ser iguais.' })
    semanal[2] = [{ abre: '25:00', fecha: '11:00' }]
    expect(msgs(horariosSchema.safeParse({ semanal }))).toEqual({ 'semanal.2.0.abre': 'Use o formato 24h HH:mm, como 11:30' })
  })

  it('exceção: data dd/mm/aaaa vira ISO; aberta sem turno pede turno', () => {
    expect(excecaoSchema.parse({ data: '25/12/2026', fechado: true, turnos: [], motivo: 'Natal' }).data).toBe('2026-12-25')
    expect(msgs(excecaoSchema.safeParse({ data: '24/12/2026', fechado: false, turnos: [], motivo: '' }))).toEqual({
      turnos: 'Adicione pelo menos um turno ou marque "Fechado o dia todo".',
    })
  })

  it('restaurante, informação e modelo', () => {
    expect(msgs(restauranteSchema.safeParse({ nome: 'Casa', politicaFeriado: 'normal', politicaUrl: 'http://x' }))).toEqual({
      politicaUrl: 'Use um link completo que comece com https://',
    })
    expect(msgs(fatoSchema.safeParse({ tema: '', exemplos: [], texto: '', unitId: '', ativo: true }))).toEqual({
      tema: 'Informe o assunto, como "Estacionamento"',
      texto: 'Escreva a resposta que a IA deve enviar',
    })
    expect(msgs(modeloSchema('horario_dia').safeParse({ texto: '{quando}, abrimos.' }))).toEqual({
      texto: 'Inclua {turnos} no texto: é ali que entra a informação.',
    })
  })
})
```

`apps/web/lib/maps-link.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { coordenadasDoLink } from './maps-link'

const redireciona = (...destinos: (string | null)[]) => {
  let i = 0
  return vi.fn(async () => new Response(null, { status: 302, headers: destinos[i] ? { location: destinos[i++]! } : {} })) as unknown as typeof fetch
}

describe('coordenadasDoLink', () => {
  it('link completo não usa a rede', async () => {
    const f = vi.fn() as unknown as typeof fetch
    expect(await coordenadasDoLink('https://www.google.com/maps/@-15.8,-47.9,17z', f)).toEqual({ lat: -15.8, lng: -47.9 })
    expect(f).not.toHaveBeenCalled()
  })
  it('link curto: segue o redirecionamento para o Google Maps', async () => {
    const f = redireciona('https://www.google.com/maps/place/X/@-15.81,-47.89,17z')
    expect(await coordenadasDoLink('https://maps.app.goo.gl/Ab12', f)).toEqual({ lat: -15.81, lng: -47.89 })
  })
  it('não segue redirecionamento para fora do Google nem além de 3 saltos', async () => {
    expect(await coordenadasDoLink('https://maps.app.goo.gl/Ab12', redireciona('https://evil.com/maps/@1,2'))).toBeNull()
    const curto = 'https://maps.app.goo.gl/Loop'
    expect(await coordenadasDoLink(curto, redireciona(curto, curto, curto, curto))).toBeNull()
    expect(await coordenadasDoLink(curto, redireciona(null))).toBeNull()
    const quebra = vi.fn(async () => { throw new Error('rede') }) as unknown as typeof fetch
    expect(await coordenadasDoLink(curto, quebra)).toBeNull()
  })
})
```

`apps/web/app/(painel)/unidades/actions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarUnidade = vi.fn()
const coordenadasDoLink = vi.fn()
const revalidatePath = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('@/lib/maps-link', () => ({ coordenadasDoLink }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@atd/db', () => ({ salvarUnidade, salvarHorarios: vi.fn(), salvarExcecao: vi.fn(), removerExcecao: vi.fn() }))

const { salvarDadosUnidadeAction } = await import('./actions')
const ID = '00000000-0000-4000-8000-000000000001'
const form = { nome: 'Asa Sul', endereco: 'SCLS 404', bairro: '', cidade: '', uf: 'df', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true }

describe('salvarDadosUnidadeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('exige dono ou gerente', async () => {
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    await salvarDadosUnidadeAction(null, form)
    expect(requireStaff).toHaveBeenCalledWith(['dono', 'gerente'])
  })
  it('entrada inválida não chega ao banco', async () => {
    expect(await salvarDadosUnidadeAction(null, { ...form, nome: '' })).toEqual({
      ok: false, fieldErrors: { nome: 'Informe o nome da unidade, como "Asa Sul"' },
    })
    expect(await salvarDadosUnidadeAction('não-é-uuid', form)).toEqual({ ok: false, formError: 'Não encontramos essa unidade.' })
    expect(salvarUnidade).not.toHaveBeenCalled()
  })
  it('link do Maps ilegível vira erro no campo', async () => {
    coordenadasDoLink.mockResolvedValue(null)
    const r = await salvarDadosUnidadeAction(null, { ...form, mapsUrl: 'https://maps.app.goo.gl/x' })
    expect(r).toMatchObject({ ok: false, fieldErrors: { mapsUrl: expect.stringContaining('Compartilhar → Copiar link') } })
    expect(salvarUnidade).not.toHaveBeenCalled()
  })
  it('salva com vazios como nulo e coordenadas do link; nome repetido vai para o campo', async () => {
    coordenadasDoLink.mockResolvedValue({ lat: -15.8, lng: -47.9 })
    salvarUnidade.mockResolvedValue({ ok: true, valor: { id: ID } })
    expect(await salvarDadosUnidadeAction(null, { ...form, mapsUrl: 'https://www.google.com/maps/@-15.8,-47.9,17z' })).toEqual({ ok: true, data: { id: ID } })
    expect(salvarUnidade).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', null, expect.objectContaining({
      endereco: 'SCLS 404', bairro: null, uf: 'DF', cep: null, telefone: null, lat: -15.8, lng: -47.9,
    }))
    expect(revalidatePath).toHaveBeenCalledWith('/unidades')
    salvarUnidade.mockResolvedValue({ ok: false, erro: 'nome_duplicado' })
    expect(await salvarDadosUnidadeAction(null, form)).toEqual({ ok: false, fieldErrors: { nome: 'Já existe uma unidade com esse nome.' } })
  })
})
```

`apps/web/app/(painel)/respostas/actions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const salvarModelo = vi.fn()
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => 'db' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@atd/db', () => ({
  salvarModelo, restaurarModelo: vi.fn(), responderLacuna: vi.fn(), ignorarLacuna: vi.fn(), salvarFato: vi.fn(), removerFato: vi.fn(),
}))

const { salvarModeloAction } = await import('./actions')

describe('salvarModeloAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue({ claims: { sub: 'u' }, restaurantId: 'r' })
  })
  it('chave desconhecida e texto inválido não chegam ao banco', async () => {
    expect(await salvarModeloAction('nao_existe', { texto: 'x' })).toEqual({ ok: false, formError: 'Modelo desconhecido.' })
    expect(await salvarModeloAction('horario_dia', { texto: '{quando}, abrimos.' })).toEqual({
      ok: false, fieldErrors: { texto: 'Inclua {turnos} no texto: é ali que entra a informação.' },
    })
    expect(salvarModelo).not.toHaveBeenCalled()
  })
  it('texto válido é salvo', async () => {
    salvarModelo.mockResolvedValue({ ok: true, valor: null })
    expect(await salvarModeloAction('lacuna', { texto: 'Vou confirmar com a equipe.' })).toEqual({ ok: true, data: null })
    expect(salvarModelo).toHaveBeenCalledWith('db', { sub: 'u' }, 'r', 'lacuna', 'Vou confirmar com a equipe.')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib apps/web/app`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Schemas**

`apps/web/lib/schemas/unidades.ts`:
```ts
import { z } from 'zod'
import { ehLinkGoogleMaps, validarSemana, validarTurnos } from '@atd/core/s1'
import { dataBr, hora, telefoneBr } from '@/lib/validation'

const opcional = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres`)
const turno = z.object({ abre: hora, fecha: hora })

export const dadosUnidadeSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome da unidade, como "Asa Sul"').max(60, 'Use no máximo 60 caracteres'),
  endereco: opcional(120),
  bairro: opcional(60),
  cidade: opcional(60),
  uf: z.string().trim().toUpperCase().refine((v) => v === '' || /^[A-Z]{2}$/.test(v), 'Use a sigla do estado, como DF'),
  cep: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{5}-?\d{3}$/.test(v), 'Use os 8 números do CEP, como 70390-040')
    .transform((v) => v.replace('-', '')),
  telefone: z.string().trim().pipe(z.union([z.literal(''), telefoneBr])),
  apelidos: z.array(z.string().trim().min(1).max(40, 'Cada apelido pode ter até 40 caracteres')).max(10, 'Use no máximo 10 apelidos'),
  mapsUrl: z.string().trim().refine((v) => v === '' || ehLinkGoogleMaps(v), 'Cole um link do Google Maps (no app: Compartilhar → Copiar link)'),
  ativo: z.boolean(),
})
export type DadosUnidadeForm = z.input<typeof dadosUnidadeSchema>

export const horariosSchema = z
  .object({ semanal: z.array(z.array(turno).max(6, 'Use no máximo 6 turnos por dia')).length(7) })
  .superRefine((v, ctx) => {
    const e = validarSemana(v.semanal)
    if (e) ctx.addIssue({ code: 'custom', path: ['semanal', e.dia], message: e.erro })
  })
export type HorariosForm = z.input<typeof horariosSchema>

export const excecaoSchema = z
  .object({
    data: dataBr,
    fechado: z.boolean(),
    turnos: z.array(turno).max(6, 'Use no máximo 6 turnos'),
    motivo: opcional(80),
  })
  .superRefine((v, ctx) => {
    if (v.fechado) return
    if (v.turnos.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['turnos'], message: 'Adicione pelo menos um turno ou marque "Fechado o dia todo".' })
      return
    }
    const e = validarTurnos(v.turnos)
    if (e) ctx.addIssue({ code: 'custom', path: ['turnos'], message: e })
  })
export type ExcecaoForm = z.input<typeof excecaoSchema>
```

`apps/web/lib/schemas/restaurante.ts`:
```ts
import { z } from 'zod'

export const restauranteSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do restaurante').max(80, 'Use no máximo 80 caracteres'),
  politicaFeriado: z.enum(['normal', 'fechado', 'como_domingo'], { error: 'Escolha como funciona nos feriados' }),
  politicaUrl: z.string().trim().refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Use um link completo que comece com https://'),
})
export type RestauranteForm = z.input<typeof restauranteSchema>
```

`apps/web/lib/schemas/respostas.ts`:
```ts
import { z } from 'zod'
import { validarModelo, type ChaveModelo } from '@atd/core/s1'

export const fatoSchema = z.object({
  tema: z.string().trim().min(1, 'Informe o assunto, como "Estacionamento"').max(120, 'Use no máximo 120 caracteres'),
  exemplos: z.array(z.string().trim().min(1).max(120, 'Cada exemplo pode ter até 120 caracteres')).max(10, 'Use no máximo 10 exemplos'),
  texto: z.string().trim().min(1, 'Escreva a resposta que a IA deve enviar').max(1000, 'Use no máximo 1000 caracteres'),
  /** '' = vale para todas as unidades */
  unitId: z.union([z.literal(''), z.uuid('Escolha uma unidade da lista')]),
  ativo: z.boolean(),
})
export type FatoForm = z.input<typeof fatoSchema>

export const modeloSchema = (chave: ChaveModelo) =>
  z.object({ texto: z.string() }).superRefine((v, ctx) => {
    const e = validarModelo(chave, v.texto)
    if (e) ctx.addIssue({ code: 'custom', path: ['texto'], message: e })
  })
export type ModeloForm = { texto: string }
```

- [ ] **Step 4: Link do Maps e erros do painel**

`apps/web/lib/maps-link.ts`:
```ts
import { ehHostGoogleMaps, ehLinkCurtoMaps, extrairCoordenadas, type Coordenadas } from '@atd/core'

const MAX_SALTOS = 3
const TIMEOUT_MS = 5_000

/**
 * Coordenadas de um link do Google Maps. Link curto (maps.app.goo.gl) é seguido só por
 * redirecionamentos para hosts do Google Maps, sem baixar páginas.
 */
export async function coordenadasDoLink(link: string, f: typeof fetch = fetch): Promise<Coordenadas | null> {
  let atual = link.trim()
  for (let i = 0; ehLinkCurtoMaps(atual); i++) {
    if (i >= MAX_SALTOS) return null
    let destino: string | null
    try {
      const res = await f(atual, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      destino = res.headers.get('location')
      await res.body?.cancel()
    } catch {
      return null
    }
    if (!destino) return null
    let proximo: URL
    try {
      proximo = new URL(destino, atual)
    } catch {
      return null
    }
    if (proximo.protocol !== 'https:' || !ehHostGoogleMaps(proximo.hostname)) return null
    atual = proximo.toString()
  }
  return extrairCoordenadas(atual)
}
```

`apps/web/lib/painel-erros.ts`:
```ts
import type { ErroPainel, ResultadoPainel } from '@atd/db'
import type { ActionResult } from '@/lib/action-result'

export const MENSAGEM_ERRO_PAINEL: Record<ErroPainel, string> = {
  sem_permissao: 'Você não tem permissão para fazer essa alteração.',
  nao_encontrada: 'Não encontramos esse item. Ele pode ter sido removido ou você não tem acesso a ele.',
  nome_duplicado: 'Já existe uma unidade com esse nome.',
}

/** Converte o resultado do banco em ActionResult; `campos` envia um erro para um campo do formulário. */
export function resultadoDoPainel<T>(r: ResultadoPainel<T>, campos: Partial<Record<ErroPainel, string>> = {}): ActionResult<T> {
  if (r.ok) return { ok: true, data: r.valor }
  const campo = campos[r.erro]
  return campo
    ? { ok: false, fieldErrors: { [campo]: MENSAGEM_ERRO_PAINEL[r.erro] } }
    : { ok: false, formError: MENSAGEM_ERRO_PAINEL[r.erro] }
}
```

- [ ] **Step 5: Server Actions**

`apps/web/app/(painel)/unidades/actions.ts`:
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { removerExcecao, salvarExcecao, salvarHorarios, salvarUnidade } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { coordenadasDoLink } from '@/lib/maps-link'
import { resultadoDoPainel } from '@/lib/painel-erros'
import {
  dadosUnidadeSchema, excecaoSchema, horariosSchema, type DadosUnidadeForm, type ExcecaoForm, type HorariosForm,
} from '@/lib/schemas/unidades'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADA = { ok: false as const, formError: 'Não encontramos essa unidade.' }
const LINK_ILEGIVEL =
  'Não consegui ler a localização desse link. Abra o local no Google Maps, toque em Compartilhar → Copiar link e cole aqui.'
const idValido = (id: string) => z.uuid().safeParse(id).success
const nulo = (v: string) => (v === '' ? null : v)

function revalidarUnidade(id: string) {
  revalidatePath('/unidades')
  revalidatePath(`/unidades/${id}`)
}

export async function salvarDadosUnidadeAction(id: string | null, input: DadosUnidadeForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADA
  const p = dadosUnidadeSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const d = p.data
  let coords: { lat: number; lng: number } | null = null
  if (d.mapsUrl) {
    coords = await coordenadasDoLink(d.mapsUrl)
    if (!coords) return { ok: false, fieldErrors: { mapsUrl: LINK_ILEGIVEL } }
  }
  const r = await salvarUnidade(getDb(), s.claims, s.restaurantId, id, {
    nome: d.nome,
    endereco: nulo(d.endereco),
    bairro: nulo(d.bairro),
    cidade: nulo(d.cidade),
    uf: nulo(d.uf),
    cep: nulo(d.cep),
    telefone: nulo(d.telefone),
    apelidos: d.apelidos,
    mapsUrl: nulo(d.mapsUrl),
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    ativo: d.ativo,
  })
  if (r.ok) revalidarUnidade(r.valor.id)
  return resultadoDoPainel(r, { nome_duplicado: 'nome' })
}

export async function salvarHorariosAction(unitId: string, input: HorariosForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId)) return NAO_ENCONTRADA
  const p = horariosSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarHorarios(getDb(), s.claims, s.restaurantId, unitId, p.data.semanal)
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}

export async function salvarExcecaoAction(unitId: string, input: ExcecaoForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId)) return NAO_ENCONTRADA
  const p = excecaoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarExcecao(getDb(), s.claims, s.restaurantId, unitId, {
    data: p.data.data,
    fechado: p.data.fechado,
    turnos: p.data.turnos,
    motivo: nulo(p.data.motivo),
  })
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}

export async function removerExcecaoAction(unitId: string, data: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(unitId) || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return NAO_ENCONTRADA
  const r = await removerExcecao(getDb(), s.claims, s.restaurantId, unitId, data)
  if (r.ok) revalidarUnidade(unitId)
  return resultadoDoPainel(r)
}
```

`apps/web/app/(painel)/respostas/actions.ts`:
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { MODELOS_S1, type ChaveModelo } from '@atd/core'
import { ignorarLacuna, removerFato, responderLacuna, restaurarModelo, salvarFato, salvarModelo } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { fatoSchema, modeloSchema, type FatoForm, type ModeloForm } from '@/lib/schemas/respostas'
import { getDb } from '@/lib/server/db'

const GESTAO: ['dono', 'gerente'] = ['dono', 'gerente']
const NAO_ENCONTRADO = { ok: false as const, formError: 'Não encontramos esse item.' }
const idValido = (id: string) => z.uuid().safeParse(id).success
const ehChave = (c: string): c is ChaveModelo => Object.hasOwn(MODELOS_S1, c)

function revalidar() {
  revalidatePath('/respostas')
  revalidatePath('/')
}

function paraFato(f: z.output<typeof fatoSchema>) {
  return { tema: f.tema, exemplos: f.exemplos, texto: f.texto, unitId: f.unitId === '' ? null : f.unitId, ativo: f.ativo }
}

export async function responderLacunaAction(lacunaId: string, input: FatoForm): Promise<ActionResult<{ factId: string }>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(lacunaId)) return NAO_ENCONTRADO
  const p = fatoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await responderLacuna(getDb(), s.claims, s.restaurantId, lacunaId, paraFato(p.data))
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function ignorarLacunaAction(lacunaId: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(lacunaId)) return NAO_ENCONTRADO
  const r = await ignorarLacuna(getDb(), s.claims, s.restaurantId, lacunaId)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function salvarFatoAction(id: string | null, input: FatoForm): Promise<ActionResult<{ id: string }>> {
  const s = await requireStaff(GESTAO)
  if (id !== null && !idValido(id)) return NAO_ENCONTRADO
  const p = fatoSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarFato(getDb(), s.claims, s.restaurantId, id, paraFato(p.data))
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function removerFatoAction(id: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!idValido(id)) return NAO_ENCONTRADO
  const r = await removerFato(getDb(), s.claims, s.restaurantId, id)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function salvarModeloAction(chave: string, input: ModeloForm): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!ehChave(chave)) return { ok: false, formError: 'Modelo desconhecido.' }
  const p = modeloSchema(chave).safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarModelo(getDb(), s.claims, s.restaurantId, chave, p.data.texto)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}

export async function restaurarModeloAction(chave: string): Promise<ActionResult<null>> {
  const s = await requireStaff(GESTAO)
  if (!ehChave(chave)) return { ok: false, formError: 'Modelo desconhecido.' }
  const r = await restaurarModelo(getDb(), s.claims, s.restaurantId, chave)
  if (r.ok) revalidar()
  return resultadoDoPainel(r)
}
```

`apps/web/app/(painel)/mais/actions.ts`:
```ts
'use server'
import { revalidatePath } from 'next/cache'
import { salvarRestaurante } from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import { resultadoDoPainel } from '@/lib/painel-erros'
import { restauranteSchema, type RestauranteForm } from '@/lib/schemas/restaurante'
import { getDb } from '@/lib/server/db'

export async function salvarRestauranteAction(input: RestauranteForm): Promise<ActionResult<null>> {
  const s = await requireStaff(['dono'])
  const p = restauranteSchema.safeParse(input)
  if (!p.success) return actionErrorFromZod(p.error)
  const r = await salvarRestaurante(getDb(), s.claims, s.restaurantId, {
    nome: p.data.nome,
    politicaFeriado: p.data.politicaFeriado,
    politicaUrl: p.data.politicaUrl === '' ? null : p.data.politicaUrl,
  })
  if (r.ok) revalidatePath('/', 'layout')
  return resultadoDoPainel(r)
}
```

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib apps/web/app && pnpm --filter @atd/web typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib apps/web/app
git commit -m "Adiciona schemas, leitura de link do Maps e Server Actions das telas de S1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Peças de UI do painel e lista de Unidades com selo "Aberta agora"

**Files:**
- Create: `apps/web/components/painel/folha-formulario.tsx`, `apps/web/components/painel/confirmar.tsx`, `apps/web/components/painel/abas.tsx`, `apps/web/components/painel/selo-unidade.tsx`, `apps/web/components/painel/dados-unidade-form.tsx`, `apps/web/components/painel/nova-unidade.tsx`, `apps/web/components/painel/painel-ui.test.tsx`, `apps/web/lib/selo-unidade.ts`, `apps/web/lib/selo-unidade.test.ts`, `apps/web/app/(painel)/unidades/loading.tsx`
- Modify: `apps/web/app/(painel)/unidades/page.tsx`

**Interfaces:**
- Consumes: `carregarUnidadesPainel`, `type UnidadePainel` (`@atd/db`, só no servidor); `salvarDadosUnidadeAction`, `dadosUnidadeSchema`, `DadosUnidadeForm` (Task 5); componentes de `@/components/form`, `@/components/ui/*`, `TopBar`, `EmptyState`.
- Produces (reusados pelas Tasks 7–11):
  - `FolhaFormulario({ aberto, onAbertoChange, titulo, descricao?, children })` — *bottom sheet* no celular, diálogo a partir de 768 px
  - `Confirmar({ aberto, onAbertoChange, titulo, descricao, rotuloConfirmar, onConfirmar })` — confirmação antes de apagar
  - `Abas({ rotulo, itens: { href; rotulo; ativo }[] })` — navegação por abas com `aria-current="page"`
  - `seloDaUnidade(u, politica, timezone, agora): { tom: 'aberta' | 'fechada' | 'alerta'; texto }` e o componente `SeloUnidade({ selo })`
  - `DadosUnidadeForm({ inicial, acao, onSalvo?, somenteLeitura? })` e `UNIDADE_VAZIA`
  - `NovaUnidade()` — botão "Nova unidade" que abre a folha e leva à aba Horários depois de salvar

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/selo-unidade.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { seloDaUnidade } from './selo-unidade'

const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const todo = (abre: string, fecha: string) => Array.from({ length: 7 }, () => [{ abre, fecha }])
const u = (semanal: { abre: string; fecha: string }[][], ativo = true) => ({ ativo, semanal, excecoes: {} })

describe('seloDaUnidade', () => {
  it('aberta, fechada com próxima abertura, sem horário e desativada', () => {
    expect(seloDaUnidade(u(todo('11:00', '23:00')), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'aberta', texto: 'Aberta agora · fecha às 23h' })
    const semSegunda = todo('11:30', '15:00')
    semSegunda[1] = []
    expect(seloDaUnidade(u(semSegunda), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'fechada', texto: 'Fechada · abre amanhã às 11h30' })
    expect(seloDaUnidade(u([[], [], [], [], [], [], []]), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'alerta', texto: 'Horário não cadastrado' })
    expect(seloDaUnidade(u(todo('11:00', '23:00'), false), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'alerta', texto: 'Desativada' })
    expect(seloDaUnidade(u(todo('00:00', '23:59')), 'como_domingo', 'America/Sao_Paulo', SEG_14H))
      .toEqual({ tom: 'aberta', texto: 'Aberta agora · fecha às 23h59' })
  })
})
```

`apps/web/components/painel/painel-ui.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Confirmar } from './confirmar'
import { DadosUnidadeForm, UNIDADE_VAZIA } from './dados-unidade-form'

describe('DadosUnidadeForm', () => {
  it('envio vazio: erro no campo certo, foco nele e resumo; não chama a ação', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<DadosUnidadeForm inicial={UNIDADE_VAZIA} acao={acao} />)
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(screen.getByLabelText(/^Nome da unidade/)).toHaveFocus()
    expect(screen.getAllByText(/Informe o nome da unidade, como "Asa Sul"/).length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Corrija 1 campo' })).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('erro do servidor aparece no campo; link do Maps reconhecido ganha confirmação', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: false, fieldErrors: { nome: 'Já existe uma unidade com esse nome.' } })
    render(<DadosUnidadeForm inicial={UNIDADE_VAZIA} acao={acao} />)
    await user.type(screen.getByLabelText(/^Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/^Link do Google Maps/), 'https://maps.app.goo.gl/Ab12')
    expect(screen.getByText('Link do Google Maps reconhecido')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar unidade' }))
    expect(await screen.findByText('Já existe uma unidade com esse nome.')).toBeInTheDocument()
    expect(acao).toHaveBeenCalledWith(expect.objectContaining({ nome: 'Asa Sul', mapsUrl: 'https://maps.app.goo.gl/Ab12' }))
  })

  it('somente leitura: campos desabilitados e sem botão de salvar', () => {
    render(<DadosUnidadeForm inicial={{ ...UNIDADE_VAZIA, nome: 'Asa Sul' }} acao={vi.fn()} somenteLeitura />)
    expect(screen.getByLabelText(/^Nome da unidade/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar unidade' })).toBeNull()
  })
})

describe('Confirmar', () => {
  it('só apaga depois de confirmar', async () => {
    const user = userEvent.setup()
    const onConfirmar = vi.fn()
    const onAbertoChange = vi.fn()
    render(<Confirmar aberto onAbertoChange={onAbertoChange} titulo="Apagar exceção?" descricao="Não dá para desfazer." rotuloConfirmar="Apagar" onConfirmar={onConfirmar} />)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onConfirmar).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apagar' }))
    expect(onConfirmar).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/selo-unidade.test.ts && pnpm vitest run --project ui apps/web/components/painel`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Selo**

`apps/web/lib/selo-unidade.ts`:
```ts
import {
  agoraLocal, asHora, estadoAgora, feriadosNacionais, mapaFeriados, quandoAbre, temHorarioCadastrado,
  type AgendaUnidade, type PoliticaFeriado,
} from '@atd/core/s1'

export type Selo = { tom: 'aberta' | 'fechada' | 'alerta'; texto: string }

export function seloDaUnidade(u: AgendaUnidade & { ativo: boolean }, politica: PoliticaFeriado, timezone: string, agora: Date): Selo {
  if (!u.ativo) return { tom: 'alerta', texto: 'Desativada' }
  if (!temHorarioCadastrado(u)) return { tom: 'alerta', texto: 'Horário não cadastrado' }
  const local = agoraLocal(agora, timezone)
  const ano = Number(local.data.slice(0, 4))
  const e = estadoAgora(u, politica, mapaFeriados([...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]), local)
  if (e.aberta) return { tom: 'aberta', texto: `Aberta agora · fecha ${asHora(e.fecha.hora)}` }
  if (e.abre) return { tom: 'fechada', texto: `Fechada · abre ${quandoAbre(e.abre.data, local.data)} ${asHora(e.abre.hora)}` }
  return { tom: 'fechada', texto: 'Fechada' }
}
```

`apps/web/components/painel/selo-unidade.tsx`:
```tsx
import { AlertTriangle, CircleDot, Moon } from 'lucide-react'
import type { Selo } from '@/lib/selo-unidade'
import { cn } from '@/lib/utils'

const ICONE = { aberta: CircleDot, fechada: Moon, alerta: AlertTriangle } as const

export function SeloUnidade({ selo }: { selo: Selo }) {
  const Icone = ICONE[selo.tom]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-sm font-medium',
        selo.tom === 'aberta' && 'text-success',
        selo.tom === 'fechada' && 'text-muted-foreground',
        selo.tom === 'alerta' && 'text-warning',
      )}
    >
      <Icone aria-hidden="true" className="size-4" />
      {selo.texto}
    </span>
  )
}
```

- [ ] **Step 4: Peças reutilizáveis**

`apps/web/components/painel/folha-formulario.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

function useDesktop() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)')
    const atualizar = () => setDesktop(m.matches)
    atualizar()
    m.addEventListener('change', atualizar)
    return () => m.removeEventListener('change', atualizar)
  }, [])
  return desktop
}

/** Formulário em bottom sheet no celular e em diálogo no desktop (spec §4). */
export function FolhaFormulario(props: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao?: string
  children: React.ReactNode
}) {
  const desktop = useDesktop()
  if (desktop) {
    return (
      <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{props.titulo}</DialogTitle>
            {props.descricao && <DialogDescription>{props.descricao}</DialogDescription>}
          </DialogHeader>
          {props.children}
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Sheet open={props.aberto} onOpenChange={props.onAbertoChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-[22px] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader className="px-0">
          <SheetTitle>{props.titulo}</SheetTitle>
          {props.descricao && <SheetDescription>{props.descricao}</SheetDescription>}
        </SheetHeader>
        {props.children}
      </SheetContent>
    </Sheet>
  )
}
```

`apps/web/components/painel/confirmar.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Confirmar(props: {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao: string
  rotuloConfirmar: string
  onConfirmar: () => Promise<void> | void
}) {
  const [executando, setExecutando] = useState(false)
  const confirmar = async () => {
    setExecutando(true)
    try {
      await props.onConfirmar()
    } finally {
      setExecutando(false)
    }
  }
  return (
    <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.titulo}</DialogTitle>
          <DialogDescription>{props.descricao}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => props.onAbertoChange(false)}>Cancelar</Button>
          <Button variant="destructive" aria-busy={executando || undefined} disabled={executando} onClick={confirmar}>
            {executando ? 'Apagando…' : props.rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

`apps/web/components/painel/abas.tsx`:
```tsx
import Link from 'next/link'
import { cn } from '@/lib/utils'

export function Abas({ rotulo, itens }: { rotulo: string; itens: { href: string; rotulo: string; ativo: boolean }[] }) {
  return (
    <nav aria-label={rotulo} className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-1">
        {itens.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.ativo ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors duration-150',
                i.ativo ? 'bg-secondary text-foreground' : 'text-muted-foreground [@media(hover:hover)]:hover:text-foreground',
              )}
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 5: Formulário de dados da unidade e "Nova unidade"**

`apps/web/components/painel/dados-unidade-form.tsx`:
```tsx
'use client'
import { CheckCircle2 } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { ehLinkGoogleMaps } from '@atd/core/s1'
import {
  applyServerErrors, ErrorSummary, Field, FormError, PhoneInput, SubmitButton, SwitchField, TagInput, TextInput, useErrorSummary,
  useZodForm,
} from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { dadosUnidadeSchema, type DadosUnidadeForm as Valores } from '@/lib/schemas/unidades'

export const UNIDADE_VAZIA: Valores = {
  nome: '', endereco: '', bairro: '', cidade: '', uf: '', cep: '', telefone: '', apelidos: [], mapsUrl: '', ativo: true,
}

const ROTULOS = {
  nome: 'Nome da unidade', endereco: 'Endereço', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF', cep: 'CEP',
  telefone: 'Telefone', apelidos: 'Apelidos', mapsUrl: 'Link do Google Maps',
}

export function DadosUnidadeForm(props: {
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<{ id: string }>>
  onSalvo?: (id: string) => void
  somenteLeitura?: boolean
}) {
  const form = useZodForm(dadosUnidadeSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const resumo = useErrorSummary(form, ROTULOS)
  const maps = form.watch('mapsUrl') ?? ''
  const mapsOk = maps !== '' && ehLinkGoogleMaps(maps) && !errors.mapsUrl
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await props.acao(valores)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Unidade salva')
    if (r.data) props.onSalvo?.(r.data.id)
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <ErrorSummary errors={resumo} />
      <FormError form={form} />
      <fieldset disabled={props.somenteLeitura} className="flex flex-col gap-4">
        <Field id="nome" label={ROTULOS.nome} error={errors.nome?.message} required>
          {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('nome')} />}
        </Field>
        <Field id="endereco" label={ROTULOS.endereco} hint="Como o cliente encontra: quadra, bloco, rua e número" error={errors.endereco?.message}>
          {(a) => <TextInput {...a} placeholder="Ex.: SCLS 404 Bloco C" autoComplete="street-address" {...form.register('endereco')} />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="bairro" label={ROTULOS.bairro} error={errors.bairro?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('bairro')} />}
          </Field>
          <Field id="cidade" label={ROTULOS.cidade} error={errors.cidade?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: Brasília" autoComplete="address-level2" {...form.register('cidade')} />}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field id="uf" label={ROTULOS.uf} error={errors.uf?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: DF" maxLength={2} autoCapitalize="characters" autoComplete="address-level1" {...form.register('uf')} />}
          </Field>
          <Field id="cep" label={ROTULOS.cep} error={errors.cep?.message}>
            {(a) => <TextInput {...a} placeholder="Ex.: 70390-040" inputMode="numeric" autoComplete="postal-code" {...form.register('cep')} />}
          </Field>
        </div>
        <Field id="telefone" label={ROTULOS.telefone} error={errors.telefone?.message}>
          {(a) => <PhoneInput {...a} {...form.register('telefone')} />}
        </Field>
        <Controller
          name="apelidos"
          control={form.control}
          render={({ field }) => (
            <Field id="apelidos" label={ROTULOS.apelidos} hint="Outros nomes que os clientes usam. Digite e tecle Enter." error={errors.apelidos?.message}>
              {(a) => (
                <TagInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={10} listLabel="Apelidos" placeholder="Ex.: 204 Sul" />
              )}
            </Field>
          )}
        />
        <div className="flex flex-col gap-1.5">
          <Field id="mapsUrl" label={ROTULOS.mapsUrl} hint="No app do Google Maps: Compartilhar → Copiar link" error={errors.mapsUrl?.message}>
            {(a) => <TextInput {...a} type="url" inputMode="url" placeholder="Ex.: https://maps.app.goo.gl/…" {...form.register('mapsUrl')} />}
          </Field>
          {mapsOk && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 aria-hidden="true" className="size-4" /> Link do Google Maps reconhecido
            </p>
          )}
        </div>
        <Controller
          name="ativo"
          control={form.control}
          render={({ field }) => (
            <SwitchField id="ativo" label="Unidade ativa" hint="Desativada, a IA deixa de responder sobre ela." checked={field.value} onCheckedChange={field.onChange} disabled={props.somenteLeitura} />
          )}
        />
      </fieldset>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar unidade</SubmitButton>}
    </form>
  )
}
```

`apps/web/components/painel/nova-unidade.tsx`:
```tsx
'use client'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { salvarDadosUnidadeAction } from '@/app/(painel)/unidades/actions'
import { Button } from '@/components/ui/button'
import { DadosUnidadeForm, UNIDADE_VAZIA } from './dados-unidade-form'
import { FolhaFormulario } from './folha-formulario'

export function NovaUnidade() {
  const [aberto, setAberto] = useState(false)
  const router = useRouter()
  return (
    <>
      <Button onClick={() => setAberto(true)}>
        <Plus aria-hidden="true" className="size-4" /> Nova unidade
      </Button>
      <FolhaFormulario aberto={aberto} onAbertoChange={setAberto} titulo="Nova unidade" descricao="Depois de salvar, cadastre os horários.">
        <DadosUnidadeForm
          inicial={UNIDADE_VAZIA}
          acao={(v) => salvarDadosUnidadeAction(null, v)}
          onSalvo={(id) => {
            setAberto(false)
            router.push(`/unidades/${id}?aba=horarios`)
          }}
        />
      </FolhaFormulario>
    </>
  )
}
```

- [ ] **Step 6: Tela de Unidades**

`apps/web/app/(painel)/unidades/page.tsx`:
```tsx
import { ChevronRight, Store } from 'lucide-react'
import Link from 'next/link'
import { carregarUnidadesPainel } from '@atd/db'
import { NovaUnidade } from '@/components/painel/nova-unidade'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

export default async function UnidadesPage() {
  const s = await requireStaff()
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  const podeEditar = s.role !== 'atendente'
  const agora = new Date()
  return (
    <>
      <TopBar title="Unidades" subtitle="Endereços, horários e exceções" action={podeEditar && unidades.length > 0 ? <NovaUnidade /> : undefined} />
      <main className="mx-auto max-w-xl px-4 py-6">
        {unidades.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Cadastre a primeira unidade"
            description="Endereço, horários e feriados de cada unidade são o que a IA usa para responder os clientes."
            action={podeEditar ? <NovaUnidade /> : undefined}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {unidades.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/unidades/${u.id}`}
                  className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors duration-150 [@media(hover:hover)]:hover:border-ring"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-foreground">{u.nome}</p>
                    <p className="truncate text-sm text-muted-foreground">{u.endereco ?? u.bairro ?? 'Endereço não cadastrado'}</p>
                    <div className="mt-1">
                      <SeloUnidade selo={seloDaUnidade(u, restaurante.politicaFeriado, restaurante.timezone, agora)} />
                    </div>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
```

`apps/web/app/(painel)/unidades/loading.tsx`:
```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Carregando() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-6">
      <span className="sr-only">Carregando unidades…</span>
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
    </main>
  )
}
```

- [ ] **Step 7: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS; o build garante que nenhum componente de cliente puxou `node:crypto`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/painel apps/web/lib/selo-unidade.ts apps/web/lib/selo-unidade.test.ts apps/web/app/\(painel\)/unidades
git commit -m "Lista as unidades com selo de aberta agora e cria unidade pelo painel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Detalhe da unidade — abas Dados e Horários

**Files:**
- Create: `apps/web/app/(painel)/unidades/[id]/page.tsx`, `apps/web/app/(painel)/unidades/[id]/loading.tsx`, `apps/web/components/painel/horarios-form.tsx`, `apps/web/components/painel/horarios-form.test.tsx`, `apps/web/lib/unidade-form.ts`, `apps/web/lib/unidade-form.test.ts`

**Interfaces:**
- Consumes: `carregarUnidadesPainel`, `UnidadePainel` (Task 3); `salvarDadosUnidadeAction`, `salvarHorariosAction`, `horariosSchema`, `HorariosForm` (Task 5); `DadosUnidadeForm`, `Abas`, `SeloUnidade`, `seloDaUnidade` (Task 6); `DIAS_SEMANA`, `cruzaMeiaNoite` (`@atd/core/s1`).
- Produces:
  - rota `/unidades/[id]?aba=dados|horarios|excecoes` (a aba `excecoes` é preenchida na Task 8); unidade invisível ao usuário (RLS) ⇒ `notFound()`
  - `valoresDadosUnidade(u: UnidadePainel): DadosUnidadeForm` (telefone e CEP formatados para exibição)
  - `HorariosForm({ unitId, inicial: HorariosForm, somenteLeitura?, acao })` — dias de segunda a domingo, turnos com "Abre"/"Fecha", "Adicionar turno", remover, "Copiar segunda para dias úteis", "Copiar segunda para todos os dias", aviso "Termina no dia seguinte (madrugada)."

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/unidade-form.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { valoresDadosUnidade } from './unidade-form'

describe('valoresDadosUnidade', () => {
  it('nulos viram vazio; telefone e CEP formatados', () => {
    const u = {
      id: 'x', nome: 'Asa Sul', slug: 'asa-sul', ativo: true, ordem: 1, apelidos: ['204 sul'],
      endereco: 'SCLS 404', bairro: null, cidade: 'Brasília', uf: 'DF', cep: '70390040', telefone: '6133334444',
      lat: -15.8, lng: -47.9, mapsUrl: null, semanal: [[], [], [], [], [], [], []], excecoes: {},
    }
    expect(valoresDadosUnidade(u)).toEqual({
      nome: 'Asa Sul', endereco: 'SCLS 404', bairro: '', cidade: 'Brasília', uf: 'DF', cep: '70390-040',
      telefone: '(61) 3333-4444', apelidos: ['204 sul'], mapsUrl: '', ativo: true,
    })
  })
})
```

`apps/web/components/painel/horarios-form.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HorariosForm } from './horarios-form'

const vazia = () => ({ semanal: [[], [], [], [], [], [], []] as { abre: string; fecha: string }[][] })

describe('HorariosForm', () => {
  it('erro de turno aparece no dia certo e não envia', async () => {
    const user = userEvent.setup()
    const acao = vi.fn()
    render(<HorariosForm unitId="u" inicial={vazia()} acao={acao} />)
    const segunda = screen.getByRole('group', { name: 'Segunda-feira' })
    await user.click(within(segunda).getByRole('button', { name: 'Adicionar turno' }))
    await user.type(within(segunda).getByLabelText(/^Abre/), '1100')
    await user.type(within(segunda).getByLabelText(/^Fecha/), '1100')
    await user.click(screen.getByRole('button', { name: 'Salvar horários' }))
    expect(await within(segunda).findByText('Turno 1: a abertura e o fechamento não podem ser iguais.')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })

  it('copia a segunda para os dias úteis, avisa a madrugada e envia a semana', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<HorariosForm unitId="u" inicial={vazia()} acao={acao} />)
    const segunda = screen.getByRole('group', { name: 'Segunda-feira' })
    await user.click(within(segunda).getByRole('button', { name: 'Adicionar turno' }))
    await user.type(within(segunda).getByLabelText(/^Abre/), '1800')
    await user.type(within(segunda).getByLabelText(/^Fecha/), '0200')
    expect(within(segunda).getByText('Termina no dia seguinte (madrugada).')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copiar segunda para dias úteis' }))
    expect(within(screen.getByRole('group', { name: 'Sexta-feira' })).getByLabelText(/^Abre/)).toHaveValue('18:00')
    expect(within(screen.getByRole('group', { name: 'Sábado' })).queryByLabelText(/^Abre/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Salvar horários' }))
    expect(acao).toHaveBeenCalledOnce()
    const enviada = acao.mock.calls[0]![0].semanal
    expect(enviada[1]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(enviada[5]).toEqual([{ abre: '18:00', fecha: '02:00' }])
    expect(enviada[6]).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/unidade-form.test.ts && pnpm vitest run --project ui apps/web/components/painel/horarios-form.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Valores do formulário**

`apps/web/lib/unidade-form.ts`:
```ts
import type { UnidadePainel } from '@atd/db'
import { maskTelefone } from '@/components/form/masks'
import type { DadosUnidadeForm } from '@/lib/schemas/unidades'

const cepFormatado = (cep: string | null) => (cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : (cep ?? ''))

export function valoresDadosUnidade(u: UnidadePainel): DadosUnidadeForm {
  return {
    nome: u.nome,
    endereco: u.endereco ?? '',
    bairro: u.bairro ?? '',
    cidade: u.cidade ?? '',
    uf: u.uf ?? '',
    cep: cepFormatado(u.cep),
    telefone: u.telefone ? maskTelefone(u.telefone) : '',
    apelidos: u.apelidos,
    mapsUrl: u.mapsUrl ?? '',
    ativo: u.ativo,
  }
}
```

- [ ] **Step 4: Formulário de horários**

`apps/web/components/painel/horarios-form.tsx`:
```tsx
'use client'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DIAS_SEMANA } from '@atd/core/s1'
import { applyServerErrors, Field, FormError, SubmitButton, TimeInput, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/action-result'
import { horariosSchema, type HorariosForm as Valores } from '@/lib/schemas/unidades'

const SEGUNDA_A_DOMINGO = [1, 2, 3, 4, 5, 6, 0] as const
const DIAS_UTEIS = [2, 3, 4, 5] as const
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export function HorariosForm(props: {
  unitId: string
  inicial: Valores
  acao: (valores: Valores) => Promise<ActionResult<null>>
  somenteLeitura?: boolean
}) {
  const form = useZodForm(horariosSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const semanal = form.watch('semanal')
  const definir = (dia: number, turnos: { abre: string; fecha: string }[]) =>
    form.setValue(`semanal.${dia}`, turnos, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  const copiarSegunda = (dias: readonly number[]) => {
    const base = form.getValues('semanal.1').map((t) => ({ ...t }))
    for (const d of dias) definir(d, base.map((t) => ({ ...t })))
  }
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await props.acao(valores)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Horários salvos')
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      {!props.somenteLeitura && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => copiarSegunda(DIAS_UTEIS)}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para dias úteis
          </Button>
          <Button type="button" variant="outline" onClick={() => copiarSegunda([2, 3, 4, 5, 6, 0])}>
            <Copy aria-hidden="true" className="size-4" /> Copiar segunda para todos os dias
          </Button>
        </div>
      )}
      {SEGUNDA_A_DOMINGO.map((dia) => {
        const turnos = semanal?.[dia] ?? []
        const erroDia = errors.semanal?.[dia] as { message?: string; root?: { message?: string } } | undefined
        const mensagemDia = erroDia?.message ?? erroDia?.root?.message
        return (
          <fieldset
            key={dia}
            aria-label={DIAS_SEMANA[dia]}
            disabled={props.somenteLeitura}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
          >
            <legend className="px-1 font-semibold text-foreground">{DIAS_SEMANA[dia]}</legend>
            {turnos.length === 0 && <p className="text-sm text-muted-foreground">Fechada</p>}
            {turnos.map((t, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-end gap-2">
                  <Field id={`semanal-${dia}-${i}-abre`} label="Abre" className="flex-1" error={errors.semanal?.[dia]?.[i]?.abre?.message}>
                    {(a) => <TimeInput {...a} {...form.register(`semanal.${dia}.${i}.abre`)} />}
                  </Field>
                  <Field id={`semanal-${dia}-${i}-fecha`} label="Fecha" className="flex-1" error={errors.semanal?.[dia]?.[i]?.fecha?.message}>
                    {(a) => <TimeInput {...a} {...form.register(`semanal.${dia}.${i}.fecha`)} />}
                  </Field>
                  {!props.somenteLeitura && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover turno ${i + 1} de ${DIAS_SEMANA[dia]}`}
                      onClick={() => definir(dia, turnos.filter((_, j) => j !== i))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
                {HORA.test(t.abre) && HORA.test(t.fecha) && t.fecha < t.abre && (
                  <p className="text-sm text-muted-foreground">Termina no dia seguinte (madrugada).</p>
                )}
              </div>
            ))}
            {!props.somenteLeitura && turnos.length < 6 && (
              <Button type="button" variant="outline" className="self-start" onClick={() => definir(dia, [...turnos, { abre: '', fecha: '' }])}>
                <Plus aria-hidden="true" className="size-4" /> Adicionar turno
              </Button>
            )}
            {mensagemDia && <p aria-live="polite" className="text-sm font-medium text-destructive">{mensagemDia}</p>}
          </fieldset>
        )
      })}
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar horários</SubmitButton>}
    </form>
  )
}
```
(`fieldset` com `aria-label` tem papel `group` — é o que os testes usam.)

- [ ] **Step 5: Página da unidade**

`apps/web/app/(painel)/unidades/[id]/page.tsx`:
```tsx
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { carregarUnidadesPainel } from '@atd/db'
import { salvarDadosUnidadeAction, salvarHorariosAction } from '@/app/(painel)/unidades/actions'
import { Abas } from '@/components/painel/abas'
import { DadosUnidadeForm } from '@/components/painel/dados-unidade-form'
import { HorariosForm } from '@/components/painel/horarios-form'
import { SeloUnidade } from '@/components/painel/selo-unidade'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { seloDaUnidade } from '@/lib/selo-unidade'
import { getDb } from '@/lib/server/db'
import { valoresDadosUnidade } from '@/lib/unidade-form'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'dados', rotulo: 'Dados' },
  { chave: 'horarios', rotulo: 'Horários' },
  { chave: 'excecoes', rotulo: 'Exceções' },
] as const
type Aba = (typeof ABAS)[number]['chave']

export default async function UnidadePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const s = await requireStaff()
  const { id } = await props.params
  const pedida = (await props.searchParams).aba
  const aba: Aba = ABAS.some((a) => a.chave === pedida) ? (pedida as Aba) : 'dados'
  const { restaurante, unidades } = await carregarUnidadesPainel(getDb(), s.claims)
  const u = unidades.find((x) => x.id === id)
  if (!u) notFound() // inexistente ou fora das unidades permitidas (RLS)
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar
        title={u.nome}
        subtitle="Dados, horários e exceções"
        action={
          <Link href="/unidades" aria-label="Voltar para unidades" className="flex size-11 items-center justify-center rounded-full text-foreground">
            <ArrowLeft aria-hidden="true" className="size-5" />
          </Link>
        }
      />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <SeloUnidade selo={seloDaUnidade(u, restaurante.politicaFeriado, restaurante.timezone, new Date())} />
        <Abas rotulo="Seções da unidade" itens={ABAS.map((a) => ({ href: `/unidades/${u.id}?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'dados' && (
          <DadosUnidadeForm inicial={valoresDadosUnidade(u)} acao={salvarDadosUnidadeAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        )}
        {aba === 'horarios' && (
          <HorariosForm unitId={u.id} inicial={{ semanal: u.semanal }} acao={salvarHorariosAction.bind(null, u.id)} somenteLeitura={somenteLeitura} />
        )}
        {aba === 'excecoes' && <p className="text-sm text-muted-foreground">Exceções: Task 8.</p>}
      </main>
    </>
  )
}
```
(O parágrafo da aba Exceções é substituído na Task 8, que vem logo em seguida.)

`apps/web/app/(painel)/unidades/[id]/loading.tsx`:
```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Carregando() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <span className="sr-only">Carregando unidade…</span>
      <Skeleton className="h-11 w-full rounded-full" />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
    </main>
  )
}
```

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components/painel && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(painel\)/unidades apps/web/components/painel apps/web/lib/unidade-form.ts apps/web/lib/unidade-form.test.ts
git commit -m "Adiciona o detalhe da unidade com abas de dados e horários

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Detalhe da unidade — aba Exceções (feriados do ano e datas especiais)

**Files:**
- Create: `apps/web/lib/feriados-unidade.ts`, `apps/web/lib/feriados-unidade.test.ts`, `apps/web/components/painel/excecoes-unidade.tsx`, `apps/web/components/painel/excecao-form.tsx`, `apps/web/components/painel/excecoes.test.tsx`
- Modify: `apps/web/app/(painel)/unidades/[id]/page.tsx`

**Interfaces:**
- Consumes: `salvarExcecaoAction`, `removerExcecaoAction`, `excecaoSchema`, `ExcecaoForm` (Task 5); `FolhaFormulario`, `Confirmar` (Task 6); `horarioDoDia`, `feriadosNacionais`, `mapaFeriados`, `agoraLocal`, `formatarTurnos`, `DIAS_SEMANA`, `diaDaSemana`, `partesDaData`, `somarDias` (`@atd/core/s1`).
- Produces:
  - `type DiaEspecial = { data: DataIso; dataBr: string; rotulo: string; feriado: string | null; comportamento: string; temExcecao: boolean; motivo: string | null }`
  - `feriadosComComportamento(u, politica, timezone, agora, dias = 365): DiaEspecial[]` — feriados nacionais de hoje até `dias` à frente, com o que a IA vai responder (exceção cadastrada vence)
  - `excecoesCadastradas(u, timezone, agora): DiaEspecial[]` — exceções de hoje em diante
  - `ExcecoesUnidade({ unitId, feriados, excecoes, somenteLeitura })` — lista de feriados com "Definir exceção", lista de exceções com "Editar" e "Apagar" (com confirmação), botão "Nova exceção"
  - `ExcecaoForm({ inicial, acao, onSalvo })` — data `dd/mm/aaaa`, "Fechado o dia todo", turnos, motivo

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/feriados-unidade.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { excecoesCadastradas, feriadosComComportamento } from './feriados-unidade'

const SEG = new Date('2026-10-05T14:00:00-03:00')
const semanal = [[{ abre: '11:30', fecha: '16:00' }], [], [], [], [], [{ abre: '11:00', fecha: '23:00' }], []]
const u = { semanal, excecoes: { '2026-12-25': { fechado: true, turnos: [], motivo: 'Natal em família' } } }

describe('feriados e exceções da unidade', () => {
  it('lista os próximos feriados com o comportamento que a IA vai responder', () => {
    const lista = feriadosComComportamento(u, 'como_domingo', 'America/Sao_Paulo', SEG, 90)
    expect(lista.map((d) => [d.dataBr, d.feriado, d.comportamento, d.temExcecao])).toEqual([
      ['12/10/2026', 'Nossa Senhora Aparecida', 'Abre das 11h30 às 16h', false],
      ['02/11/2026', 'Finados', 'Abre das 11h30 às 16h', false],
      ['15/11/2026', 'Proclamação da República', 'Abre das 11h30 às 16h', false],
      ['20/11/2026', 'Dia Nacional de Zumbi e da Consciência Negra', 'Abre das 11h30 às 16h', false],
      ['25/12/2026', 'Natal', 'Fechada', true],
      ['01/01/2027', 'Confraternização Universal', 'Abre das 11h30 às 16h', false],
    ])
    expect(lista[0]!.rotulo).toBe('Segunda-feira, 12/10/2026')
    expect(feriadosComComportamento(u, 'fechado', 'America/Sao_Paulo', SEG, 10)[0]!.comportamento).toBe('Fechada')
  })

  it('exceções cadastradas de hoje em diante', () => {
    expect(excecoesCadastradas(u, 'America/Sao_Paulo', SEG)).toEqual([
      { data: '2026-12-25', dataBr: '25/12/2026', rotulo: 'Sexta-feira, 25/12/2026', feriado: 'Natal', comportamento: 'Fechada', temExcecao: true, motivo: 'Natal em família' },
    ])
  })
})
```

`apps/web/components/painel/excecoes.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExcecaoForm } from './excecao-form'

describe('ExcecaoForm', () => {
  it('data inválida avisa; aberta sem turno pede turno; fechado esconde os turnos', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<ExcecaoForm inicial={{ data: '', fechado: false, turnos: [], motivo: '' }} acao={acao} />)
    await user.type(screen.getByLabelText(/^Data/), '31022026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Data inexistente. Use dd/mm/aaaa, como 12/10/2026')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    // a regra do formulário inteiro (turno obrigatório) só roda com os campos válidos
    await user.clear(screen.getByLabelText(/^Data/))
    await user.type(screen.getByLabelText(/^Data/), '24122026')
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(await screen.findByText('Adicione pelo menos um turno ou marque "Fechado o dia todo".')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()

    await user.click(screen.getByRole('switch', { name: 'Fechado o dia todo' }))
    expect(screen.queryByRole('button', { name: 'Adicionar turno' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Salvar exceção' }))
    expect(acao).toHaveBeenCalledWith({ data: '24/12/2026', fechado: true, turnos: [], motivo: '' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/feriados-unidade.test.ts && pnpm vitest run --project ui apps/web/components/painel/excecoes.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Feriados e exceções (puro)**

`apps/web/lib/feriados-unidade.ts`:
```ts
import {
  agoraLocal, DIAS_SEMANA, diaDaSemana, feriadosNacionais, formatarTurnos, horarioDoDia, mapaFeriados, partesDaData, somarDias,
  type AgendaUnidade, type DataIso, type PoliticaFeriado,
} from '@atd/core/s1'

export type DiaEspecial = {
  data: DataIso
  dataBr: string
  rotulo: string
  feriado: string | null
  comportamento: string
  temExcecao: boolean
  motivo: string | null
}

const paraBr = (d: DataIso) => {
  const { ano, mes, dia } = partesDaData(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`
}

function diaEspecial(u: AgendaUnidade, data: DataIso, politica: PoliticaFeriado, feriados: ReadonlyMap<DataIso, string>): DiaEspecial {
  const h = horarioDoDia(u, data, politica, feriados)
  const dataBr = paraBr(data)
  return {
    data,
    dataBr,
    rotulo: `${DIAS_SEMANA[diaDaSemana(data)]}, ${dataBr}`,
    feriado: h.feriado,
    comportamento: h.turnos.length ? `Abre ${formatarTurnos(h.turnos)}` : 'Fechada',
    temExcecao: h.origem === 'excecao',
    motivo: u.excecoes[data]?.motivo ?? null,
  }
}

function mapaDoPeriodo(hoje: DataIso) {
  const ano = Number(hoje.slice(0, 4))
  const lista = [...feriadosNacionais(ano), ...feriadosNacionais(ano + 1)]
  return { lista, mapa: mapaFeriados(lista) }
}

export function feriadosComComportamento(u: AgendaUnidade, politica: PoliticaFeriado, timezone: string, agora: Date, dias = 365): DiaEspecial[] {
  const hoje = agoraLocal(agora, timezone).data
  const limite = somarDias(hoje, dias)
  const { lista, mapa } = mapaDoPeriodo(hoje)
  const vistos = new Set<DataIso>()
  return lista
    .filter((f) => f.data >= hoje && f.data <= limite && !vistos.has(f.data) && (vistos.add(f.data), true))
    .map((f) => diaEspecial(u, f.data, politica, mapa))
}

export function excecoesCadastradas(u: AgendaUnidade, timezone: string, agora: Date, politica: PoliticaFeriado = 'como_domingo'): DiaEspecial[] {
  const hoje = agoraLocal(agora, timezone).data
  const { mapa } = mapaDoPeriodo(hoje)
  return Object.keys(u.excecoes)
    .filter((d) => d >= hoje)
    .sort()
    .map((d) => diaEspecial(u, d, politica, mapa))
}
```

- [ ] **Step 4: Formulário e lista**

`apps/web/components/painel/excecao-form.tsx`:
```tsx
'use client'
import { Plus, Trash2 } from 'lucide-react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { applyServerErrors, DateInput, Field, FormError, SubmitButton, SwitchField, TextInput, TimeInput, useZodForm } from '@/components/form'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/action-result'
import { excecaoSchema, type ExcecaoForm as Valores } from '@/lib/schemas/unidades'

export function ExcecaoForm(props: { inicial: Valores; acao: (valores: Valores) => Promise<ActionResult<null>>; onSalvo?: () => void }) {
  const form = useZodForm(excecaoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const fechado = form.watch('fechado')
  const turnos = form.watch('turnos') ?? []
  const definir = (t: { abre: string; fecha: string }[]) => form.setValue('turnos', t, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
  // envia os valores digitados (data em dd/mm/aaaa): a action valida e converte de novo
  const onSubmit = form.handleSubmit(async () => {
    const r = await props.acao(form.getValues())
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Exceção salva')
    props.onSalvo?.()
  })
  const erroTurnos = errors.turnos as { message?: string; root?: { message?: string } } | undefined

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="data" label="Data" hint="dd/mm/aaaa" error={errors.data?.message} required>
        {(a) => <DateInput {...a} {...form.register('data')} />}
      </Field>
      <Controller
        name="fechado"
        control={form.control}
        render={({ field }) => <SwitchField id="fechado" label="Fechado o dia todo" checked={field.value} onCheckedChange={field.onChange} />}
      />
      {!fechado && (
        <fieldset className="flex flex-col gap-3" aria-label="Turnos do dia">
          {turnos.map((_, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field id={`turnos-${i}-abre`} label="Abre" className="flex-1" error={errors.turnos?.[i]?.abre?.message}>
                {(a) => <TimeInput {...a} {...form.register(`turnos.${i}.abre`)} />}
              </Field>
              <Field id={`turnos-${i}-fecha`} label="Fecha" className="flex-1" error={errors.turnos?.[i]?.fecha?.message}>
                {(a) => <TimeInput {...a} {...form.register(`turnos.${i}.fecha`)} />}
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remover turno ${i + 1}`} onClick={() => definir(turnos.filter((__, j) => j !== i))}>
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>
          ))}
          {turnos.length < 6 && (
            <Button type="button" variant="outline" className="self-start" onClick={() => definir([...turnos, { abre: '', fecha: '' }])}>
              <Plus aria-hidden="true" className="size-4" /> Adicionar turno
            </Button>
          )}
          {(erroTurnos?.message ?? erroTurnos?.root?.message) && (
            <p aria-live="polite" className="text-sm font-medium text-destructive">{erroTurnos?.message ?? erroTurnos?.root?.message}</p>
          )}
        </fieldset>
      )}
      <Field id="motivo" label="Motivo" hint="Opcional. Só para a equipe; a IA não repete o motivo." error={errors.motivo?.message}>
        {(a) => <TextInput {...a} placeholder="Ex.: Inventário" {...form.register('motivo')} />}
      </Field>
      <SubmitButton pending={isSubmitting}>Salvar exceção</SubmitButton>
    </form>
  )
}
```

`apps/web/components/painel/excecoes-unidade.tsx`:
```tsx
'use client'
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { removerExcecaoAction, salvarExcecaoAction } from '@/app/(painel)/unidades/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DiaEspecial } from '@/lib/feriados-unidade'
import type { ExcecaoForm as Valores } from '@/lib/schemas/unidades'
import { Confirmar } from './confirmar'
import { ExcecaoForm } from './excecao-form'
import { FolhaFormulario } from './folha-formulario'

const VAZIA: Valores = { data: '', fechado: false, turnos: [], motivo: '' }

export function ExcecoesUnidade(props: {
  unitId: string
  feriados: DiaEspecial[]
  excecoes: (DiaEspecial & { inicial: Valores })[]
  somenteLeitura: boolean
}) {
  const [editando, setEditando] = useState<Valores | null>(null)
  const [apagando, setApagando] = useState<DiaEspecial | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="titulo-excecoes" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="titulo-excecoes" className="font-display text-lg font-semibold">Datas especiais</h2>
          {!props.somenteLeitura && (
            <Button onClick={() => setEditando(VAZIA)}>
              <CalendarPlus aria-hidden="true" className="size-4" /> Nova exceção
            </Button>
          )}
        </div>
        {props.excecoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma exceção cadastrada. Use para feriados locais, reformas ou horário especial.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {props.excecoes.map((e) => (
              <li key={e.data} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.rotulo}</p>
                  <p className="text-sm text-muted-foreground">{e.comportamento}{e.motivo ? ` · ${e.motivo}` : ''}</p>
                </div>
                {!props.somenteLeitura && (
                  <>
                    <Button variant="ghost" size="icon" aria-label={`Editar exceção de ${e.dataBr}`} onClick={() => setEditando(e.inicial)}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Apagar exceção de ${e.dataBr}`} onClick={() => setApagando(e)}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-feriados" className="flex flex-col gap-3">
        <h2 id="titulo-feriados" className="font-display text-lg font-semibold">Feriados nacionais</h2>
        <p className="text-sm text-muted-foreground">É o que a IA responde em cada feriado. Para mudar um dia, defina uma exceção.</p>
        <ul className="flex flex-col gap-2">
          {props.feriados.map((f) => (
            <li key={f.data} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{f.feriado}</p>
                <p className="text-sm text-muted-foreground">{f.rotulo} · {f.comportamento}</p>
              </div>
              {f.temExcecao ? (
                <Badge variant="secondary">Exceção cadastrada</Badge>
              ) : (
                !props.somenteLeitura && (
                  <Button variant="outline" onClick={() => setEditando({ data: f.dataBr, fechado: false, turnos: [], motivo: f.feriado ?? '' })}>
                    Definir exceção
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      </section>

      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo="Exceção de horário"
        descricao="Vale só para a data escolhida e vence a regra semanal e a de feriados."
      >
        {editando && (
          <ExcecaoForm inicial={editando} acao={(v) => salvarExcecaoAction(props.unitId, v)} onSalvo={() => setEditando(null)} />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={apagando !== null}
        onAbertoChange={(a) => !a && setApagando(null)}
        titulo={`Apagar a exceção de ${apagando?.dataBr ?? ''}?`}
        descricao="A data volta a seguir a regra semanal e a política de feriados."
        rotuloConfirmar="Apagar"
        onConfirmar={async () => {
          if (!apagando) return
          const r = await removerExcecaoAction(props.unitId, apagando.data)
          if (r.ok) toast.success('Exceção apagada')
          else toast.error(r.formError ?? 'Não foi possível apagar agora.')
          setApagando(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 5: Ligar na página**

Em `apps/web/app/(painel)/unidades/[id]/page.tsx`:
- imports: `import { ExcecoesUnidade } from '@/components/painel/excecoes-unidade'` e `import { excecoesCadastradas, feriadosComComportamento } from '@/lib/feriados-unidade'`
- trocar `{aba === 'excecoes' && <p …>Exceções: Task 8.</p>}` por:
```tsx
        {aba === 'excecoes' && (
          <ExcecoesUnidade
            unitId={u.id}
            somenteLeitura={somenteLeitura}
            feriados={feriadosComComportamento(u, restaurante.politicaFeriado, restaurante.timezone, new Date())}
            excecoes={excecoesCadastradas(u, restaurante.timezone, new Date(), restaurante.politicaFeriado).map((e) => {
              const x = u.excecoes[e.data]!
              return { ...e, inicial: { data: e.dataBr, fechado: x.fechado, turnos: x.turnos, motivo: x.motivo ?? '' } }
            })}
          />
        )}
```

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components/painel && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(painel\)/unidades apps/web/components/painel apps/web/lib/feriados-unidade.ts apps/web/lib/feriados-unidade.test.ts
git commit -m "Adiciona a aba de exceções com os feriados do ano e o comportamento de cada um

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Tela Respostas — abas "Sem resposta" e "Informações"

**Files:**
- Create: `apps/web/lib/respostas.ts`, `apps/web/lib/respostas.test.ts`, `apps/web/components/painel/fato-form.tsx`, `apps/web/components/painel/sem-resposta.tsx`, `apps/web/components/painel/informacoes.tsx`, `apps/web/components/painel/respostas.test.tsx`, `apps/web/app/(painel)/respostas/loading.tsx`
- Modify: `apps/web/app/(painel)/respostas/page.tsx`

**Interfaces:**
- Consumes: `listarLacunas`, `listarFatos`, `carregarUnidadesPainel`, tipos `LacunaPainel`, `FatoPainel` (`@atd/db`, servidor); `responderLacunaAction`, `ignorarLacunaAction`, `salvarFatoAction`, `removerFatoAction`, `fatoSchema`, `FatoForm` (Task 5); `FolhaFormulario`, `Confirmar`, `Abas` (Task 6).
- Produces:
  - `temaDaChave(chave: string): string` (`'info:area kids'` ⇒ `'Area kids'`), `acaoDaLacuna(chave): 'fato' | 'horarios' | 'endereco' | 'unidades'`, `tituloDaLacuna(chave): string` (tema, "Horário não cadastrado", "Endereço não cadastrado" ou "Nenhuma unidade cadastrada"), `TEMAS_COMUNS`, `sugestoesDeTemas(fatos: { tema: string }[]): string[]`
  - `FatoForm({ inicial, unidades, acao, onSalvo?, rotuloSalvar })`
  - `SemResposta({ lacunas, unidades, somenteLeitura })` — lacunas de informação abrem o formulário pré-preenchido; de horário/endereço levam à unidade; "Ignorar" com confirmação
  - `Informacoes({ fatos, unidades, somenteLeitura })` — lista por tema, "Nova informação", sugestões de temas comuns ainda não cadastrados, editar e apagar com confirmação
  - rota `/respostas?aba=sem-resposta|informacoes|mensagens` (a aba `mensagens` é preenchida na Task 10)

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/respostas.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { acaoDaLacuna, sugestoesDeTemas, temaDaChave, tituloDaLacuna } from './respostas'

describe('respostas', () => {
  it('tema e ação a partir da chave da lacuna', () => {
    expect(temaDaChave('info:area kids')).toBe('Area kids')
    expect(temaDaChave('info:geral')).toBe('Geral')
    expect(acaoDaLacuna('info:wifi')).toBe('fato')
    expect(acaoDaLacuna('horario')).toBe('horarios')
    expect(acaoDaLacuna('endereco')).toBe('endereco')
    expect(acaoDaLacuna('unidades')).toBe('unidades')
    expect(tituloDaLacuna('info:wifi')).toBe('Wifi')
    expect(tituloDaLacuna('horario')).toBe('Horário não cadastrado')
    expect(tituloDaLacuna('unidades')).toBe('Nenhuma unidade cadastrada')
  })
  it('sugere temas comuns ainda não cadastrados (sem acento e sem caixa)', () => {
    const s = sugestoesDeTemas([{ tema: 'estacionamento' }, { tema: 'WI-FI' }, { tema: 'Área Kids' }])
    expect(s).not.toContain('Estacionamento')
    expect(s).not.toContain('Wi-Fi')
    expect(s).not.toContain('Área kids')
    expect(s).toContain('Pet friendly')
  })
})
```

`apps/web/components/painel/respostas.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(painel)/respostas/actions', () => ({
  responderLacunaAction: vi.fn(), ignorarLacunaAction: vi.fn(), salvarFatoAction: vi.fn(), removerFatoAction: vi.fn(),
}))
const { FatoForm } = await import('./fato-form')
const { SemResposta } = await import('./sem-resposta')

const unidades = [{ id: '00000000-0000-4000-8000-000000000001', nome: 'Asa Sul' }]
const lacuna = (chave: string, unitId: string | null = null) => ({
  id: crypto.randomUUID(), chave, unitId, unidade: unitId ? 'Asa Sul' : null, pergunta: 'tem área kids?', ocorrencias: 4, ultimaVez: '2026-10-05T17:00:00.000Z',
})

describe('FatoForm', () => {
  it('mensagens exatas e envio com unidade "todas" como vazio', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: { id: 'x' } })
    render(<FatoForm inicial={{ tema: '', exemplos: [], texto: '', unitId: '', ativo: true }} unidades={unidades} acao={acao} rotuloSalvar="Salvar informação" />)
    await user.click(screen.getByRole('button', { name: 'Salvar informação' }))
    expect(screen.getByLabelText(/^Assunto/)).toHaveFocus()
    expect(screen.getAllByText('Escreva a resposta que a IA deve enviar').length).toBeGreaterThan(0)
    await user.type(screen.getByLabelText(/^Assunto/), 'Estacionamento')
    await user.type(screen.getByLabelText(/^Resposta/), 'Temos estacionamento gratuito.')
    await user.click(screen.getByRole('button', { name: 'Salvar informação' }))
    expect(acao).toHaveBeenCalledWith({ tema: 'Estacionamento', exemplos: [], texto: 'Temos estacionamento gratuito.', unitId: '', ativo: true })
  })
})

describe('SemResposta', () => {
  it('lacuna de informação abre o formulário pré-preenchido; de horário leva à unidade', async () => {
    const user = userEvent.setup()
    render(<SemResposta lacunas={[lacuna('info:area kids'), lacuna('horario', unidades[0]!.id)]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getByText('4 vezes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar horários da Asa Sul' })).toHaveAttribute('href', `/unidades/${unidades[0]!.id}?aba=horarios`)
    await user.click(screen.getByRole('button', { name: 'Responder: Area kids' }))
    expect(await screen.findByLabelText(/^Assunto/)).toHaveValue('Area kids')
    expect(screen.getByText('tem área kids?', { selector: 'li span' })).toBeInTheDocument() // exemplo vindo da pergunta
  })

  it('sem lacunas: estado vazio que explica', () => {
    render(<SemResposta lacunas={[]} unidades={unidades} somenteLeitura={false} />)
    expect(screen.getByText('Nenhuma pergunta sem resposta')).toBeInTheDocument()
  })
})
```
(Se o `TagInput` renderizar as etiquetas com outra marcação, ajuste só o `selector` do teste para a etiqueta existente — a asserção é "a pergunta virou exemplo".)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/respostas.test.ts && pnpm vitest run --project ui apps/web/components/painel/respostas.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Funções puras**

`apps/web/lib/respostas.ts`:
```ts
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export const TEMAS_COMUNS = [
  'Estacionamento', 'Wi-Fi', 'Pet friendly', 'Acessibilidade', 'Formas de pagamento', 'Música ao vivo', 'Área kids',
  'Taxa de rolha', 'Cadeira para bebê', 'Comemoração de aniversário',
] as const

export function temaDaChave(chave: string): string {
  const t = chave.startsWith('info:') ? chave.slice(5) : chave
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function acaoDaLacuna(chave: string): 'fato' | 'horarios' | 'endereco' | 'unidades' {
  if (chave === 'horario') return 'horarios'
  if (chave === 'endereco') return 'endereco'
  if (chave === 'unidades') return 'unidades'
  return 'fato'
}

const TITULO_ACAO = { horarios: 'Horário não cadastrado', endereco: 'Endereço não cadastrado', unidades: 'Nenhuma unidade cadastrada' } as const

export function tituloDaLacuna(chave: string): string {
  const acao = acaoDaLacuna(chave)
  return acao === 'fato' ? temaDaChave(chave) : TITULO_ACAO[acao]
}

export function sugestoesDeTemas(fatos: readonly { tema: string }[]): string[] {
  const existentes = new Set(fatos.map((f) => normalizar(f.tema)))
  return TEMAS_COMUNS.filter((t) => !existentes.has(normalizar(t)))
}
```

- [ ] **Step 4: Formulário de informação**

`apps/web/components/painel/fato-form.tsx`:
```tsx
'use client'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import {
  applyServerErrors, Field, FormError, Select, SubmitButton, SwitchField, TagInput, Textarea, TextInput, useZodForm,
} from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { fatoSchema, type FatoForm as Valores } from '@/lib/schemas/respostas'

export function FatoForm(props: {
  inicial: Valores
  unidades: { id: string; nome: string }[]
  acao: (valores: Valores) => Promise<ActionResult<unknown>>
  onSalvo?: () => void
  rotuloSalvar: string
}) {
  const form = useZodForm(fatoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (valores) => {
    const r = await props.acao(valores)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Informação salva. A IA já passa a responder com ela.')
    props.onSalvo?.()
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="tema" label="Assunto" hint="Uma ou duas palavras, como o cliente pergunta" error={errors.tema?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Estacionamento" {...form.register('tema')} />}
      </Field>
      <Field id="texto" label="Resposta" hint="Exatamente o que a IA vai enviar ao cliente" error={errors.texto?.message} required>
        {(a) => <Textarea {...a} rows={4} placeholder="Ex.: Temos estacionamento gratuito para clientes." {...form.register('texto')} />}
      </Field>
      <Controller
        name="exemplos"
        control={form.control}
        render={({ field }) => (
          <Field id="exemplos" label="Jeitos de perguntar" hint="Opcional. Ajuda a IA a reconhecer o assunto. Tecle Enter a cada um." error={errors.exemplos?.message}>
            {(a) => <TagInput {...a} value={field.value} onChange={field.onChange} onBlur={field.onBlur} max={10} listLabel="Exemplos" placeholder="Ex.: tem vaga?" />}
          </Field>
        )}
      />
      <Field id="unitId" label="Vale para" error={errors.unitId?.message}>
        {(a) => (
          <Select {...a} {...form.register('unitId')}>
            <option value="">Todas as unidades</option>
            {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </Select>
        )}
      </Field>
      <Controller
        name="ativo"
        control={form.control}
        render={({ field }) => (
          <SwitchField id="ativo" label="Ativa" hint="Desativada, a IA deixa de usar esta resposta." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      <SubmitButton pending={isSubmitting}>{props.rotuloSalvar}</SubmitButton>
    </form>
  )
}
```

- [ ] **Step 5: Abas**

`apps/web/components/painel/sem-resposta.tsx`:
```tsx
'use client'
import { MessageCircleQuestion } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { ignorarLacunaAction, responderLacunaAction } from '@/app/(painel)/respostas/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Button } from '@/components/ui/button'
import { acaoDaLacuna, tituloDaLacuna } from '@/lib/respostas'
import type { FatoForm as ValoresFato } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FatoForm } from './fato-form'
import { FolhaFormulario } from './folha-formulario'

export type LacunaTela = {
  id: string
  chave: string
  unitId: string | null
  unidade: string | null
  pergunta: string | null
  ocorrencias: number
  ultimaVez: string
}

const LINK = {
  horarios: (l: LacunaTela) => ({ href: `/unidades/${l.unitId}?aba=horarios`, rotulo: `Cadastrar horários da ${l.unidade}` }),
  endereco: (l: LacunaTela) => ({ href: `/unidades/${l.unitId}?aba=dados`, rotulo: `Cadastrar endereço da ${l.unidade}` }),
  unidades: () => ({ href: '/unidades', rotulo: 'Cadastrar unidades' }),
}

export function SemResposta(props: { lacunas: LacunaTela[]; unidades: { id: string; nome: string }[]; somenteLeitura: boolean }) {
  const [respondendo, setRespondendo] = useState<{ lacuna: LacunaTela; inicial: ValoresFato } | null>(null)
  const [ignorando, setIgnorando] = useState<LacunaTela | null>(null)

  if (props.lacunas.length === 0) {
    return (
      <EmptyState
        icon={MessageCircleQuestion}
        title="Nenhuma pergunta sem resposta"
        description="Quando a IA não souber responder algo, a pergunta aparece aqui para você cadastrar a resposta uma vez só."
      />
    )
  }
  return (
    <>
      <ul className="flex flex-col gap-3">
        {props.lacunas.map((l) => {
          const acao = acaoDaLacuna(l.chave)
          const titulo = tituloDaLacuna(l.chave)
          return (
            <li key={l.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{titulo}</p>
                  <p className="text-sm text-muted-foreground">{l.unidade ?? 'Todas as unidades'}</p>
                  {l.pergunta && <p className="mt-1 text-sm text-foreground">“{l.pergunta}”</p>}
                </div>
                <span className="shrink-0 text-sm font-medium text-link">{l.ocorrencias === 1 ? '1 vez' : `${l.ocorrencias} vezes`}</span>
              </div>
              {!props.somenteLeitura && (
                <div className="flex flex-wrap gap-2">
                  {acao === 'fato' ? (
                    <Button
                      aria-label={`Responder: ${titulo}`}
                      onClick={() => setRespondendo({
                        lacuna: l,
                        inicial: { tema: titulo, exemplos: l.pergunta ? [l.pergunta] : [], texto: '', unitId: l.unitId ?? '', ativo: true },
                      })}
                    >
                      Responder
                    </Button>
                  ) : (
                    <Button asChild>
                      <Link href={LINK[acao](l).href}>{LINK[acao](l).rotulo}</Link>
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setIgnorando(l)}>{acao === 'fato' ? 'Ignorar' : 'Já resolvi'}</Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <FolhaFormulario
        aberto={respondendo !== null}
        onAbertoChange={(a) => !a && setRespondendo(null)}
        titulo="Responder pergunta"
        descricao="Cadastre a resposta uma vez; a IA passa a responder sozinha."
      >
        {respondendo && (
          <FatoForm
            inicial={respondendo.inicial}
            unidades={props.unidades}
            rotuloSalvar="Salvar resposta"
            acao={(v) => responderLacunaAction(respondendo.lacuna.id, v)}
            onSalvo={() => setRespondendo(null)}
          />
        )}
      </FolhaFormulario>

      <Confirmar
        aberto={ignorando !== null}
        onAbertoChange={(a) => !a && setIgnorando(null)}
        titulo="Tirar esta pergunta da lista?"
        descricao="Se a pergunta voltar a aparecer, ela entra de novo na lista."
        rotuloConfirmar="Tirar da lista"
        onConfirmar={async () => {
          if (!ignorando) return
          const r = await ignorarLacunaAction(ignorando.id)
          if (r.ok) toast.success('Pergunta tirada da lista')
          else toast.error(r.formError ?? 'Não foi possível agora.')
          setIgnorando(null)
        }}
      />
    </>
  )
}
```

`apps/web/components/painel/informacoes.tsx`:
```tsx
'use client'
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { removerFatoAction, salvarFatoAction } from '@/app/(painel)/respostas/actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { sugestoesDeTemas } from '@/lib/respostas'
import type { FatoForm as ValoresFato } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FatoForm } from './fato-form'
import { FolhaFormulario } from './folha-formulario'

export type FatoTela = { id: string; tema: string; exemplos: string[]; texto: string; unitId: string | null; unidade: string | null; ativo: boolean }

const vazio = (tema = ''): ValoresFato => ({ tema, exemplos: [], texto: '', unitId: '', ativo: true })

export function Informacoes(props: { fatos: FatoTela[]; unidades: { id: string; nome: string }[]; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<{ id: string | null; inicial: ValoresFato } | null>(null)
  const [apagando, setApagando] = useState<FatoTela | null>(null)
  const sugestoes = sugestoesDeTemas(props.fatos)

  return (
    <div className="flex flex-col gap-4">
      {!props.somenteLeitura && (
        <Button className="self-start" onClick={() => setEditando({ id: null, inicial: vazio() })}>
          <Plus aria-hidden="true" className="size-4" /> Nova informação
        </Button>
      )}
      {props.fatos.length === 0 ? (
        <EmptyState icon={BookOpen} title="Nenhuma informação cadastrada" description="Cadastre o que os clientes costumam perguntar: estacionamento, formas de pagamento, pet, acessibilidade…" />
      ) : (
        <ul className="flex flex-col gap-3">
          {props.fatos.map((f) => (
            <li key={f.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  {f.tema}
                  {!f.ativo && <Badge variant="secondary">Desativada</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{f.unidade ?? 'Todas as unidades'}</p>
                <p className="mt-1 text-sm text-foreground">{f.texto}</p>
              </div>
              {!props.somenteLeitura && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label={`Editar ${f.tema}`} onClick={() => setEditando({
                    id: f.id, inicial: { tema: f.tema, exemplos: f.exemplos, texto: f.texto, unitId: f.unitId ?? '', ativo: f.ativo },
                  })}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Apagar ${f.tema}`} onClick={() => setApagando(f)}>
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!props.somenteLeitura && sugestoes.length > 0 && (
        <section aria-labelledby="titulo-sugestoes" className="flex flex-col gap-2">
          <h2 id="titulo-sugestoes" className="text-sm font-semibold text-foreground">Assuntos comuns ainda sem resposta</h2>
          <div className="flex flex-wrap gap-2">
            {sugestoes.map((t) => (
              <Button key={t} variant="outline" onClick={() => setEditando({ id: null, inicial: vazio(t) })}>{t}</Button>
            ))}
          </div>
        </section>
      )}
      <FolhaFormulario aberto={editando !== null} onAbertoChange={(a) => !a && setEditando(null)} titulo={editando?.id ? 'Editar informação' : 'Nova informação'}>
        {editando && (
          <FatoForm
            inicial={editando.inicial}
            unidades={props.unidades}
            rotuloSalvar="Salvar informação"
            acao={(v) => salvarFatoAction(editando.id, v)}
            onSalvo={() => setEditando(null)}
          />
        )}
      </FolhaFormulario>
      <Confirmar
        aberto={apagando !== null}
        onAbertoChange={(a) => !a && setApagando(null)}
        titulo={`Apagar "${apagando?.tema ?? ''}"?`}
        descricao="A IA deixa de responder sobre esse assunto e a pergunta volta a aparecer como sem resposta."
        rotuloConfirmar="Apagar"
        onConfirmar={async () => {
          if (!apagando) return
          const r = await removerFatoAction(apagando.id)
          if (r.ok) toast.success('Informação apagada')
          else toast.error(r.formError ?? 'Não foi possível apagar agora.')
          setApagando(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Página**

`apps/web/app/(painel)/respostas/page.tsx` (substitui o estado vazio do 02-A):
```tsx
import { carregarUnidadesPainel, listarFatos, listarLacunas } from '@atd/db'
import { Abas } from '@/components/painel/abas'
import { Informacoes } from '@/components/painel/informacoes'
import { SemResposta } from '@/components/painel/sem-resposta'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ABAS = [
  { chave: 'sem-resposta', rotulo: 'Sem resposta' },
  { chave: 'informacoes', rotulo: 'Informações' },
  { chave: 'mensagens', rotulo: 'Mensagens' },
] as const
type Aba = (typeof ABAS)[number]['chave']

export default async function RespostasPage(props: { searchParams: Promise<{ aba?: string }> }) {
  const s = await requireStaff()
  const pedida = (await props.searchParams).aba
  const aba: Aba = ABAS.some((a) => a.chave === pedida) ? (pedida as Aba) : 'sem-resposta'
  const db = getDb()
  const { unidades } = await carregarUnidadesPainel(db, s.claims)
  const opcoes = unidades.map((u) => ({ id: u.id, nome: u.nome }))
  const somenteLeitura = s.role === 'atendente'
  return (
    <>
      <TopBar title="Respostas" subtitle="O que a IA sabe e o que falta" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Abas rotulo="Seções de respostas" itens={ABAS.map((a) => ({ href: `/respostas?aba=${a.chave}`, rotulo: a.rotulo, ativo: a.chave === aba }))} />
        {aba === 'sem-resposta' && (
          <SemResposta
            somenteLeitura={somenteLeitura}
            unidades={opcoes}
            lacunas={(await listarLacunas(db, s.claims)).map((l) => ({ ...l, ultimaVez: l.ultimaVez.toISOString() }))}
          />
        )}
        {aba === 'informacoes' && <Informacoes somenteLeitura={somenteLeitura} unidades={opcoes} fatos={await listarFatos(db, s.claims)} />}
        {aba === 'mensagens' && <p className="text-sm text-muted-foreground">Mensagens: Task 10.</p>}
      </main>
    </>
  )
}
```

`apps/web/app/(painel)/respostas/loading.tsx`:
```tsx
import { Skeleton } from '@/components/ui/skeleton'

export default function Carregando() {
  return (
    <main aria-busy="true" className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-6">
      <span className="sr-only">Carregando respostas…</span>
      <Skeleton className="h-11 w-full rounded-full" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)}
    </main>
  )
}
```

- [ ] **Step 7: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components/painel && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/\(painel\)/respostas apps/web/components/painel apps/web/lib/respostas.ts apps/web/lib/respostas.test.ts
git commit -m "Adiciona a tela Respostas com perguntas sem resposta e informações cadastradas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Tela Respostas — aba "Mensagens" (modelos com prévia usando dados reais)

**Files:**
- Create: `apps/web/lib/modelos-tela.ts`, `apps/web/lib/modelos-tela.test.ts`, `apps/web/components/painel/modelos.tsx`, `apps/web/components/painel/modelos.test.tsx`
- Modify: `apps/web/app/(painel)/respostas/page.tsx`

**Interfaces:**
- Consumes: `listarModelos` (Task 4); `salvarModeloAction`, `restaurarModeloAction`, `modeloSchema` (Task 5); `MODELOS_S1`, `renderModelo`, `formatarEndereco`, `type ChaveModelo` (`@atd/core/s1`); `FolhaFormulario`, `Confirmar` (Task 6).
- Produces:
  - `ROTULOS_MODELO: Record<ChaveModelo, { titulo: string; quando: string }>` (o TypeScript obriga a cobrir todas as chaves)
  - `exemploDeVariaveis(chave, unidade | null): Record<string, string>` e `previaModelo(chave, texto, unidade | null): string`
  - `Modelos({ personalizados, unidade, somenteLeitura })` — cada modelo com título, quando é usado, prévia com dados reais e selo "Personalizado"; editar com prévia ao vivo e lista de variáveis; "Restaurar padrão" com confirmação

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/modelos-tela.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MODELOS_S1 } from '@atd/core/s1'
import { previaModelo, ROTULOS_MODELO } from './modelos-tela'

const unidade = { nome: 'Lago Sul', endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', mapsUrl: null }

describe('modelos na tela', () => {
  it('todo modelo tem título e explicação', () => {
    expect(Object.keys(ROTULOS_MODELO).sort()).toEqual(Object.keys(MODELOS_S1).sort())
  })
  it('prévia usa os dados reais da unidade', () => {
    expect(previaModelo('endereco', MODELOS_S1.endereco.texto, unidade)).toBe('A unidade Lago Sul fica em SHIS QI 11 Bloco A, Lago Sul, Brasília/DF.')
    expect(previaModelo('aberto_sim', 'Aberta! {unidade} fecha {fecha}.', unidade)).toBe('Aberta! Lago Sul fecha às 23h.')
    expect(previaModelo('lacuna', MODELOS_S1.lacuna.texto, null)).toBe('Ainda não tenho essa informação; vou verificar com a equipe.')
  })
})
```

`apps/web/components/painel/modelos.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const salvarModeloAction = vi.fn()
vi.mock('@/app/(painel)/respostas/actions', () => ({ salvarModeloAction, restaurarModeloAction: vi.fn() }))
const { Modelos } = await import('./modelos')

const unidade = { nome: 'Lago Sul', endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', mapsUrl: null }

describe('Modelos', () => {
  it('mostra prévia real, marca personalizado e valida ao editar', async () => {
    const user = userEvent.setup()
    render(<Modelos personalizados={{ lacuna: 'Vou confirmar com a equipe.' }} unidade={unidade} somenteLeitura={false} />)
    const item = screen.getByRole('listitem', { name: 'Ainda não sabe responder' })
    expect(within(item).getByText('Personalizado')).toBeInTheDocument()
    expect(within(item).getByText('Vou confirmar com a equipe.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar: Horário de um dia' }))
    const campo = await screen.findByLabelText(/^Texto/)
    await user.clear(campo)
    await user.type(campo, '{{quando}, abrimos.')
    expect(screen.getByText('Domingo (11/10), abrimos.')).toBeInTheDocument() // prévia ao vivo
    await user.click(screen.getByRole('button', { name: 'Salvar modelo' }))
    expect(await screen.findByText('Inclua {turnos} no texto: é ali que entra a informação.')).toBeInTheDocument()
    expect(salvarModeloAction).not.toHaveBeenCalled()
  })
})
```
(`user.type` usa `{{` para digitar uma chave literal.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/modelos-tela.test.ts && pnpm vitest run --project ui apps/web/components/painel/modelos.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rótulos e prévia**

`apps/web/lib/modelos-tela.ts`:
```ts
import { formatarEndereco, renderModelo, type ChaveModelo } from '@atd/core/s1'

export type UnidadeExemplo = { nome: string; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; mapsUrl: string | null }

export const ROTULOS_MODELO: Record<ChaveModelo, { titulo: string; quando: string }> = {
  aberto_sim: { titulo: 'Aberta agora', quando: 'O cliente pergunta se está aberto e a unidade está aberta.' },
  aberto_nao: { titulo: 'Fechada agora', quando: 'Está fechada e já se sabe quando abre.' },
  aberto_sem_previsao: { titulo: 'Fechada sem previsão', quando: 'Está fechada e não há próxima abertura nos próximos 14 dias.' },
  aberto_varias: { titulo: 'Aberto agora (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  horario_dia: { titulo: 'Horário de um dia', quando: 'O cliente pergunta o horário de hoje, amanhã, domingo, dia 12…' },
  horario_dia_fechado: { titulo: 'Não abre no dia', quando: 'A unidade não abre no dia perguntado.' },
  horario_varias: { titulo: 'Horário de um dia (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  horario_semana: { titulo: 'Horários da semana', quando: 'O cliente pede os horários da semana inteira.' },
  endereco: { titulo: 'Endereço', quando: 'O cliente pergunta onde fica a unidade.' },
  como_chegar: { titulo: 'Como chegar', quando: 'O cliente pede rota ou link do mapa.' },
  endereco_varias: { titulo: 'Endereços (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  lista_unidades: { titulo: 'Lista de unidades', quando: 'O cliente pergunta quais unidades existem.' },
  escolher_unidade: { titulo: 'Pedir a unidade', quando: 'Texto da lista enviada quando há mais de 3 unidades.' },
  data_nao_entendida: { titulo: 'Data não entendida', quando: 'A IA não entendeu o dia da pergunta.' },
  lista_expirada: { titulo: 'Lista vencida', quando: 'O cliente toca numa lista antiga (mais de 30 minutos).' },
  lacuna: { titulo: 'Ainda não sabe responder', quando: 'Não há informação cadastrada; a pergunta vai para "Sem resposta".' },
  em_breve: { titulo: 'Serviço em breve', quando: 'Pergunta sobre cardápio, eventos ou aviso de presença (próximas etapas).' },
}

const LINHAS: Partial<Record<ChaveModelo, (nome: string, endereco: string) => string>> = {
  aberto_varias: (n) => `• ${n}: aberta, fecha às 23h\n• Outra unidade: fechada, abre amanhã às 11h30`,
  horario_varias: (n) => `• ${n}: das 11h às 23h\n• Outra unidade: fechada`,
  horario_semana: () => 'Segunda-feira: fechada\nTerça-feira: das 11h30 às 15h e das 18h às 23h\n…',
  endereco_varias: (n, e) => `• ${n}: ${e}\n• Outra unidade: …`,
  lista_unidades: (n) => `• ${n}\n• Outra unidade`,
}

export function exemploDeVariaveis(chave: ChaveModelo, u: UnidadeExemplo | null): Record<string, string> {
  const nome = u?.nome ?? 'Asa Sul'
  const endereco = (u && formatarEndereco(u)) ?? 'SCLS 404 Bloco C, Asa Sul, Brasília/DF'
  return {
    unidade: nome,
    fecha: 'às 23h',
    abre: 'às 11h30',
    quando: chave.startsWith('horario') ? 'Domingo (11/10)' : 'amanhã',
    turnos: 'das 11h30 às 15h e das 18h às 23h',
    linhas: LINHAS[chave]?.(nome, endereco) ?? '',
    endereco,
    mapa: u?.mapsUrl ?? 'https://maps.app.goo.gl/…',
    servico: 'o cardápio',
  }
}

export function previaModelo(chave: ChaveModelo, texto: string, u: UnidadeExemplo | null): string {
  return renderModelo(chave, exemploDeVariaveis(chave, u), { [chave]: texto })
}
```

- [ ] **Step 4: Componente**

`apps/web/components/painel/modelos.tsx`:
```tsx
'use client'
import { Pencil, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { MODELOS_S1, type ChaveModelo } from '@atd/core/s1'
import { restaurarModeloAction, salvarModeloAction } from '@/app/(painel)/respostas/actions'
import { applyServerErrors, Field, FormError, SubmitButton, Textarea, useZodForm } from '@/components/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { previaModelo, ROTULOS_MODELO, type UnidadeExemplo } from '@/lib/modelos-tela'
import { modeloSchema } from '@/lib/schemas/respostas'
import { Confirmar } from './confirmar'
import { FolhaFormulario } from './folha-formulario'

const CHAVES = Object.keys(MODELOS_S1) as ChaveModelo[]

function ModeloForm(props: { chave: ChaveModelo; texto: string; unidade: UnidadeExemplo | null; onSalvo: () => void }) {
  const form = useZodForm(modeloSchema(props.chave), { defaultValues: { texto: props.texto } })
  const { errors, isSubmitting } = form.formState
  const texto = form.watch('texto') ?? ''
  const variaveis: readonly string[] = MODELOS_S1[props.chave].variaveis
  const onSubmit = form.handleSubmit(async (v) => {
    const r = await salvarModeloAction(props.chave, v)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Modelo salvo')
    props.onSalvo()
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field
        id="texto"
        label="Texto"
        hint={variaveis.length ? `Variáveis: ${variaveis.map((v) => `{${v}}`).join(', ')}` : 'Este modelo não usa variáveis.'}
        error={errors.texto?.message}
        required
      >
        {(a) => <Textarea {...a} rows={4} {...form.register('texto')} />}
      </Field>
      <section aria-label="Prévia" className="rounded-lg bg-secondary p-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Prévia com os seus dados</p>
        <p className="whitespace-pre-line text-sm text-foreground">{previaModelo(props.chave, texto, props.unidade)}</p>
      </section>
      <SubmitButton pending={isSubmitting}>Salvar modelo</SubmitButton>
    </form>
  )
}

export function Modelos(props: { personalizados: Partial<Record<ChaveModelo, string>>; unidade: UnidadeExemplo | null; somenteLeitura: boolean }) {
  const [editando, setEditando] = useState<ChaveModelo | null>(null)
  const [restaurando, setRestaurando] = useState<ChaveModelo | null>(null)
  const textoDe = (c: ChaveModelo) => props.personalizados[c] ?? MODELOS_S1[c].texto
  return (
    <>
      <ul className="flex flex-col gap-3">
        {CHAVES.map((c) => (
          <li key={c} aria-label={ROTULOS_MODELO[c].titulo} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                  {ROTULOS_MODELO[c].titulo}
                  {props.personalizados[c] && <Badge variant="secondary">Personalizado</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{ROTULOS_MODELO[c].quando}</p>
              </div>
              {!props.somenteLeitura && (
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label={`Editar: ${ROTULOS_MODELO[c].titulo}`} onClick={() => setEditando(c)}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                  {props.personalizados[c] && (
                    <Button variant="ghost" size="icon" aria-label={`Restaurar padrão: ${ROTULOS_MODELO[c].titulo}`} onClick={() => setRestaurando(c)}>
                      <RotateCcw aria-hidden="true" className="size-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="whitespace-pre-line rounded-md bg-secondary p-3 text-sm text-foreground">{previaModelo(c, textoDe(c), props.unidade)}</p>
          </li>
        ))}
      </ul>
      <FolhaFormulario aberto={editando !== null} onAbertoChange={(a) => !a && setEditando(null)} titulo={editando ? ROTULOS_MODELO[editando].titulo : ''}>
        {editando && <ModeloForm chave={editando} texto={textoDe(editando)} unidade={props.unidade} onSalvo={() => setEditando(null)} />}
      </FolhaFormulario>
      <Confirmar
        aberto={restaurando !== null}
        onAbertoChange={(a) => !a && setRestaurando(null)}
        titulo="Voltar ao texto padrão?"
        descricao="O texto personalizado será apagado."
        rotuloConfirmar="Restaurar"
        onConfirmar={async () => {
          if (!restaurando) return
          const r = await restaurarModeloAction(restaurando)
          if (r.ok) toast.success('Texto padrão restaurado')
          else toast.error(r.formError ?? 'Não foi possível agora.')
          setRestaurando(null)
        }}
      />
    </>
  )
}
```
(`li` com `aria-label` é exposto como `listitem` com nome — é o que o teste usa.)

- [ ] **Step 5: Ligar na página**

Em `apps/web/app/(painel)/respostas/page.tsx`: importar `listarModelos` de `@atd/db` e `Modelos` de `@/components/painel/modelos`; trocar `{aba === 'mensagens' && <p …>Mensagens: Task 10.</p>}` por:
```tsx
        {aba === 'mensagens' && (
          <Modelos
            somenteLeitura={somenteLeitura}
            personalizados={await listarModelos(db, s.claims)}
            unidade={unidades.find((u) => u.ativo) ?? null}
          />
        )}
```

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components/painel && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(painel\)/respostas apps/web/components/painel apps/web/lib/modelos-tela.ts apps/web/lib/modelos-tela.test.ts
git commit -m "Adiciona a aba Mensagens com os modelos de resposta e prévia com dados reais

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Início completo e seção Restaurante em Mais

**Files:**
- Create: `apps/web/lib/inicio.ts`, `apps/web/lib/inicio.test.ts`, `apps/web/components/home/perguntas-sem-resposta.tsx`, `apps/web/components/painel/restaurante-form.tsx`, `apps/web/components/painel/restaurante-form.test.tsx`
- Modify: `apps/web/app/(painel)/page.tsx`, `apps/web/app/(painel)/mais/page.tsx`

**Interfaces:**
- Consumes: `resumoInicio` (Task 4); `carregarUnidadesPainel` (para o restaurante, Task 3); `salvarRestauranteAction`, `restauranteSchema`, `RestauranteForm` (Task 5); `StatCard`, `SpendCard`, `AwaitingHuman` (existentes).
- Produces:
  - `percentual(respondidos, validos): string` (`'—'` sem perguntas; inteiro arredondado com `%`)
  - Início (dono/gerente): cartão **"Respondido pela IA"** (hoje, com 7 dias na dica) e **"Perguntas sem resposta"** (top 3 com "Responder"); atendente continua sem custos nem indicador
  - Mais: seção **Restaurante** (nome, política de feriado, link da política de privacidade) — editável pelo dono, leitura para gerente/atendente

- [ ] **Step 1: Testes (vão falhar)**

`apps/web/lib/inicio.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { percentual } from './inicio'

describe('percentual', () => {
  it('sem perguntas mostra traço; arredonda', () => {
    expect(percentual(0, 0)).toBe('—')
    expect(percentual(2, 3)).toBe('67%')
    expect(percentual(5, 5)).toBe('100%')
  })
})
```

`apps/web/components/painel/restaurante-form.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RestauranteForm } from './restaurante-form'

const inicial = { nome: 'Casa Harmonia', politicaFeriado: 'como_domingo' as const, politicaUrl: '' }

describe('RestauranteForm', () => {
  it('explica a política de feriado e valida o link', async () => {
    const user = userEvent.setup()
    const acao = vi.fn().mockResolvedValue({ ok: true, data: null })
    render(<RestauranteForm inicial={inicial} acao={acao} />)
    expect(screen.getByRole('option', { name: 'Abre como no domingo' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Link da política de privacidade/), 'http://casa.test')
    await user.click(screen.getByRole('button', { name: 'Salvar restaurante' }))
    expect(await screen.findByText('Use um link completo que comece com https://')).toBeInTheDocument()
    expect(acao).not.toHaveBeenCalled()
  })
  it('somente leitura para quem não é dono', () => {
    render(<RestauranteForm inicial={inicial} acao={vi.fn()} somenteLeitura />)
    expect(screen.getByLabelText(/^Nome do restaurante/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Salvar restaurante' })).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/inicio.test.ts && pnpm vitest run --project ui apps/web/components/painel/restaurante-form.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`apps/web/lib/inicio.ts`:
```ts
export function percentual(respondidos: number, validos: number): string {
  if (validos <= 0) return '—'
  return `${Math.round((100 * respondidos) / validos)}%`
}
```

`apps/web/components/home/perguntas-sem-resposta.tsx`:
```tsx
import { MessageCircleQuestion } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { tituloDaLacuna } from '@/lib/respostas'

export function PerguntasSemResposta(props: { lacunas: { id: string; chave: string; unidade: string | null; ocorrencias: number }[] }) {
  return (
    <section aria-labelledby="titulo-sem-resposta" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="titulo-sem-resposta" className="flex items-center gap-2 font-semibold text-foreground">
        <MessageCircleQuestion aria-hidden="true" className="size-4 text-link" /> Perguntas sem resposta
      </h2>
      {props.lacunas.length === 0 ? (
        <p className="text-sm text-muted-foreground">A IA respondeu tudo o que perguntaram. Quando faltar alguma informação, ela aparece aqui.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.lacunas.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{tituloDaLacuna(l.chave)}</p>
                <p className="text-sm text-muted-foreground">{l.unidade ?? 'Todas as unidades'} · {l.ocorrencias === 1 ? '1 vez' : `${l.ocorrencias} vezes`}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="outline" className="self-start">
        <Link href="/respostas?aba=sem-resposta">{props.lacunas.length ? 'Responder' : 'Ver respostas'}</Link>
      </Button>
    </section>
  )
}
```

`apps/web/components/painel/restaurante-form.tsx`:
```tsx
'use client'
import { toast } from 'sonner'
import { applyServerErrors, Field, FormError, Select, SubmitButton, TextInput, useZodForm } from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { restauranteSchema, type RestauranteForm as Valores } from '@/lib/schemas/restaurante'

export function RestauranteForm(props: { inicial: Valores; acao: (v: Valores) => Promise<ActionResult<null>>; somenteLeitura?: boolean }) {
  const form = useZodForm(restauranteSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (v) => {
    const r = await props.acao(v)
    if (!r.ok) {
      applyServerErrors(form, r)
      return
    }
    toast.success('Restaurante salvo')
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <fieldset disabled={props.somenteLeitura} className="flex flex-col gap-4">
        <Field id="nome" label="Nome do restaurante" hint="Aparece no aviso de privacidade e no simulador" error={errors.nome?.message} required>
          {(a) => <TextInput {...a} placeholder="Ex.: Casa Harmonia" {...form.register('nome')} />}
        </Field>
        <Field id="politicaFeriado" label="Nos feriados nacionais" hint="Datas com exceção cadastrada seguem a exceção" error={errors.politicaFeriado?.message} required>
          {(a) => (
            <Select {...a} {...form.register('politicaFeriado')}>
              <option value="como_domingo">Abre como no domingo</option>
              <option value="normal">Abre como num dia comum</option>
              <option value="fechado">Fica fechado</option>
            </Select>
          )}
        </Field>
        <Field id="politicaUrl" label="Link da política de privacidade" hint="Enviado no primeiro contato do cliente (LGPD)" error={errors.politicaUrl?.message}>
          {(a) => <TextInput {...a} type="url" inputMode="url" placeholder="Ex.: https://seurestaurante.com.br/privacidade" {...form.register('politicaUrl')} />}
        </Field>
      </fieldset>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar restaurante</SubmitButton>}
    </form>
  )
}
```

- [ ] **Step 4: Páginas**

`apps/web/app/(painel)/page.tsx` — acrescentar imports `resumoInicio` (de `@atd/db`), `PerguntasSemResposta`, `percentual`; depois de `const s = await getPanelStatus(...)`:
```tsx
  const gestao = session.role !== 'atendente'
  const resumo = gestao ? await resumoInicio(getDb(), session.claims) : null
```
e trocar o bloco do `main` por:
```tsx
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="IA" value={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'alerta'} hint={online ? 'Respondendo clientes' : 'Verifique o worker'} />
          <StatCard label="Conversas abertas" value={String(s.conversasAbertas)} hint={`${s.aguardandoHumano} aguardando atendente`} />
          {resumo && (
            <StatCard
              label="Respondido pela IA hoje"
              value={percentual(resumo.taxa.hoje.respondidos, resumo.taxa.hoje.validos)}
              hint={`Últimos 7 dias: ${percentual(resumo.taxa.seteDias.respondidos, resumo.taxa.seteDias.validos)}`}
            />
          )}
        </div>
        {resumo && <PerguntasSemResposta lacunas={resumo.lacunas} />}
        {gestao && <SpendCard gastos={s.gastos} />}
        <AwaitingHuman itens={await listAwaitingHuman(getDb(), session.claims)} action={returnToAiAction} />
      </main>
```

`apps/web/app/(painel)/mais/page.tsx` — acrescentar imports `carregarUnidadesPainel` (`@atd/db`), `getDb`, `RestauranteForm`, `salvarRestauranteAction` (de `./actions`); carregar `const { restaurante } = await carregarUnidadesPainel(getDb(), session.claims)` e inserir, antes do `ThemeForm`:
```tsx
        <section aria-labelledby="restaurante" className="flex flex-col gap-3">
          <h2 id="restaurante" className="text-sm font-medium text-foreground">Restaurante</h2>
          <RestauranteForm
            inicial={{ nome: restaurante.nome, politicaFeriado: restaurante.politicaFeriado, politicaUrl: restaurante.politicaUrl ?? '' }}
            acao={salvarRestauranteAction}
            somenteLeitura={session.role !== 'dono'}
          />
        </section>
```
(`setTheme`/`signOut` continuam vindo de `../actions`; `salvarRestauranteAction` vem de `./actions`.)

- [ ] **Step 5: Rodar (inclui o e2e existente do Início, que espera "Conversas abertas" e nenhum custo para atendente)**

Run: `pnpm vitest run --project unit apps/web/lib && pnpm vitest run --project ui apps/web/components && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(painel\) apps/web/components apps/web/lib/inicio.ts apps/web/lib/inicio.test.ts
git commit -m "Completa o Início com taxa de resposta da IA e perguntas sem resposta, e adiciona Restaurante em Mais

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Simulador no back-end — conversa simulada, canal "simulador" no worker, relógio e isolamento

**Files:**
- Modify: `packages/db/src/schema/conversation.ts` (índice parcial `customers_simulado_idx`) + migration gerada `0017_simulador_cliente`
- Modify: `packages/db/src/ingest.ts` (`IngestInput.simulado`)
- Create: `packages/db/src/simulador.ts`, `packages/db/src/simulador.db.test.ts`
- Modify: `packages/db/src/index.ts` (`export * from './simulador.ts'`)
- Modify: `packages/db/src/panel.ts`, `packages/db/src/conversations-panel.ts` (+ testes `panel.db.test.ts`, `conversations-panel.db.test.ts`)
- Modify: `apps/worker/src/jobs/process-conversation.ts`
- Create: `apps/worker/src/jobs/process-conversation-simulador.db.test.ts`
- Modify: `apps/worker/src/jobs/process-conversation-s1.db.test.ts` (lista expirada com modelo personalizado)

**Interfaces:**
- Consumes: `conversations.relogioOffsetSegundos` (Task 1); `ingestInbound`, `Enqueue` (`packages/db/src/ingest.ts`, `queue.ts`); `withUserContext`, `JwtClaims`, `Tx` (`rls.ts`); `carregarContextoS1(db, restaurantId, agora)` devolve `modelos` (personalizados válidos); `renderModelo(chave, vars, personalizados?)` (`@atd/core`).
- Produces (usados pela Task 13):
  - `TELEFONE_SIMULADO = 'simulado'`
  - `type DonoSimulacao = { restaurantId: string; userId: string }`
  - `type MensagemSimulada = { id: number; direcao: 'in' | 'out'; tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'localizacao' | 'lista' | 'outro'; texto: string | null; payload: unknown; createdAt: Date }`
  - `type EstadoSimulacao = { mensagens: MensagemSimulada[]; cursor: number; digitando: boolean; estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'; relogioOffsetSegundos: number | null }`
  - `abrirSimulacao(db: Db, p: DonoSimulacao): Promise<{ conversationId: string }>`
  - `novoClienteSimulado(db: Db, p: DonoSimulacao): Promise<{ conversationId: string }>`
  - `enviarMensagemSimulada(db: Db, p: DonoSimulacao & { conversationId: string; texto: string; interativoId?: string | null }, enqueue: Enqueue): Promise<'ok' | 'nao_encontrada' | 'encerrada'>`
  - `definirRelogioSimulado(db: Db, p: DonoSimulacao & { conversationId: string; offsetSegundos: number | null }): Promise<'ok' | 'nao_encontrada'>`
  - `mensagensSimuladas(db: Db, p: DonoSimulacao & { conversationId: string; desdeId: number }): Promise<EstadoSimulacao | null>`
  - `detalhesSimulacao(db: Db, claims: JwtClaims, p: DonoSimulacao & { conversationId: string }): Promise<DetalheExecucao[] | null>` com `type DetalheExecucao = { id: number; etapa: string; modelo: string; promptVersion: string; intent: string | null; resultado: string; erro: string | null; costUsd: string; latenciaMs: number | null; itensValidos: number | null; itensRespondidos: number | null; createdAt: Date }`
  - `IngestInput.simulado?: boolean`
  - worker: `agoraDaConversa(real: Date, conv: { simulada: boolean; relogioOffsetSegundos: number | null }): Date` (exportada para teste)

**Regras desta tarefa (o porquê):**
- As funções de `simulador.ts` (exceto `detalhesSimulacao`) rodam no papel `web_app`, que **ignora a RLS** (policy `app_roles`). Por isso **toda** consulta filtra `restaurant_id` **e** o prefixo `sim:<userId>:` do cliente **e** `simulada = true`. Quem não é o dono da simulação recebe `nao_encontrada`/`null`, nunca dados.
- O telefone do cliente simulado é o literal `'simulado'`, que **não decifra**: se um defeito tentar mandar pela Meta, `decryptPhone` falha antes de qualquer chamada (defesa em profundidade).
- O mostrador lê só mensagens recebidas e as de saída com `status_envio = 'simulado'`: o que a IA gravou e o canal "entregou". Respostas canceladas (I5) não aparecem, como no WhatsApp real.
- O relógio simulado vale **só** em conversa `simulada`. Ele entra na resolução de S1 e no pendente (criação e expiração). Bloqueio, aviso de privacidade, orçamento e timestamps seguem o relógio real.

- [ ] **Step 1: Escrever os testes do banco do simulador (falham)**

`packages/db/src/simulador.db.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { createDb } from './client.ts'
import { getTestDb, resetDb, seedRestaurant, seedStaff, setupPgbossRoles, WEB_URL } from './test-utils.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import { aiRuns } from './schema/ops.ts'
import type { Enqueue } from './queue.ts'
import {
  abrirSimulacao, definirRelogioSimulado, detalhesSimulacao, enviarMensagemSimulada, mensagensSimuladas, novoClienteSimulado,
  TELEFONE_SIMULADO,
} from './simulador.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const enfileirados: string[] = []
const enqueue: Enqueue = async (_tx, id) => { enfileirados.push(id) }
const claims = (sub: string) => ({ sub, role: 'authenticated' as const, aal: 'aal2' as const })

async function setup() {
  const { restaurantId } = await seedRestaurant(db)
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const gerente = await seedStaff(db, sql, { restaurantId, papel: 'gerente' })
  return { restaurantId, dono, gerente }
}

describe('simulador (banco)', () => {
  it('abrir cria cliente e conversa simulados do usuário; abrir de novo devolve a mesma', async () => {
    const { restaurantId, dono } = await setup()
    const a = await abrirSimulacao(db, { restaurantId, userId: dono })
    const b = await abrirSimulacao(db, { restaurantId, userId: dono })
    expect(b.conversationId).toBe(a.conversationId)
    const [c] = await db.select().from(customers)
    expect(c).toMatchObject({ simulado: true, telefoneCifrado: TELEFONE_SIMULADO, nomePerfil: 'Cliente simulado' })
    expect(c!.waIdHash).toMatch(new RegExp(`^sim:${dono}:\\d+$`))
    const [conv] = await db.select().from(conversations)
    expect(conv).toMatchObject({ simulada: true, estado: 'ia', relogioOffsetSegundos: null })
  })

  it('abrir duas vezes ao mesmo tempo cria uma conversa só', async () => {
    const { restaurantId, dono } = await setup()
    const [a, b] = await Promise.all([abrirSimulacao(db, { restaurantId, userId: dono }), abrirSimulacao(db, { restaurantId, userId: dono })])
    expect(a.conversationId).toBe(b.conversationId)
    expect(await db.select().from(customers)).toHaveLength(1)
  })

  it('novo cliente encerra a conversa anterior e mantém o relógio simulado', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const a = await abrirSimulacao(db, p)
    expect(await definirRelogioSimulado(db, { ...p, conversationId: a.conversationId, offsetSegundos: 3600 })).toBe('ok')
    const b = await novoClienteSimulado(db, p)
    expect(b.conversationId).not.toBe(a.conversationId)
    const convs = await db.select().from(conversations).orderBy(asc(conversations.createdAt))
    expect(convs.map((c) => [c.id, c.estado, c.relogioOffsetSegundos])).toEqual([
      [a.conversationId, 'encerrada', 3600],
      [b.conversationId, 'ia', 3600],
    ])
    expect(await db.select().from(customers)).toHaveLength(2)
    expect((await abrirSimulacao(db, p)).conversationId).toBe(b.conversationId)
  })

  it('enviar grava a mensagem como simulada (wamid sim.*) e enfileira o mesmo job do webhook', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    enfileirados.length = 0
    expect(await enviarMensagemSimulada(db, { ...p, conversationId, texto: 'abre domingo?' }, enqueue)).toBe('ok')
    expect(enfileirados).toEqual([conversationId])
    const [m] = await db.select().from(messages)
    expect(m).toMatchObject({ conversationId, direcao: 'in', autor: 'cliente', tipo: 'texto', texto: 'abre domingo?' })
    expect(m!.wamid).toMatch(/^sim\./)
  })

  it('outro usuário não envia, não lê, não muda o relógio nem vê detalhes da simulação alheia', async () => {
    const { restaurantId, dono, gerente } = await setup()
    const { conversationId } = await abrirSimulacao(db, { restaurantId, userId: dono })
    const alheio = { restaurantId, userId: gerente, conversationId }
    expect(await enviarMensagemSimulada(db, { ...alheio, texto: 'oi' }, enqueue)).toBe('nao_encontrada')
    expect(await mensagensSimuladas(db, { ...alheio, desdeId: 0 })).toBeNull()
    expect(await definirRelogioSimulado(db, { ...alheio, offsetSegundos: 60 })).toBe('nao_encontrada')
    expect(await detalhesSimulacao(db, claims(gerente), alheio)).toBeNull()
  })

  it('conversa real nunca é tratada como simulação, mesmo com o id certo', async () => {
    const { restaurantId, dono } = await setup()
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: `sim:${dono}:1`, telefoneCifrado: 'x' }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id }).returning()
    expect(await mensagensSimuladas(db, { restaurantId, userId: dono, conversationId: conv!.id, desdeId: 0 })).toBeNull()
  })

  it('conversa encerrada não recebe mensagem', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const a = await abrirSimulacao(db, p)
    await novoClienteSimulado(db, p)
    expect(await enviarMensagemSimulada(db, { ...p, conversationId: a.conversationId, texto: 'oi' }, enqueue)).toBe('encerrada')
  })

  it('mensagens: mostra recebidas e saídas "simulado"; esconde pendentes e canceladas; cursor volta para a primeira pendente', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    await enviarMensagemSimulada(db, { ...p, conversationId, texto: 'oi' }, enqueue)
    const base = { restaurantId, conversationId, direcao: 'out' as const, autor: 'ia' as const, tipo: 'texto' as const }
    const [entregue] = await db.insert(messages).values({ ...base, texto: 'entregue', statusEnvio: 'simulado' }).returning()
    const [pendente] = await db.insert(messages).values({ ...base, texto: 'pendente', statusEnvio: 'pendente' }).returning()
    await db.insert(messages).values({ ...base, texto: 'cancelada', statusEnvio: 'cancelado' })
    const r = await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 })
    expect(r!.mensagens.map((m) => m.texto)).toEqual(['oi', 'entregue'])
    expect(r!.cursor).toBe(pendente!.id - 1)
    expect(r!.digitando).toBe(true) // há entrada não processada e saída pendente
    const depois = await mensagensSimuladas(db, { ...p, conversationId, desdeId: entregue!.id })
    expect(depois!.mensagens).toEqual([])
  })

  it('relógio: aceita deslocamento e volta ao real com null', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    await definirRelogioSimulado(db, { ...p, conversationId, offsetSegundos: -86_400 })
    expect((await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 }))!.relogioOffsetSegundos).toBe(-86_400)
    await definirRelogioSimulado(db, { ...p, conversationId, offsetSegundos: null })
    expect((await mensagensSimuladas(db, { ...p, conversationId, desdeId: 0 }))!.relogioOffsetSegundos).toBeNull()
  })

  it('detalhes: últimas execuções da IA desta conversa, mais recentes primeiro (só dono/gerente pela RLS)', async () => {
    const { restaurantId, dono } = await setup()
    const p = { restaurantId, userId: dono }
    const { conversationId } = await abrirSimulacao(db, p)
    for (const intent of ['a', 'b']) {
      await db.insert(aiRuns).values({ restaurantId, conversationId, etapa: 'triagem', modelo: 'm', promptVersion: 'v', costUsd: '0.0001', intent, resultado: 'ok', simulado: true })
    }
    const d = await detalhesSimulacao(db, claims(dono), { ...p, conversationId })
    expect(d!.map((x) => x.intent)).toEqual(['b', 'a'])
  })

  it('fidelidade de produção: tudo funciona conectado como web_app', async () => {
    await setupPgbossRoles()
    const { restaurantId, dono } = await setup()
    const web = createDb(WEB_URL, { max: 1 })
    try {
      const p = { restaurantId, userId: dono }
      const { conversationId } = await abrirSimulacao(web.db, p)
      expect(await enviarMensagemSimulada(web.db, { ...p, conversationId, texto: 'oi' }, enqueue)).toBe('ok')
      expect(await definirRelogioSimulado(web.db, { ...p, conversationId, offsetSegundos: 60 })).toBe('ok')
      expect((await mensagensSimuladas(web.db, { ...p, conversationId, desdeId: 0 }))!.mensagens).toHaveLength(1)
      await novoClienteSimulado(web.db, p)
    } finally {
      await web.sql.end()
    }
  })
})
```

Acrescentar em `packages/db/src/panel.db.test.ts` (dentro do `describe('painel')`):
```ts
  it('status: conversa simulada não entra em abertas nem em aguardando atendente', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'sim:x:1', telefoneCifrado: 'simulado', simulado: true }).returning()
    await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado: 'aguardando_humano', simulada: true })
    const s = await getPanelStatus(db, { sub: atendente, role: 'authenticated', aal: 'aal1' })
    expect(s.aguardandoHumano).toBe(0)
    expect(s.conversasAbertas).toBe(0)
  })
```

Acrescentar em `packages/db/src/conversations-panel.db.test.ts` (dentro do `describe`):
```ts
  it('conversa simulada pedindo atendente não aparece na fila nem pode ser devolvida', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const [c] = await db.insert(customers).values({ restaurantId, waIdHash: 'sim:x:1', telefoneCifrado: 'simulado', simulado: true }).returning()
    const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado: 'aguardando_humano', simulada: true }).returning()
    expect(await listAwaitingHuman(db, claims(atendente))).toEqual([])
    expect(await returnToAi(db, claims(atendente), conv!.id)).toBe('nao_encontrada')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project db packages/db/src/simulador.db.test.ts packages/db/src/panel.db.test.ts packages/db/src/conversations-panel.db.test.ts`
Expected: FAIL. `simulador.ts` ainda não existe, e os dois testes novos do painel contam a conversa simulada.

- [ ] **Step 3: Índice do cliente simulado e flag na ingestão**

`packages/db/src/schema/conversation.ts`, na lista de índices de `customers`:
```ts
    // simulador: "conversa aberta do usuário" varre só os clientes simulados do restaurante
    index('customers_simulado_idx').on(t.restaurantId, t.createdAt.desc()).where(sql`simulado`),
```
Run: `pnpm --filter @atd/db exec drizzle-kit generate --name=simulador_cliente`
Expected: `0017_simulador_cliente.sql` só com `CREATE INDEX "customers_simulado_idx" ON "customers" USING btree ("restaurant_id","created_at" DESC NULLS LAST) WHERE simulado;` (leia o SQL; nada além disso). Depois: `pnpm db:migrate`.

`packages/db/src/ingest.ts`: no tipo `IngestInput`, depois de `interativoId`:
```ts
  /** Mensagem do simulador do painel: cliente e conversa nascem marcados (nunca saem pela Meta). */
  simulado?: boolean
```
No `insert(customers).values({...})` acrescentar `simulado: input.simulado ?? false,`; no `insert(conversations).values({...})` acrescentar `simulada: input.simulado ?? false,`. Os `onConflictDoUpdate` **não** mudam: um cliente/conversa existente nunca troca de real para simulado.

- [ ] **Step 4: Implementar `packages/db/src/simulador.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, like, min, ne, or, sql } from 'drizzle-orm'
import type { Db } from './client.ts'
import { ingestInbound } from './ingest.ts'
import type { Enqueue } from './queue.ts'
import { withUserContext, type JwtClaims, type Tx } from './rls.ts'
import { conversations, customers, messages } from './schema/conversation.ts'
import { aiRuns } from './schema/ops.ts'

/** Não decifra: se um defeito tentar enviar pela Meta, a decifragem falha antes de qualquer chamada. */
export const TELEFONE_SIMULADO = 'simulado'
const MAX_MENSAGENS = 100
const MAX_DETALHES = 5

export type DonoSimulacao = { restaurantId: string; userId: string }
type NaConversa = DonoSimulacao & { conversationId: string }
export type MensagemSimulada = {
  id: number
  direcao: 'in' | 'out'
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'localizacao' | 'lista' | 'outro'
  texto: string | null
  payload: unknown
  createdAt: Date
}
export type EstadoSimulacao = {
  mensagens: MensagemSimulada[]
  /** Próximo `desdeId`: nunca passa de uma resposta ainda pendente (ela aparece quando for entregue). */
  cursor: number
  digitando: boolean
  estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'
  relogioOffsetSegundos: number | null
}
export type DetalheExecucao = {
  id: number; etapa: string; modelo: string; promptVersion: string; intent: string | null
  resultado: string; erro: string | null; costUsd: string; latenciaMs: number | null
  /** resolução de S1: itens válidos e quantos foram respondidos com dado */
  itensValidos: number | null; itensRespondidos: number | null; createdAt: Date
}

// userId vem da sessão (uuid): não tem % nem _, então serve direto no LIKE
const prefixo = (userId: string) => `sim:${userId}:`
const doUsuario = (userId: string) => like(customers.waIdHash, `${prefixo(userId)}%`)

/** web_app ignora a RLS: o filtro por restaurante + prefixo do usuário + simulada É a autorização. */
async function conversaDoUsuario(db: Db | Tx, p: NaConversa) {
  const [c] = await db
    .select({
      id: conversations.id, waIdHash: customers.waIdHash, estado: conversations.estado,
      processedUpToId: conversations.processedUpToId, relogioOffsetSegundos: conversations.relogioOffsetSegundos,
    })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(
      eq(conversations.id, p.conversationId),
      eq(conversations.restaurantId, p.restaurantId),
      eq(conversations.simulada, true),
      eq(customers.simulado, true),
      doUsuario(p.userId),
    ))
  return c ?? null
}

/** Serializa abrir/novo cliente do mesmo usuário (evita duas conversas abertas por clique duplo). */
async function travar(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${prefixo(userId)}, 0))`)
}

function abertasDoUsuario(tx: Tx, p: DonoSimulacao) {
  return tx
    .select({ id: conversations.id, relogioOffsetSegundos: conversations.relogioOffsetSegundos })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(
      eq(customers.restaurantId, p.restaurantId),
      eq(customers.simulado, true),
      doUsuario(p.userId),
      eq(conversations.simulada, true),
      ne(conversations.estado, 'encerrada'),
    ))
    .orderBy(desc(customers.createdAt))
}

async function criar(tx: Tx, p: DonoSimulacao, relogioOffsetSegundos: number | null) {
  const [c] = await tx
    .insert(customers)
    .values({
      restaurantId: p.restaurantId, waIdHash: `${prefixo(p.userId)}${Date.now()}`,
      telefoneCifrado: TELEFONE_SIMULADO, nomePerfil: 'Cliente simulado', simulado: true,
    })
    .returning({ id: customers.id })
  const [conv] = await tx
    .insert(conversations)
    .values({ restaurantId: p.restaurantId, customerId: c!.id, simulada: true, relogioOffsetSegundos })
    .returning({ id: conversations.id })
  return { conversationId: conv!.id }
}

export function abrirSimulacao(db: Db, p: DonoSimulacao): Promise<{ conversationId: string }> {
  return db.transaction(async (tx) => {
    await travar(tx, p.userId)
    const [atual] = await abertasDoUsuario(tx, p)
    return atual ? { conversationId: atual.id } : criar(tx, p, null)
  })
}

/** Começa do zero (aviso de privacidade, pendente, histórico), mantendo o relógio simulado escolhido. */
export function novoClienteSimulado(db: Db, p: DonoSimulacao): Promise<{ conversationId: string }> {
  return db.transaction(async (tx) => {
    await travar(tx, p.userId)
    const abertas = await abertasDoUsuario(tx, p)
    if (abertas.length > 0) {
      await tx.update(conversations)
        .set({ estado: 'encerrada', pendente: null })
        .where(inArray(conversations.id, abertas.map((a) => a.id)))
    }
    return criar(tx, p, abertas[0]?.relogioOffsetSegundos ?? null)
  })
}

export async function enviarMensagemSimulada(
  db: Db,
  p: NaConversa & { texto: string; interativoId?: string | null },
  enqueue: Enqueue,
): Promise<'ok' | 'nao_encontrada' | 'encerrada'> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return 'nao_encontrada'
  if (c.estado === 'encerrada') return 'encerrada'
  await ingestInbound(db, {
    restaurantId: p.restaurantId,
    waIdHash: c.waIdHash,
    telefoneCifrado: TELEFONE_SIMULADO,
    profileName: null,
    wamid: `sim.${randomUUID()}`,
    tipo: 'texto',
    texto: p.texto,
    mediaId: null,
    timestamp: new Date(),
    interativoId: p.interativoId ?? null,
    simulado: true,
  }, enqueue)
  return 'ok'
}

export async function definirRelogioSimulado(
  db: Db,
  p: NaConversa & { offsetSegundos: number | null },
): Promise<'ok' | 'nao_encontrada'> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return 'nao_encontrada'
  await db.update(conversations).set({ relogioOffsetSegundos: p.offsetSegundos }).where(eq(conversations.id, c.id))
  return 'ok'
}

export async function mensagensSimuladas(db: Db, p: NaConversa & { desdeId: number }): Promise<EstadoSimulacao | null> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return null
  const doChat = eq(messages.conversationId, c.id)
  const mensagens = await db
    .select({
      id: messages.id, direcao: messages.direcao, tipo: messages.tipo, texto: messages.texto,
      payload: messages.payload, createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(doChat, gt(messages.id, p.desdeId), or(eq(messages.direcao, 'in'), eq(messages.statusEnvio, 'simulado'))))
    .orderBy(asc(messages.id))
    .limit(MAX_MENSAGENS)
  const [pend] = await db
    .select({ id: min(messages.id) })
    .from(messages)
    .where(and(doChat, eq(messages.direcao, 'out'), eq(messages.statusEnvio, 'pendente')))
  const [naoLida] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(doChat, eq(messages.direcao, 'in'), gt(messages.id, c.processedUpToId)))
    .limit(1)
  const ultimo = mensagens.at(-1)?.id ?? p.desdeId
  const primeiraPendente = pend?.id ?? null
  return {
    mensagens,
    cursor: primeiraPendente === null ? ultimo : Math.min(primeiraPendente - 1, ultimo),
    digitando: c.estado === 'ia' && (!!naoLida || primeiraPendente !== null),
    estado: c.estado,
    relogioOffsetSegundos: c.relogioOffsetSegundos,
  }
}

/** Execuções da IA desta conversa simulada. A leitura de ai_runs passa pela RLS (só dono/gerente). */
export async function detalhesSimulacao(db: Db, claims: JwtClaims, p: NaConversa): Promise<DetalheExecucao[] | null> {
  const c = await conversaDoUsuario(db, p)
  if (!c) return null
  return withUserContext(db, claims, (tx) =>
    tx
      .select({
        id: aiRuns.id, etapa: aiRuns.etapa, modelo: aiRuns.modelo, promptVersion: aiRuns.promptVersion,
        intent: aiRuns.intent, resultado: aiRuns.resultado, erro: aiRuns.erro, costUsd: aiRuns.costUsd,
        latenciaMs: aiRuns.latenciaMs, itensValidos: aiRuns.itensValidos, itensRespondidos: aiRuns.itensRespondidos,
        createdAt: aiRuns.createdAt,
      })
      .from(aiRuns)
      .where(eq(aiRuns.conversationId, c.id))
      .orderBy(desc(aiRuns.id))
      .limit(MAX_DETALHES),
  )
}
```
Ajuste fino permitido: se o tipo inferido de alguma coluna de `aiRuns` diferir de `DetalheExecucao` (por exemplo, `etapa` é enum ou `latenciaMs` é `number | null`), alinhe o **tipo exportado** ao inferido pelo Drizzle (`typeof aiRuns.$inferSelect[...]`). Não converta valores.

Em `packages/db/src/index.ts`: `export * from './simulador.ts'`.

- [ ] **Step 5: Tirar a simulação das telas reais**

`packages/db/src/panel.ts`: importar `and` (já importado) e trocar as duas contagens:
```ts
    const real = eq(conversations.simulada, false)
    const [abertas] = await tx.select({ n: count() }).from(conversations).where(and(real, ne(conversations.estado, 'encerrada')))
    const [aguardando] = await tx.select({ n: count() }).from(conversations).where(and(real, inArray(conversations.estado, ['aguardando_humano', 'humano'])))
```

`packages/db/src/conversations-panel.ts`:
- `listAwaitingHuman`: `.where(and(eq(conversations.simulada, false), inArray(conversations.estado, [...COM_HUMANO])))`
- `returnToAi`: no `update`, `.where(and(eq(conversations.id, conversationId), eq(conversations.simulada, false), inArray(conversations.estado, [...COM_HUMANO])))`; na checagem `existe`, `.where(and(eq(conversations.id, conversationId), eq(conversations.simulada, false)))`.

- [ ] **Step 6: Rodar os testes do banco**

Run: `pnpm vitest run --project db packages/db/src/simulador.db.test.ts packages/db/src/panel.db.test.ts packages/db/src/conversations-panel.db.test.ts packages/db/src/ingest.db.test.ts packages/db/src/ingest-interativo.db.test.ts && pnpm --filter @atd/db typecheck`
Expected: PASS.

- [ ] **Step 7: EXPLAIN das consultas do polling (vão no relatório)**

Com o banco local migrado, rodar no `psql` do Supabase local (`pnpm exec supabase db shell` ou `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`):
```sql
explain select c.id from conversations c join customers cu on cu.id = c.customer_id
 where cu.restaurant_id = '00000000-0000-0000-0000-000000000000' and cu.simulado and cu.wa_id_hash like 'sim:x:%'
   and c.simulada and c.estado <> 'encerrada' order by cu.created_at desc;
explain select id from messages where conversation_id = '00000000-0000-0000-0000-000000000000' and id > 0 order by id limit 100;
```
Expected: a primeira usa `customers_simulado_idx`; a segunda usa `messages_conversation_id_idx`. (Em tabela quase vazia o planejador pode preferir `Seq Scan`; nesse caso repita com `set enable_seqscan = off;` e cole os dois planos no relatório.)

- [ ] **Step 8: Escrever os testes do worker (falham)**

`apps/worker/src/jobs/process-conversation-simulador.db.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { keyFromBase64, periodStarts } from '@atd/core'
import { abrirSimulacao, enviarMensagemSimulada, schema, type Enqueue } from '@atd/db'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from '@atd/db/test-utils'
import type { LlmClient, TriageV2 } from '@atd/ai'
import { createLogger } from '../logger.ts'
import { agoraDaConversa, processConversation, type ProcessDeps } from './process-conversation.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const phoneKey = keyFromBase64(Buffer.alloc(32, 7).toString('base64'))
const noopEnqueue: Enqueue = async () => undefined
const log = createLogger('silent')
const SEG_14H = new Date('2026-10-05T14:00:00-03:00')
const DOM_12H = new Date('2026-10-11T12:00:00-03:00')

const item = (tipo: string) =>
  ({ servico: 'horario_unidades', tipo, unidade: null, data: null, tema: null }) as TriageV2['itens'][number]
const servico = (s: string) =>
  ({ servico: s, tipo: null, unidade: null, data: null, tema: null }) as TriageV2['itens'][number]

function fakeLlm(script: TriageV2[]) {
  let n = 0
  const llm: LlmClient = {
    async completeJson(p) {
      const data = p.parse(script[Math.min(n++, script.length - 1)])
      return { ok: true as const, data, model: 'fake/m', usage: { tokensIn: 10, tokensOut: 5, tokensCache: 0, costUsd: '0.000100' }, latencyMs: 5 }
    },
  }
  return llm
}

/** Qualquer chamada à Meta numa conversa simulada é defeito. */
const waProibido = {
  async sendText(): Promise<never> { throw new Error('sendText chamado em simulação') },
  async sendLocation(): Promise<never> { throw new Error('sendLocation chamado em simulação') },
  async sendList(): Promise<never> { throw new Error('sendList chamado em simulação') },
}

const deps = (llm: LlmClient): ProcessDeps =>
  ({ db, llm, wa: waProibido, phoneKey, triageModels: ['fake/m'], log, requeue: async () => undefined, now: () => SEG_14H })

async function setup() {
  const { restaurantId, unitId } = await seedRestaurant(db)
  await db.update(schema.units).set({ endereco: 'SCLS 404', cidade: 'Brasília', uf: 'DF', lat: -15.81, lng: -47.89 }).where(eq(schema.units.id, unitId))
  await db.insert(schema.unitHours).values({ restaurantId, unitId, weekday: 0, turno: 1, abre: '11:30', fecha: '16:00' })
  await db.insert(schema.budgetLimits).values([
    { restaurantId, escopo: 'ia', periodo: 'dia', limiteUsd: '1' },
    { restaurantId, escopo: 'ia', periodo: 'mes', limiteUsd: '10' },
  ])
  const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
  const p = { restaurantId, userId: dono }
  const { conversationId } = await abrirSimulacao(db, p)
  const enviar = (texto: string) => enviarMensagemSimulada(db, { ...p, conversationId, texto }, noopEnqueue)
  return { restaurantId, conversationId, enviar }
}

const saidas = (conversationId: string) =>
  db.select().from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .then((ms) => ms.filter((m) => m.direcao === 'out'))

describe('canal simulador no worker', () => {
  it('responde pelo pipeline real, marca "simulado" e nunca chama a Meta nem decifra telefone', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('estão abertos agora?')
    expect(await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)).toBe('replied')
    const out = await saidas(conversationId)
    expect(out.length).toBeGreaterThanOrEqual(2) // aviso de privacidade + resposta
    expect(out.every((m) => m.statusEnvio === 'simulado' && m.wamid === null)).toBe(true)
    const [cliente] = await db.select().from(schema.customers)
    expect(cliente!.privacyNoticeSentAt).not.toBeNull()
    const runs = await db.select().from(schema.aiRuns)
    expect(runs.every((r) => r.simulado)).toBe(true)
  })

  it('relógio simulado: domingo 12h responde "aberta" (segunda 14h real estaria fechada), mas o orçamento conta no dia real', async () => {
    const { conversationId, enviar, restaurantId } = await setup()
    const offset = Math.round((DOM_12H.getTime() - SEG_14H.getTime()) / 1000)
    await db.update(schema.conversations).set({ relogioOffsetSegundos: offset }).where(eq(schema.conversations.id, conversationId))
    await enviar('estão abertos agora?')
    await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)
    const out = await saidas(conversationId)
    expect(out.at(-1)!.texto).toMatch(/está aberta agora/)
    const contadores = await db.select().from(schema.budgetCounters).where(eq(schema.budgetCounters.restaurantId, restaurantId))
    const dia = contadores.find((c) => c.periodo === 'dia')!
    expect(dia.inicioPeriodo).toBe(periodStarts(new Date(), 'America/Sao_Paulo').dia)
  })

  it('sem relógio simulado, a mesma pergunta usa o relógio real (segunda 14h: fechada)', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('estão abertos agora?')
    await processConversation(deps(fakeLlm([{ itens: [item('aberto_agora')], fora_escopo: false }])), conversationId)
    expect((await saidas(conversationId)).at(-1)!.texto).toMatch(/está fechada agora/)
  })

  it('pedido de atendente na simulação: vai para aguardando_humano, sem lacuna e fora da fila real', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('quero falar com um atendente')
    await processConversation(deps(fakeLlm([{ itens: [servico('humano')], fora_escopo: false }])), conversationId)
    const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId))
    expect(conv!.estado).toBe('aguardando_humano')
    expect((await saidas(conversationId)).every((m) => m.statusEnvio === 'simulado')).toBe(true)
  })

  it('pergunta sem dado na simulação não cria lacuna', async () => {
    const { conversationId, enviar } = await setup()
    await enviar('tem estacionamento?')
    await processConversation(deps(fakeLlm([{ itens: [{ ...item('info'), tema: 'estacionamento' }], fora_escopo: false }])), conversationId)
    expect(await db.select().from(schema.knowledgeGaps)).toEqual([])
  })
})

describe('agoraDaConversa', () => {
  const real = new Date('2026-10-05T17:00:00Z')
  it('conversa real ignora qualquer deslocamento', () => {
    expect(agoraDaConversa(real, { simulada: false, relogioOffsetSegundos: 3600 })).toEqual(real)
  })
  it('conversa simulada sem relógio usa o real', () => {
    expect(agoraDaConversa(real, { simulada: true, relogioOffsetSegundos: null })).toEqual(real)
  })
  it('conversa simulada soma o deslocamento', () => {
    expect(agoraDaConversa(real, { simulada: true, relogioOffsetSegundos: -60 })).toEqual(new Date('2026-10-05T16:59:00Z'))
  })
})
```
Em `apps/worker/src/jobs/process-conversation-s1.db.test.ts`, logo depois do teste `'toque na lista depois de expirada: avisa sem chamar o LLM'`:
```ts
  it('lista expirada usa o texto personalizado pelo restaurante', async () => {
    const { restaurantId, ids } = await setup(4)
    await db.insert(schema.replyTemplates).values({ restaurantId, chave: 'lista_expirada', texto: 'Ops, essa lista venceu. Pergunte de novo, por favor.' })
    const conv = await receive(restaurantId, 'Selecionado', ids['Asa Norte']!)
    const { llm, calls } = fakeLlm([])
    const wa = fakeWa()
    await processConversation(deps(llm, wa), conv)
    expect(calls).toHaveLength(0)
    expect(wa.enviados.at(-1)!.corpo).toBe('Ops, essa lista venceu. Pergunte de novo, por favor.')
  })
```

- [ ] **Step 9: Rodar e ver falhar**

Run: `pnpm vitest run --project db apps/worker/src/jobs/process-conversation-simulador.db.test.ts apps/worker/src/jobs/process-conversation-s1.db.test.ts`
Expected: FAIL. `agoraDaConversa` não existe; a entrega chama `decryptPhone('simulado')`, que lança erro; a lista expirada ignora o texto personalizado.

- [ ] **Step 10: Implementar no worker**

`apps/worker/src/jobs/process-conversation.ts`:

1. Exportar o relógio da conversa (perto de `processConversation`):
```ts
/** Relógio da conversa: só o simulador pode deslocá-lo; conversa real usa sempre o relógio real. */
export function agoraDaConversa(real: Date, conv: { simulada: boolean; relogioOffsetSegundos: number | null }): Date {
  return conv.simulada && conv.relogioOffsetSegundos != null ? new Date(real.getTime() + conv.relogioOffsetSegundos * 1000) : real
}
```
2. Em `decide`, depois do `if (!ctx) return 'not_found'` e antes do bloqueio por flood, **não** mudar `now`. Troque só a chamada de `classify`:
```ts
  // relógio simulado vale para S1 e pendente; bloqueio, aviso de privacidade e orçamento seguem o real
  const decision = await classify(deps, ctx, pending, agoraDaConversa(now, ctx.conv))
```
3. Em `respostaDaLista`, no ramo da lista expirada, usar os modelos do restaurante:
```ts
    if (!idLista) return null
    const { modelos } = await carregarContextoS1(deps.db, ctx.restaurant.id, now)
    const run: AiRunRow = { etapa: 'resposta', modelo: 'deterministico', promptVersion: 's1-lista', costUsd: '0', intent: 'lista_expirada', resultado: 'ok' }
    return {
      replies: [], saidas: [{ tipo: 'texto', texto: renderModelo('lista_expirada', {}, modelos) }],
      autor: 'ia', falhas: 'zerar', pendente: null, runs: [run],
    }
```
4. Em `deliver`: incluir `simulada: conversations.simulada` no `select` e trocar o trecho a partir de `const to = …` por:
```ts
  // canal simulador: conversa do painel nunca chama a Meta nem decifra telefone
  const simulada = pendingOut[0]!.simulada
  const to = simulada ? null : decryptPhone(pendingOut[0]!.telefoneCifrado, deps.phoneKey)
  for (const m of pendingOut) {
    // I5: com humano no controle, respostas da IA ainda pendentes são canceladas; as do sistema seguem
    if (m.autor === 'ia') {
      const [cur] = await db.select({ estado: conversations.estado }).from(conversations).where(eq(conversations.id, conversationId))
      if (cur && cur.estado !== 'ia') {
        await db.update(messages).set({ statusEnvio: 'cancelado' }).where(eq(messages.id, m.id))
        continue
      }
    }
    if (to === null) {
      await db.update(messages).set({ statusEnvio: 'simulado' }).where(eq(messages.id, m.id))
      await marcarAvisoEnviado(deps, m)
      continue
    }
    const r = await enviar(deps, to, m)
    if (r === 'payload_invalido') {
      await db.update(messages).set({ statusEnvio: 'falhou:payload_invalido' }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, messageId: m.id }, 'payload de mensagem interativa inválido; envio descartado')
      continue
    }
    if (r.ok) {
      await db.update(messages).set({ wamid: r.wamid, statusEnvio: 'enviado' }).where(eq(messages.id, m.id))
      await marcarAvisoEnviado(deps, m)
    } else if (!r.retryable) {
      await db.update(messages).set({ statusEnvio: `falhou:${r.code ?? 'desconhecido'}` }).where(eq(messages.id, m.id))
      deps.log.warn({ conversationId, code: r.code }, 'envio recusado permanentemente pela Meta')
    } else {
      throw new Error(`Falha temporária ao enviar pelo WhatsApp (código ${r.code ?? 'rede'})`)
    }
  }
}

async function marcarAvisoEnviado(deps: ProcessDeps, m: { replyKey: string | null; customerId: string }) {
  if (m.replyKey !== 'avisoPrivacidade') return
  await deps.db.update(customers).set({ privacyNoticeSentAt: deps.now?.() ?? new Date() }).where(eq(customers.id, m.customerId))
}
```
(O resto de `deliver` e `enviar` não muda.)

- [ ] **Step 11: Rodar tudo do worker e do banco**

Run: `pnpm vitest run --project db apps/worker packages/db/src/simulador.db.test.ts packages/db/src/panel.db.test.ts packages/db/src/conversations-panel.db.test.ts && pnpm --filter @atd/worker typecheck && pnpm --filter @atd/db typecheck && pnpm lint`
Expected: PASS. Os testes antigos do worker continuam verdes: conversa real segue decifrando e enviando como antes.

- [ ] **Step 12: Commit**

```bash
git add packages/db/src/schema/conversation.ts packages/db/migrations packages/db/src/ingest.ts packages/db/src/simulador.ts packages/db/src/simulador.db.test.ts packages/db/src/index.ts packages/db/src/panel.ts packages/db/src/panel.db.test.ts packages/db/src/conversations-panel.ts packages/db/src/conversations-panel.db.test.ts apps/worker/src/jobs
git commit -m "Liga o simulador ao pipeline real: conversa simulada, canal sem Meta e relógio simulado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Simulador no painel — Server Actions, polling, novo cliente, relógio e detalhes

**Files:**
- Create: `apps/web/lib/schemas/simulador.ts`
- Create: `apps/web/lib/simulador-tela.ts`, `apps/web/lib/simulador-tela.test.ts`
- Create: `apps/web/app/(painel)/simulador-actions.ts`, `apps/web/app/(painel)/simulador-actions.test.ts`
- Create: `apps/web/components/simulator/use-simulador.ts`, `apps/web/components/simulator/controles.tsx`
- Modify: `apps/web/components/simulator/launcher.tsx`, `simulator-dialog.tsx`, `phone-frame.tsx`, `launcher.test.tsx`
- Modify: `apps/web/app/(painel)/layout.tsx`
- Delete: `apps/web/components/simulator/use-local-simulator.ts`

**Interfaces:**
- Consumes (Task 12, de `@atd/db`): `abrirSimulacao`, `novoClienteSimulado`, `enviarMensagemSimulada`, `definirRelogioSimulado`, `mensagensSimuladas`, `detalhesSimulacao`, tipos `EstadoSimulacao`, `MensagemSimulada`, `DetalheExecucao`; `enqueueProcess(boss)` e `getBoss()` (`apps/web/lib/server/boss.ts`); `requireStaff(roles)` devolve `{ userId, role, restaurantId, claims }`; `SimMessage` (`components/simulator/types.ts`); `agoraLocal`, `diaDaSemana`, `dataValida`, `partesDaData` de `@atd/core/s1`.
- Produces:
  - `apps/web/lib/simulador-tela.ts`: tipos `MensagemTela`, `RespostaSimulador`, `DetalheTela`; constantes `AVISO_SIMULACAO`, `MAX_DESLOCAMENTO_SEGUNDOS`; funções `paraSimMessage(m, timezone, offsetSegundos)`, `avisoDoEstado(estado)`, `instanteDoHorarioLocal(local, timezone)`, `horarioLocal(instante, timezone)`, `rotuloRelogio(offsetSegundos, timezone, agora)`
  - `type AcoesSimulador` (em `use-simulador.ts`), que o layout preenche com as Server Actions de `simulador-actions.ts`
  - `SimulatorLauncher({ restaurante, timezone, acoes })`

**Regras desta tarefa:**
- As Server Actions chegam ao componente **por props**, vindas do layout (Server Component). Assim o componente cliente não importa módulo de servidor e o teste usa ações falsas.
- O simulador só existe para dono e gerente. O layout não renderiza o botão para atendente, e toda action chama `requireStaff(['dono', 'gerente'])`.
- O mostrador é **exatamente** o que o pipeline gravou (I2). Não há resposta local fingida: a única coisa local é o balão "enviando" do cliente até o servidor confirmar.
- A resposta leva uns 5 s. O job tem o mesmo atraso de agrupamento do webhook (`PROCESS_DELAY_SECONDS = 4`), e enquanto isso o cabeçalho mostra "digitando…".

- [ ] **Step 1: Testes das regras de tela (falham)**

`apps/web/lib/simulador-tela.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  avisoDoEstado, horarioLocal, instanteDoHorarioLocal, paraSimMessage, rotuloRelogio, type MensagemTela,
} from './simulador-tela'

const TZ = 'America/Sao_Paulo'
const base = { criadaEm: '2026-10-05T17:01:00.000Z', payload: null } as const

describe('paraSimMessage', () => {
  it('texto do cliente e do restaurante, com hora no fuso do restaurante', () => {
    const cli: MensagemTela = { ...base, id: 1, direcao: 'in', tipo: 'texto', texto: 'abre domingo?' }
    const res: MensagemTela = { ...base, id: 2, direcao: 'out', tipo: 'texto', texto: 'Abrimos às 11h30.' }
    expect(paraSimMessage(cli, TZ, null)).toEqual({ id: '1', de: 'cliente', tipo: 'texto', texto: 'abre domingo?', hora: '14:01', status: 'lida' })
    expect(paraSimMessage(res, TZ, null)).toEqual({ id: '2', de: 'restaurante', tipo: 'texto', texto: 'Abrimos às 11h30.', hora: '14:01' })
  })
  it('hora segue o relógio simulado', () => {
    const m: MensagemTela = { ...base, id: 1, direcao: 'out', tipo: 'texto', texto: 'x' }
    expect(paraSimMessage(m, TZ, 3600)).toMatchObject({ hora: '15:01' })
  })
  it('lista com os mesmos cortes da Meta (título 24, descrição 72, botão 20)', () => {
    const m: MensagemTela = {
      ...base, id: 3, direcao: 'out', tipo: 'lista', texto: 'Qual unidade?',
      payload: { botao: 'Escolher unidade agora!!', opcoes: [{ id: 'u1', titulo: 'Águas Claras Shopping Park', descricao: 'Rua 1' }] },
    }
    expect(paraSimMessage(m, TZ, null)).toEqual({
      id: '3', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Escolher unidade ago', hora: '14:01',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Águas Claras Shopping Pa', descricao: 'Rua 1' }] }],
    })
  })
  it('localização', () => {
    const m: MensagemTela = { ...base, id: 4, direcao: 'out', tipo: 'localizacao', texto: 'Asa Sul: SCLS 404', payload: { lat: -15.8, lng: -47.9, nome: 'Asa Sul', endereco: 'SCLS 404' } }
    expect(paraSimMessage(m, TZ, null)).toEqual({ id: '4', de: 'restaurante', tipo: 'localizacao', nome: 'Asa Sul', endereco: 'SCLS 404', lat: -15.8, lng: -47.9, hora: '14:01' })
  })
  it('payload quebrado vira o texto gravado (nunca some)', () => {
    const m: MensagemTela = { ...base, id: 5, direcao: 'out', tipo: 'lista', texto: 'Qual unidade?', payload: { botao: 1 } }
    expect(paraSimMessage(m, TZ, null)).toMatchObject({ tipo: 'texto', texto: 'Qual unidade?' })
  })
})

describe('avisoDoEstado', () => {
  it('só avisa fora do atendimento da IA', () => {
    expect(avisoDoEstado('ia')).toBeNull()
    expect(avisoDoEstado('aguardando_humano')).toMatchObject({ de: 'sistema', texto: expect.stringContaining('passada para um atendente') })
    expect(avisoDoEstado('humano')).toMatchObject({ texto: expect.stringContaining('passada para um atendente') })
    expect(avisoDoEstado('encerrada')).toMatchObject({ texto: expect.stringContaining('encerrada') })
  })
})

describe('relógio', () => {
  it('converte data e hora do restaurante em instante e volta', () => {
    const d = instanteDoHorarioLocal('2026-10-11T12:00', TZ)
    expect(d?.toISOString()).toBe('2026-10-11T15:00:00.000Z')
    expect(horarioLocal(d!, TZ)).toBe('2026-10-11T12:00')
  })
  it('data inexistente ou formato errado: null', () => {
    expect(instanteDoHorarioLocal('2026-02-30T10:00', TZ)).toBeNull()
    expect(instanteDoHorarioLocal('2026-10-11T24:00', TZ)).toBeNull()
    expect(instanteDoHorarioLocal('11/10/2026 12:00', TZ)).toBeNull()
  })
  it('rótulo do relógio simulado', () => {
    const agora = new Date('2026-10-05T17:00:00Z') // segunda 14h em Brasília
    expect(rotuloRelogio(null, TZ, agora)).toBeNull()
    expect(rotuloRelogio(6 * 86_400 - 2 * 3600, TZ, agora)).toBe('Relógio simulado: domingo, 11/10/2026 12:00')
  })
})
```

- [ ] **Step 2: Ver falhar**

Run: `pnpm vitest run --project unit apps/web/lib/simulador-tela.test.ts`
Expected: FAIL. O módulo ainda não existe.

- [ ] **Step 3: Implementar `apps/web/lib/simulador-tela.ts` (sem `server-only`: roda no navegador)**

```ts
import { z } from 'zod'
import { agoraLocal, dataValida, diaDaSemana, partesDaData } from '@atd/core/s1'
import type { SimMessage } from '@/components/simulator/types'

export type MensagemTela = {
  id: number
  direcao: 'in' | 'out'
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'localizacao' | 'lista' | 'outro'
  texto: string | null
  payload: unknown
  criadaEm: string
}
export type RespostaSimulador = {
  conversationId: string
  mensagens: MensagemTela[]
  cursor: number
  digitando: boolean
  estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'
  relogioOffsetSegundos: number | null
}
export type DetalheTela = {
  id: number; etapa: string; modelo: string; promptVersion: string; intent: string | null
  resultado: string; erro: string | null; costUsd: string; latenciaMs: number | null
  itensValidos: number | null; itensRespondidos: number | null; criadaEm: string
}

export const AVISO_SIMULACAO: SimMessage = {
  id: 'aviso-simulacao', de: 'sistema', tipo: 'aviso',
  texto: 'Simulação: as respostas passam pela IA de verdade (com custo) e nunca são enviadas pelo WhatsApp.',
}
/** O relógio simulado vai até um ano para trás ou para a frente. */
export const MAX_DESLOCAMENTO_SEGUNDOS = 366 * 86_400

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const
const dois = (n: number) => String(n).padStart(2, '0')
const hhmm = (minuto: number) => `${dois(Math.floor(minuto / 60))}:${dois(minuto % 60)}`
// mesmos cortes que o cliente da Meta aplica (packages/whatsapp/src/client.ts)
const cortar = (t: string, max: number) => (t.length <= max ? t : t.slice(0, max))

const lista = z.object({
  botao: z.string(),
  opcoes: z.array(z.object({ id: z.string(), titulo: z.string(), descricao: z.string() })).min(1),
})
const localizacao = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })

function horaDe(criadaEm: string, timezone: string, offsetSegundos: number | null) {
  const instante = new Date(Date.parse(criadaEm) + (offsetSegundos ?? 0) * 1000)
  return hhmm(agoraLocal(instante, timezone).minuto)
}

export function paraSimMessage(m: MensagemTela, timezone: string, offsetSegundos: number | null): SimMessage {
  const id = String(m.id)
  const hora = horaDe(m.criadaEm, timezone, offsetSegundos)
  const texto = m.texto ?? ''
  if (m.direcao === 'in') return { id, de: 'cliente', tipo: 'texto', texto, hora, status: 'lida' }
  if (m.tipo === 'lista') {
    const p = lista.safeParse(m.payload)
    if (p.success) {
      return {
        id, de: 'restaurante', tipo: 'lista', texto: cortar(texto, 1024), botao: cortar(p.data.botao, 20), hora,
        secoes: [{
          titulo: 'Unidades',
          itens: p.data.opcoes.slice(0, 10).map((o) => ({ id: o.id, titulo: cortar(o.titulo, 24), descricao: cortar(o.descricao, 72) })),
        }],
      }
    }
  }
  if (m.tipo === 'localizacao') {
    const p = localizacao.safeParse(m.payload)
    if (p.success) return { id, de: 'restaurante', tipo: 'localizacao', ...p.data, hora }
  }
  return { id, de: 'restaurante', tipo: 'texto', texto, hora }
}

export function avisoDoEstado(estado: RespostaSimulador['estado']): SimMessage | null {
  if (estado === 'aguardando_humano' || estado === 'humano') {
    return {
      id: 'aviso-estado', de: 'sistema', tipo: 'aviso',
      texto: 'Esta conversa foi passada para um atendente. No WhatsApp real, a equipe continuaria por aqui. Toque em "Novo cliente" para recomeçar.',
    }
  }
  if (estado === 'encerrada') {
    return { id: 'aviso-estado', de: 'sistema', tipo: 'aviso', texto: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.' }
  }
  return null
}

function diferencaDoFuso(instante: number, timezone: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instante)).map((p) => [p.type, p.value]),
  )
  return Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute)) - instante
}

/** "2026-10-11T12:00" (campo datetime-local) no fuso do restaurante → instante; null se a data não existe. */
export function instanteDoHorarioLocal(local: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number) as [number, number, number, number, number]
  if (!dataValida(ano, mes, dia) || hora > 23 || minuto > 59) return null
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto)
  // duas passadas acertam a diferença do fuso mesmo perto de mudança de horário de verão
  let t = alvo
  for (let i = 0; i < 2; i++) t = alvo - diferencaDoFuso(t, timezone)
  return new Date(t)
}

/** Instante → valor do campo datetime-local, no fuso do restaurante. */
export function horarioLocal(instante: Date, timezone: string): string {
  const { data, minuto } = agoraLocal(instante, timezone)
  return `${data}T${hhmm(minuto)}`
}

export function rotuloRelogio(offsetSegundos: number | null, timezone: string, agora: Date): string | null {
  if (offsetSegundos === null) return null
  const { data, minuto } = agoraLocal(new Date(agora.getTime() + offsetSegundos * 1000), timezone)
  const { ano, mes, dia } = partesDaData(data)
  return `Relógio simulado: ${DIAS[diaDaSemana(data)]}, ${dois(dia)}/${dois(mes)}/${ano} ${hhmm(minuto)}`
}
```

`apps/web/lib/schemas/simulador.ts`:
```ts
import { z } from 'zod'

const conversa = z.uuid('Simulação inválida.')
export const enviarSimuladorSchema = z.object({
  conversationId: conversa,
  texto: z.string().trim().min(1, 'Escreva uma mensagem.').max(1000, 'Mensagem muito longa (máximo de 1000 caracteres).'),
  interativoId: z.string().max(200).nullable(),
})
export const buscarSimuladorSchema = z.object({ conversationId: conversa, desdeId: z.number().int().min(0) })
export const relogioSimuladorSchema = z.object({
  conversationId: conversa,
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Informe a data e a hora.').nullable(),
})
export const conversaSimuladorSchema = z.object({ conversationId: conversa })
```

Run: `pnpm vitest run --project unit apps/web/lib/simulador-tela.test.ts`
Expected: PASS.

- [ ] **Step 4: Testes das Server Actions (falham)**

`apps/web/app/(painel)/simulador-actions.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireStaff = vi.fn()
const db = {
  select: () => ({ from: () => ({ where: async () => [{ tz: 'America/Sao_Paulo' }] }) }),
}
const enqueue = vi.fn()
const m = {
  abrirSimulacao: vi.fn(), novoClienteSimulado: vi.fn(), enviarMensagemSimulada: vi.fn(),
  definirRelogioSimulado: vi.fn(), mensagensSimuladas: vi.fn(), detalhesSimulacao: vi.fn(),
}
vi.mock('@/lib/dal', () => ({ requireStaff }))
vi.mock('@/lib/server/db', () => ({ getDb: () => db }))
vi.mock('@/lib/server/boss', () => ({ getBoss: async () => 'boss' }))
vi.mock('@atd/db', async (orig) => ({
  ...m,
  enqueueProcess: () => enqueue,
  schema: (await orig<typeof import('@atd/db')>()).schema,
}))

const a = await import('./simulador-actions')
const CONV = '00000000-0000-4000-8000-000000000001'
const sessao = { userId: 'u1', role: 'dono', restaurantId: 'r1', claims: { sub: 'u1' } }
const vazio = { mensagens: [], cursor: 0, digitando: false, estado: 'ia', relogioOffsetSegundos: null }

describe('Server Actions do simulador', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireStaff.mockResolvedValue(sessao)
    m.mensagensSimuladas.mockResolvedValue(vazio)
  })

  it('toda action exige dono ou gerente', async () => {
    m.abrirSimulacao.mockResolvedValue({ conversationId: CONV })
    m.novoClienteSimulado.mockResolvedValue({ conversationId: CONV })
    m.enviarMensagemSimulada.mockResolvedValue('ok')
    m.definirRelogioSimulado.mockResolvedValue('ok')
    m.detalhesSimulacao.mockResolvedValue([])
    await a.abrirSimuladorAction()
    await a.buscarSimuladorAction(CONV, 0)
    await a.enviarSimuladorAction(CONV, 'oi', null)
    await a.novoClienteSimuladorAction()
    await a.relogioSimuladorAction(CONV, null)
    await a.detalhesSimuladorAction(CONV)
    expect(requireStaff).toHaveBeenCalledTimes(6)
    for (const c of requireStaff.mock.calls) expect(c).toEqual([['dono', 'gerente']])
  })

  it('abrir devolve a conversa com as datas em texto', async () => {
    m.abrirSimulacao.mockResolvedValue({ conversationId: CONV })
    m.mensagensSimuladas.mockResolvedValue({
      ...vazio, cursor: 7,
      mensagens: [{ id: 7, direcao: 'in', tipo: 'texto', texto: 'oi', payload: null, createdAt: new Date('2026-10-05T17:00:00Z') }],
    })
    expect(await a.abrirSimuladorAction()).toEqual({
      ok: true,
      data: {
        conversationId: CONV, cursor: 7, digitando: false, estado: 'ia', relogioOffsetSegundos: null,
        mensagens: [{ id: 7, direcao: 'in', tipo: 'texto', texto: 'oi', payload: null, criadaEm: '2026-10-05T17:00:00.000Z' }],
      },
    })
    expect(m.abrirSimulacao).toHaveBeenCalledWith(db, { restaurantId: 'r1', userId: 'u1' })
  })

  it('enviar: valida, usa a fila do webhook e traduz conversa encerrada', async () => {
    expect(await a.enviarSimuladorAction(CONV, '   ', null)).toEqual({ ok: false, fieldErrors: { texto: 'Escreva uma mensagem.' } })
    expect(await a.enviarSimuladorAction('x', 'oi', null)).toMatchObject({ ok: false })
    expect(m.enviarMensagemSimulada).not.toHaveBeenCalled()
    m.enviarMensagemSimulada.mockResolvedValue('encerrada')
    expect(await a.enviarSimuladorAction(CONV, ' oi ', 'u1')).toEqual({
      ok: false, formError: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.',
    })
    expect(m.enviarMensagemSimulada).toHaveBeenCalledWith(db, { restaurantId: 'r1', userId: 'u1', conversationId: CONV, texto: 'oi', interativoId: 'u1' }, enqueue)
  })

  it('simulação de outra pessoa (ou apagada) não vaza: erro genérico', async () => {
    m.mensagensSimuladas.mockResolvedValue(null)
    expect(await a.buscarSimuladorAction(CONV, 0)).toEqual({
      ok: false, formError: 'Esta simulação não está mais disponível. Toque em "Novo cliente".',
    })
  })

  it('relógio: converte no fuso do restaurante, recusa data inválida e mais de um ano de distância', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T17:00:00Z'), toFake: ['Date'] })
    try {
      m.definirRelogioSimulado.mockResolvedValue('ok')
      expect(await a.relogioSimuladorAction(CONV, '2026-10-11T12:00')).toEqual({ ok: true, data: { relogioOffsetSegundos: 6 * 86_400 - 2 * 3600 } })
      expect(m.definirRelogioSimulado).toHaveBeenLastCalledWith(db, { restaurantId: 'r1', userId: 'u1', conversationId: CONV, offsetSegundos: 6 * 86_400 - 2 * 3600 })
      expect(await a.relogioSimuladorAction(CONV, '2026-02-30T12:00')).toEqual({ ok: false, fieldErrors: { local: 'Essa data não existe.' } })
      expect(await a.relogioSimuladorAction(CONV, '2028-01-01T12:00')).toEqual({
        ok: false, fieldErrors: { local: 'Escolha uma data até um ano antes ou depois de hoje.' },
      })
      expect(await a.relogioSimuladorAction(CONV, null)).toEqual({ ok: true, data: { relogioOffsetSegundos: null } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('detalhes: datas em texto', async () => {
    m.detalhesSimulacao.mockResolvedValue([{
      id: 1, etapa: 'triagem', modelo: 'm', promptVersion: 'v', intent: 'x', resultado: 'ok', erro: null,
      costUsd: '0.000100', latenciaMs: 812, itensValidos: 1, itensRespondidos: 1, createdAt: new Date('2026-10-05T17:00:00Z'),
    }])
    expect(await a.detalhesSimuladorAction(CONV)).toEqual({
      ok: true,
      data: [{ id: 1, etapa: 'triagem', modelo: 'm', promptVersion: 'v', intent: 'x', resultado: 'ok', erro: null, costUsd: '0.000100', latenciaMs: 812, itensValidos: 1, itensRespondidos: 1, criadaEm: '2026-10-05T17:00:00.000Z' }],
    })
  })
})
```

- [ ] **Step 5: Ver falhar**

Run: `pnpm vitest run --project unit "apps/web/app/(painel)/simulador-actions.test.ts"`
Expected: FAIL. O módulo ainda não existe.

- [ ] **Step 6: Implementar `apps/web/app/(painel)/simulador-actions.ts`**

```ts
'use server'
import { eq } from 'drizzle-orm'
import {
  abrirSimulacao, definirRelogioSimulado, detalhesSimulacao, enqueueProcess, enviarMensagemSimulada, mensagensSimuladas,
  novoClienteSimulado, schema, type EstadoSimulacao,
} from '@atd/db'
import { actionErrorFromZod, type ActionResult } from '@/lib/action-result'
import { requireStaff } from '@/lib/dal'
import {
  buscarSimuladorSchema, conversaSimuladorSchema, enviarSimuladorSchema, relogioSimuladorSchema,
} from '@/lib/schemas/simulador'
import { getBoss } from '@/lib/server/boss'
import { getDb } from '@/lib/server/db'
import { instanteDoHorarioLocal, MAX_DESLOCAMENTO_SEGUNDOS, type DetalheTela, type RespostaSimulador } from '@/lib/simulador-tela'

const SUMIU = 'Esta simulação não está mais disponível. Toque em "Novo cliente".'
const ENCERRADA = 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.'
const FUSO_PADRAO = 'America/Sao_Paulo'

type Sessao = Awaited<ReturnType<typeof requireStaff>>
// simulador gasta IA real: só quem responde pelos custos
const sessao = () => requireStaff(['dono', 'gerente'])
const dono = (s: Sessao) => ({ restaurantId: s.restaurantId, userId: s.userId })

function paraTela(conversationId: string, e: EstadoSimulacao): RespostaSimulador {
  return {
    conversationId,
    cursor: e.cursor,
    digitando: e.digitando,
    estado: e.estado,
    relogioOffsetSegundos: e.relogioOffsetSegundos,
    mensagens: e.mensagens.map((m) => ({
      id: m.id, direcao: m.direcao, tipo: m.tipo, texto: m.texto, payload: m.payload, criadaEm: m.createdAt.toISOString(),
    })),
  }
}

async function estado(s: Sessao, conversationId: string, desdeId: number): Promise<ActionResult<RespostaSimulador>> {
  const e = await mensagensSimuladas(getDb(), { ...dono(s), conversationId, desdeId })
  return e ? { ok: true, data: paraTela(conversationId, e) } : { ok: false, formError: SUMIU }
}

export async function abrirSimuladorAction(): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const { conversationId } = await abrirSimulacao(getDb(), dono(s))
  return estado(s, conversationId, 0)
}

export async function buscarSimuladorAction(conversationId: string, desdeId: number): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const p = buscarSimuladorSchema.safeParse({ conversationId, desdeId })
  if (!p.success) return { ok: false, formError: SUMIU }
  return estado(s, p.data.conversationId, p.data.desdeId)
}

export async function enviarSimuladorAction(conversationId: string, texto: string, interativoId: string | null): Promise<ActionResult> {
  const s = await sessao()
  const p = enviarSimuladorSchema.safeParse({ conversationId, texto, interativoId })
  if (!p.success) return actionErrorFromZod(p.error)
  const enqueue = enqueueProcess(await getBoss())
  const r = await enviarMensagemSimulada(getDb(), { ...dono(s), ...p.data }, enqueue)
  if (r === 'nao_encontrada') return { ok: false, formError: SUMIU }
  if (r === 'encerrada') return { ok: false, formError: ENCERRADA }
  return { ok: true }
}

export async function novoClienteSimuladorAction(): Promise<ActionResult<RespostaSimulador>> {
  const s = await sessao()
  const { conversationId } = await novoClienteSimulado(getDb(), dono(s))
  return estado(s, conversationId, 0)
}

export async function relogioSimuladorAction(
  conversationId: string,
  local: string | null,
): Promise<ActionResult<{ relogioOffsetSegundos: number | null }>> {
  const s = await sessao()
  const p = relogioSimuladorSchema.safeParse({ conversationId, local })
  if (!p.success) return actionErrorFromZod(p.error)
  const db = getDb()
  let offset: number | null = null
  if (p.data.local !== null) {
    const [r] = await db.select({ tz: schema.restaurants.timezone }).from(schema.restaurants).where(eq(schema.restaurants.id, s.restaurantId))
    const instante = instanteDoHorarioLocal(p.data.local, r?.tz ?? FUSO_PADRAO)
    if (!instante) return { ok: false, fieldErrors: { local: 'Essa data não existe.' } }
    offset = Math.round((instante.getTime() - Date.now()) / 1000)
    if (Math.abs(offset) > MAX_DESLOCAMENTO_SEGUNDOS) {
      return { ok: false, fieldErrors: { local: 'Escolha uma data até um ano antes ou depois de hoje.' } }
    }
  }
  const r = await definirRelogioSimulado(db, { ...dono(s), conversationId: p.data.conversationId, offsetSegundos: offset })
  return r === 'ok' ? { ok: true, data: { relogioOffsetSegundos: offset } } : { ok: false, formError: SUMIU }
}

export async function detalhesSimuladorAction(conversationId: string): Promise<ActionResult<DetalheTela[]>> {
  const s = await sessao()
  const p = conversaSimuladorSchema.safeParse({ conversationId })
  if (!p.success) return { ok: false, formError: SUMIU }
  const d = await detalhesSimulacao(getDb(), s.claims, { ...dono(s), conversationId: p.data.conversationId })
  if (!d) return { ok: false, formError: SUMIU }
  return {
    ok: true,
    data: d.map((x) => ({
      id: x.id, etapa: x.etapa, modelo: x.modelo, promptVersion: x.promptVersion, intent: x.intent, resultado: x.resultado,
      erro: x.erro, costUsd: x.costUsd, latenciaMs: x.latenciaMs, itensValidos: x.itensValidos,
      itensRespondidos: x.itensRespondidos, criadaEm: x.createdAt.toISOString(),
    })),
  }
}
```
O teste de `relogioSimuladorAction` usa `toFake: ['Date']` porque a ação lê `Date.now()`.

Run: `pnpm vitest run --project unit "apps/web/app/(painel)/simulador-actions.test.ts" apps/web/lib/simulador-tela.test.ts`
Expected: PASS.

- [ ] **Step 7: Teste do simulador na tela (reescrever `launcher.test.tsx`; falha)**

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { MensagemTela, RespostaSimulador } from '@/lib/simulador-tela'
import { SimulatorLauncher } from './launcher'
import type { AcoesSimulador } from './use-simulador'

const CONV = '00000000-0000-4000-8000-000000000001'
const resp = (mensagens: MensagemTela[] = [], extra: Partial<RespostaSimulador> = {}): RespostaSimulador =>
  ({ conversationId: CONV, mensagens, cursor: mensagens.at(-1)?.id ?? 0, digitando: false, estado: 'ia', relogioOffsetSegundos: null, ...extra })
const msg = (id: number, direcao: 'in' | 'out', texto: string): MensagemTela =>
  ({ id, direcao, tipo: 'texto', texto, payload: null, criadaEm: '2026-10-05T17:00:00.000Z' })

function acoesFalsas(over: Partial<AcoesSimulador> = {}): AcoesSimulador {
  return {
    abrir: vi.fn(async () => ({ ok: true as const, data: resp() })),
    buscar: vi.fn(async () => ({ ok: true as const, data: resp() })),
    enviar: vi.fn(async () => ({ ok: true as const })),
    novoCliente: vi.fn(async () => ({ ok: true as const, data: resp([], { conversationId: '00000000-0000-4000-8000-000000000002' }) })),
    relogio: vi.fn(async () => ({ ok: true as const, data: { relogioOffsetSegundos: null } })),
    detalhes: vi.fn(async () => ({ ok: true as const, data: [] })),
    ...over,
  }
}

async function abrir(acoes: AcoesSimulador) {
  const user = userEvent.setup()
  render(<SimulatorLauncher restaurante="Casa Teste" timezone="America/Sao_Paulo" acoes={acoes} />)
  await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
  await screen.findByRole('dialog', { name: 'Simulador de WhatsApp' }, { timeout: 5000 })
  return user
}

describe('SimulatorLauncher', () => {
  // O diálogo vem por next/dynamic; pré-carregar o chunk evita que a 1ª importação no jsdom estoure o tempo sob carga.
  beforeAll(async () => {
    await import('./simulator-dialog')
  })

  it('abre com foco no campo de mensagem, avisa que é simulação e fecha com Esc', async () => {
    const acoes = acoesFalsas()
    const user = await abrir(acoes)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus())
    expect(screen.getByText(/nunca são enviadas pelo WhatsApp/)).toBeInTheDocument()
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalledTimes(1))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveFocus())
  })

  it('mensagem vai ao servidor e a resposta gravada pelo pipeline aparece no polling', async () => {
    let n = 0
    const acoes = acoesFalsas({
      buscar: vi.fn(async () => ({ ok: true as const, data: n++ < 1 ? resp() : resp([msg(1, 'in', 'abre domingo?'), msg(2, 'out', 'Domingo (11/10), a unidade Asa Sul abre das 11h30 às 16h.')]) })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'abre domingo?{Enter}')
    expect(acoes.enviar).toHaveBeenCalledWith(CONV, 'abre domingo?', null)
    expect(await screen.findByText(/abre das 11h30 às 16h/, undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(within(screen.getByRole('log')).getAllByText('abre domingo?')).toHaveLength(1) // balão "enviando" substituído
  })

  it('erro ao enviar aparece e o balão provisório some', async () => {
    const acoes = acoesFalsas({
      enviar: vi.fn(async () => ({ ok: false as const, formError: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.' })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'oi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta conversa foi encerrada')
    expect(within(screen.getByRole('log')).queryByText('oi')).toBeNull()
  })

  it('Novo cliente recomeça a conversa', async () => {
    const acoes = acoesFalsas({ abrir: vi.fn(async () => ({ ok: true as const, data: resp([msg(1, 'in', 'conversa antiga')]) })) })
    const user = await abrir(acoes)
    expect(await screen.findByText('conversa antiga')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Novo cliente' }))
    await waitFor(() => expect(screen.queryByText('conversa antiga')).toBeNull())
    expect(acoes.novoCliente).toHaveBeenCalledTimes(1)
  })

  it('Simular data e hora aplica e volta ao relógio real', async () => {
    const acoes = acoesFalsas()
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Simular data e hora' }))
    const campo = screen.getByLabelText('Data e hora simuladas')
    await user.clear(campo)
    await user.type(campo, '2026-10-11T12:00')
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(acoes.relogio).toHaveBeenCalledWith(CONV, '2026-10-11T12:00')
    await user.click(screen.getByRole('button', { name: 'Usar relógio real' }))
    expect(acoes.relogio).toHaveBeenLastCalledWith(CONV, null)
  })

  it('Ver detalhes lista as chamadas da IA desta conversa', async () => {
    const acoes = acoesFalsas({
      detalhes: vi.fn(async () => ({
        ok: true as const,
        data: [{ id: 1, etapa: 'triagem', modelo: 'fake/m', promptVersion: 'triage-v2', intent: 'horario_unidades:aberto_agora', resultado: 'ok', erro: null, costUsd: '0.000100', latenciaMs: 812, itensValidos: 2, itensRespondidos: 1, criadaEm: '2026-10-05T17:00:00.000Z' }],
      })),
    })
    const user = await abrir(acoes)
    await waitFor(() => expect(acoes.abrir).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Ver detalhes' }))
    const painel = await screen.findByRole('region', { name: 'Detalhes da IA' })
    expect(await within(painel).findByText(/horario_unidades:aberto_agora/)).toBeInTheDocument()
    expect(within(painel).getByText(/US\$ 0,000100/)).toBeInTheDocument()
    expect(within(painel).getByText(/812 ms/)).toBeInTheDocument()
    expect(within(painel).getByText('Respondeu 1 de 2 perguntas com dado cadastrado')).toBeInTheDocument()
  })
})
```

Run: `pnpm vitest run --project ui apps/web/components/simulator`
Expected: FAIL. `use-simulador` e `controles` não existem, e o launcher ainda usa o simulador local.

- [ ] **Step 8: Hook `apps/web/components/simulator/use-simulador.ts`**

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionResult } from '@/lib/action-result'
import {
  AVISO_SIMULACAO, avisoDoEstado, paraSimMessage, rotuloRelogio,
  type DetalheTela, type MensagemTela, type RespostaSimulador,
} from '@/lib/simulador-tela'
import type { SimMessage } from './types'

export type AcoesSimulador = {
  abrir: () => Promise<ActionResult<RespostaSimulador>>
  buscar: (conversationId: string, desdeId: number) => Promise<ActionResult<RespostaSimulador>>
  enviar: (conversationId: string, texto: string, interativoId: string | null) => Promise<ActionResult>
  novoCliente: () => Promise<ActionResult<RespostaSimulador>>
  relogio: (conversationId: string, local: string | null) => Promise<ActionResult<{ relogioOffsetSegundos: number | null }>>
  detalhes: (conversationId: string) => Promise<ActionResult<DetalheTela[]>>
}

const INTERVALO_MS = 1000
const ERRO_GERAL = 'Não foi possível falar com o simulador. Tente de novo.'
const erroDe = (r: { formError?: string; fieldErrors?: Record<string, string> }) =>
  r.formError ?? Object.values(r.fieldErrors ?? {})[0] ?? ERRO_GERAL

export function useSimulador(acoes: AcoesSimulador, aberto: boolean, timezone: string) {
  const [servidor, setServidor] = useState<MensagemTela[]>([])
  const [otimistas, setOtimistas] = useState<SimMessage[]>([])
  const [estado, setEstado] = useState<RespostaSimulador['estado']>('ia')
  const [digitando, setDigitando] = useState(false)
  const [offset, setOffset] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<DetalheTela[] | null>(null)
  const conversa = useRef<string | null>(null)
  const cursor = useRef(0)

  const aplicar = useCallback((r: RespostaSimulador, recomecar: boolean) => {
    if (recomecar) {
      conversa.current = r.conversationId
      setOtimistas([])
    }
    cursor.current = r.cursor
    setServidor((atual) => {
      // o cursor pode voltar até uma resposta pendente: junta por id, sem duplicar
      const porId = new Map((recomecar ? [] : atual).map((m) => [m.id, m]))
      for (const m of r.mensagens) porId.set(m.id, m)
      return [...porId.values()].sort((a, b) => a.id - b.id)
    })
    if (r.mensagens.some((m) => m.direcao === 'in')) setOtimistas([])
    setEstado(r.estado)
    setDigitando(r.digitando)
    setOffset(r.relogioOffsetSegundos)
  }, [])

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    let ocupado = false
    const tick = async () => {
      if (ocupado) return
      ocupado = true
      const c = conversa.current
      try {
        const r = c ? await acoes.buscar(c, cursor.current) : await acoes.abrir()
        // resposta atrasada de uma conversa que já foi trocada por "Novo cliente": descarta
        if (!vivo || conversa.current !== c) return
        if (r.ok && r.data) {
          aplicar(r.data, c === null)
          setErro(null)
        } else if (!r.ok) setErro(erroDe(r))
      } catch {
        if (vivo) setErro(ERRO_GERAL)
      } finally {
        ocupado = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), INTERVALO_MS)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [aberto, acoes, aplicar])

  const enviar = useCallback(async (texto: string, interativoId: string | null) => {
    const c = conversa.current
    if (!c) return
    const id = `tmp-${crypto.randomUUID()}`
    const hora = paraSimMessage({ id: 0, direcao: 'in', tipo: 'texto', texto, payload: null, criadaEm: new Date().toISOString() }, timezone, offset)
    setOtimistas((os) => [...os, { ...hora, id, status: 'enviando' } as SimMessage])
    const desfazer = (mensagem: string) => {
      setOtimistas((os) => os.filter((o) => o.id !== id))
      setErro(mensagem)
    }
    try {
      const r = await acoes.enviar(c, texto, interativoId)
      if (!r.ok) desfazer(erroDe(r))
    } catch {
      desfazer(ERRO_GERAL)
    }
  }, [acoes, timezone, offset])

  const novoCliente = useCallback(async () => {
    try {
      const r = await acoes.novoCliente()
      if (r.ok && r.data) {
        aplicar(r.data, true)
        setDetalhes(null)
        setErro(null)
      } else if (!r.ok) setErro(erroDe(r))
    } catch {
      setErro(ERRO_GERAL)
    }
  }, [acoes, aplicar])

  /** Devolve a mensagem de erro do campo, ou null se aplicou. */
  const mudarRelogio = useCallback(async (local: string | null): Promise<string | null> => {
    const c = conversa.current
    if (!c) return ERRO_GERAL
    try {
      const r = await acoes.relogio(c, local)
      if (!r.ok) return erroDe(r)
      setOffset(r.data?.relogioOffsetSegundos ?? null)
      return null
    } catch {
      return ERRO_GERAL
    }
  }, [acoes])

  const verDetalhes = useCallback(async () => {
    const c = conversa.current
    if (!c) return
    setDetalhes(null)
    try {
      const r = await acoes.detalhes(c)
      if (r.ok) setDetalhes(r.data ?? [])
      else setErro(erroDe(r))
    } catch {
      setErro(ERRO_GERAL)
    }
  }, [acoes])

  const aviso = avisoDoEstado(estado)
  const mensagens: SimMessage[] = [
    AVISO_SIMULACAO,
    ...servidor.map((m) => paraSimMessage(m, timezone, offset)),
    ...otimistas,
    ...(aviso ? [aviso] : []),
  ]
  return {
    mensagens,
    digitando: digitando || otimistas.length > 0,
    erro,
    relogio: rotuloRelogio(offset, timezone, new Date()),
    offset,
    detalhes,
    enviar: (texto: string) => void enviar(texto, null),
    escolher: (_mensagemId: string, itemId: string, titulo: string) => void enviar(titulo, itemId),
    novoCliente,
    mudarRelogio,
    verDetalhes,
  }
}
```

- [ ] **Step 9: Controles `apps/web/components/simulator/controles.tsx`**

```tsx
'use client'
import { Clock, Info, UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { horarioLocal, type DetalheTela } from '@/lib/simulador-tela'

const usd = (v: string) => `US$ ${v.replace('.', ',')}`

export function SimuladorControles(props: {
  timezone: string
  offset: number | null
  relogio: string | null
  erro: string | null
  detalhes: DetalheTela[] | null
  onNovoCliente: () => void
  onRelogio: (local: string | null) => Promise<string | null>
  onDetalhes: () => void
}) {
  const [painel, setPainel] = useState<'relogio' | 'detalhes' | null>(null)
  const [local, setLocal] = useState('')
  const [erroRelogio, setErroRelogio] = useState<string | null>(null)
  const campoId = useId()
  const erroId = useId()

  function alternar(p: 'relogio' | 'detalhes') {
    const abrindo = painel !== p
    setPainel(abrindo ? p : null)
    if (abrindo && p === 'relogio') {
      setLocal(horarioLocal(new Date(Date.now() + (props.offset ?? 0) * 1000), props.timezone))
      setErroRelogio(null)
    }
    if (abrindo && p === 'detalhes') props.onDetalhes()
  }

  async function aplicar(valor: string | null) {
    const erro = await props.onRelogio(valor)
    setErroRelogio(erro)
    if (!erro) setPainel(null)
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 bg-background p-2 pr-14 text-sm text-foreground md:absolute md:right-full md:top-0 md:mr-4 md:w-64 md:rounded-xl md:p-3 md:pr-3 md:shadow-xl">
      <div className="flex flex-wrap gap-2 md:flex-col">
        <Button type="button" variant="outline" onClick={props.onNovoCliente}>
          <UserPlus aria-hidden="true" /> Novo cliente
        </Button>
        <Button type="button" variant="outline" aria-expanded={painel === 'relogio'} onClick={() => alternar('relogio')}>
          <Clock aria-hidden="true" /> Simular data e hora
        </Button>
        <Button type="button" variant="outline" aria-expanded={painel === 'detalhes'} onClick={() => alternar('detalhes')}>
          <Info aria-hidden="true" /> Ver detalhes
        </Button>
      </div>
      {props.relogio && <p className="text-xs text-muted-foreground">{props.relogio}</p>}
      {props.erro && <p role="alert" className="text-xs text-destructive">{props.erro}</p>}

      {painel === 'relogio' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => { e.preventDefault(); void aplicar(local) }}
        >
          <label htmlFor={campoId} className="text-xs font-medium">Data e hora simuladas</label>
          <input
            id={campoId}
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            aria-invalid={erroRelogio ? true : undefined}
            aria-describedby={erroRelogio ? erroId : undefined}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
          {erroRelogio && <p id={erroId} role="alert" className="text-xs text-destructive">{erroRelogio}</p>}
          <p className="text-xs text-muted-foreground">Vale só para esta simulação: muda o "aberto agora" e os horários do dia.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Aplicar</Button>
            <Button type="button" variant="ghost" onClick={() => void aplicar(null)}>Usar relógio real</Button>
          </div>
        </form>
      )}

      {painel === 'detalhes' && (
        <section aria-label="Detalhes da IA" className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {props.detalhes === null && <p role="status" className="text-xs text-muted-foreground">Carregando…</p>}
          {props.detalhes?.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma chamada da IA nesta conversa ainda.</p>}
          {props.detalhes && props.detalhes.length > 0 && (
            <ul className="flex flex-col gap-2">
              {props.detalhes.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-2 text-xs">
                  <p className="font-medium">{d.etapa} · {d.intent ?? '—'}</p>
                  <p className="text-muted-foreground">{d.modelo} · {usd(d.costUsd)}{d.latenciaMs !== null ? ` · ${d.latenciaMs} ms` : ''}</p>
                  {d.itensValidos !== null && (
                    <p>Respondeu {d.itensRespondidos ?? 0} de {d.itensValidos} perguntas com dado cadastrado</p>
                  )}
                  {d.erro && <p className="text-destructive">{d.erro}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Cada mensagem simulada usa a IA de verdade e entra no limite de gastos.</p>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 10: Ligar diálogo, moldura, launcher e layout**

`simulator-dialog.tsx`:
- acrescentar a prop `controles: React.ReactNode`;
- na `DialogContent`, trocar `h-dvh max-h-dvh` por `flex h-dvh max-h-dvh flex-col` e manter o resto das classes;
- renderizar `{props.controles}` **antes** do `<PhoneFrame>`;
- trocar o texto da `DialogDescription` por `Converse como se fosse um cliente. As respostas passam pela IA de verdade e nunca são enviadas pelo WhatsApp.`

`phone-frame.tsx`: na `div` raiz, trocar `h-dvh w-full` por `min-h-0 w-full flex-1 md:flex-none`. Assim, no celular, a moldura ocupa o espaço que sobra abaixo dos controles; do `md` em diante, a altura continua a mesma.

`launcher.tsx`:
```tsx
'use client'
import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { SimuladorControles } from './controles'
import { useSimulador, type AcoesSimulador } from './use-simulador'
import { WA } from './colors'
import { WhatsAppIcon } from './whatsapp-icon'

// (o bloco `const SimulatorDialog = dynamic(...)` continua igual)

export function SimulatorLauncher({ restaurante, timezone, acoes }: { restaurante: string; timezone: string; acoes: AcoesSimulador }) {
  const [aberto, setAberto] = useState(false)
  const [jaAbriu, setJaAbriu] = useState(false)
  const fab = useRef<HTMLButtonElement>(null)
  const sim = useSimulador(acoes, aberto, timezone)
  return (
    <>
      {/* botão flutuante: igual ao atual */}
      {jaAbriu && (
        <SimulatorDialog
          aberto={aberto}
          onAbertoChange={setAberto}
          restaurante={restaurante}
          mensagens={sim.mensagens}
          digitando={sim.digitando}
          onEnviar={sim.enviar}
          onFechado={() => fab.current?.focus()}
          onEscolher={sim.escolher}
          controles={
            <SimuladorControles
              timezone={timezone}
              offset={sim.offset}
              relogio={sim.relogio}
              erro={sim.erro}
              detalhes={sim.detalhes}
              onNovoCliente={() => void sim.novoCliente()}
              onRelogio={sim.mudarRelogio}
              onDetalhes={() => void sim.verDetalhes()}
            />
          }
        />
      )}
    </>
  )
}
```

`apps/web/app/(painel)/layout.tsx`:
```tsx
import { getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { AppShell } from '@/components/shell/app-shell'
import { SimulatorLauncher } from '@/components/simulator/launcher'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'
import {
  abrirSimuladorAction, buscarSimuladorAction, detalhesSimuladorAction, enviarSimuladorAction, novoClienteSimuladorAction,
  relogioSimuladorAction,
} from './simulador-actions'

const acoes = {
  abrir: abrirSimuladorAction,
  buscar: buscarSimuladorAction,
  enviar: enviarSimuladorAction,
  novoCliente: novoClienteSimuladorAction,
  relogio: relogioSimuladorAction,
  detalhes: detalhesSimuladorAction,
}

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff()
  const db = getDb()
  const [r] = await db.select({ nome: schema.restaurants.nome, timezone: schema.restaurants.timezone }).from(schema.restaurants)
    .where(eq(schema.restaurants.id, await getSingleRestaurantId(db)))
  // simulador gasta IA real: só dono e gerente
  const simulador = session.role === 'atendente'
    ? null
    : <SimulatorLauncher restaurante={r?.nome ?? 'Restaurante'} timezone={r?.timezone ?? 'America/Sao_Paulo'} acoes={acoes} />
  return <AppShell floating={simulador}>{children}</AppShell>
}
```
Apagar `apps/web/components/simulator/use-local-simulator.ts` e rodar `grep -rn "use-local-simulator\|useLocalSimulator" apps/web`. A saída deve vir vazia.

- [ ] **Step 11: Rodar**

Run: `pnpm vitest run --project ui apps/web/components && pnpm vitest run --project unit apps/web && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`
Expected: PASS. Os testes de `whatsapp-chat.test.tsx` não mudam e o `a11y.test.tsx` continua verde.

- [ ] **Step 12: Conferir no navegador (celular e desktop)**

Com o worker rodando (`pnpm --filter @atd/worker dev`) e o `pnpm dev`, entre como dono e abra o simulador:
- em 390×844, os três botões ficam no topo, sem cobrir o "Fechar", e o campo de mensagem continua visível;
- em 1280×800, os controles ficam à esquerda do celular;
- "abre domingo?" responde em ~5 s;
- "Simular data e hora" em domingo 12:00, seguido de "está aberto agora?", responde "aberta".

Registre o resultado no relatório. Sem `OPENROUTER_API_KEY` com crédito, só a parte visual pode ser conferida; anote isso.

- [ ] **Step 13: Commit**

```bash
git add apps/web/lib/schemas/simulador.ts apps/web/lib/simulador-tela.ts apps/web/lib/simulador-tela.test.ts "apps/web/app/(painel)/simulador-actions.ts" "apps/web/app/(painel)/simulador-actions.test.ts" "apps/web/app/(painel)/layout.tsx" apps/web/components/simulator
git commit -m "Liga o simulador do painel ao pipeline real com novo cliente, relógio simulado e detalhes da IA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: E2E do 02-C — OpenRouter falso, worker real e dono com MFA

**Files:**
- Modify: `packages/ai/src/openrouter.ts` (`baseUrl`), `packages/ai/src/openrouter.test.ts`
- Modify: `packages/config/src/env.ts` (`OPENROUTER_BASE_URL` opcional), `packages/config/src/env.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/web/playwright.config.ts` (`testMatch`)
- Create: `apps/web/e2e/totp.ts`, `apps/web/e2e/totp.test.ts`, `apps/web/e2e/openrouter-falso.ts`, `apps/web/e2e/worker.ts`, `apps/web/e2e/s1.spec.ts`
- Modify: `apps/web/e2e/helpers.ts` (`criarMembro` aceita `gerente`; `entrarComoGestor`), `apps/web/e2e/painel.spec.ts` (atendente não vê o simulador)

**Interfaces:**
- Consumes: telas das Tasks 6–11 (rótulos exatos: "Nova unidade", "Nome da unidade", "Endereço", "Salvar unidade", fieldset "Segunda-feira", "Adicionar turno", "Abre", "Fecha", "Copiar segunda para todos os dias", "Salvar horários", selo "Aberta agora", "Responder: <tema>", "Resposta", "Salvar resposta"); simulador da Task 13 ("Novo cliente", "Simular data e hora", "Data e hora simuladas", "Aplicar"); worker que loga `worker iniciado`; tela `/mfa` (segredo em `p.font-mono`, campo "Código de 6 dígitos", botão "Confirmar").
- Produces: `createOpenRouterClient({ ..., baseUrl?: string })`; env `OPENROUTER_BASE_URL` (opcional, só para teste); `codigoTotp(segredo, agoraMs?)`; `iniciarOpenRouterFalso(responder)`; `iniciarWorkerE2e(env)`; `entrarComoGestor(page, papel?)`.

**Regras desta tarefa:**
- O e2e **nunca** usa IA paga. O worker do teste aponta para um servidor local que responde a triagem por regras fixas. O servidor também confere `provider: { data_collection: 'deny', zdr: true }` e recusa a chamada sem isso.
- Antes de subir o worker do teste, o spec confere se já há outro worker rodando no mesmo banco (heartbeat com menos de 90 s). Se houver, para com uma mensagem clara: esse outro worker pegaria os jobs e chamaria a IA de verdade.
- A simulação não gera lacuna. Por isso a lacuna do teste "responder pergunta" é inserida por SQL, como se tivesse vindo de um cliente real.
- Os nomes usados no teste levam `E2E` e um sufixo único, e o `afterAll` apaga o que o spec criou.

- [ ] **Step 1: `baseUrl` no cliente do OpenRouter e a variável de ambiente (testes primeiro)**

Em `packages/ai/src/openrouter.test.ts`, dentro do `describe`:
```ts
  it('baseUrl troca o servidor (e2e com OpenRouter falso), sem barra duplicada', async () => {
    const f = vi.fn(async () => json(200, okBody('{"a":1}')))
    await createOpenRouterClient({ apiKey: 'KEY', appTitle: 'A', fetch: f, baseUrl: 'http://127.0.0.1:9999/' }).completeJson({
      models: ['m'], system: 's', user: 'u', schemaName: 'x',
      jsonSchema: { type: 'object' }, parse: (raw) => raw, maxTokens: 5,
    })
    expect((f.mock.calls[0]! as unknown as [string])[0]).toBe('http://127.0.0.1:9999/chat/completions')
  })
```
Em `packages/config/src/env.test.ts`, logo abaixo de `const key32 = …`, crie a constante com o mesmo objeto de env válido usado no primeiro teste, e use-a nele:
```ts
const valida = {
  DATABASE_URL: 'postgresql://u:p@localhost:54322/postgres',
  PHONE_ENC_KEY: key32,
  WA_ID_PEPPER: key32,
  WHATSAPP_APP_SECRET: 'segredo',
  WHATSAPP_VERIFY_TOKEN: 'verifica',
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  OPENROUTER_API_KEY: 'sk-or-x',
  AI_TRIAGE_MODELS: 'a/modelo-1, b/modelo-2',
}
```
Depois, dentro do `describe('loadEnv')`:
```ts
  it('OPENROUTER_BASE_URL é opcional e precisa ser URL http(s)', () => {
    expect(loadEnv(workerEnvSchema, valida).OPENROUTER_BASE_URL).toBeUndefined()
    expect(loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'http://127.0.0.1:4010' }).OPENROUTER_BASE_URL).toBe('http://127.0.0.1:4010')
    expect(() => loadEnv(workerEnvSchema, { ...valida, OPENROUTER_BASE_URL: 'ftp://x' })).toThrow('OPENROUTER_BASE_URL')
  })
```
Run: `pnpm vitest run --project unit packages/ai/src/openrouter.test.ts packages/config/src/env.test.ts`
Expected: FAIL.

Implementação:
- `packages/ai/src/openrouter.ts`: no tipo de `cfg`, acrescentar `/** Só para teste (OpenRouter falso do e2e). */ baseUrl?: string`; antes do `return`, `const endpoint = \`${(cfg.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '')}/chat/completions\``; e usar `doFetch(endpoint, …)`.
- `packages/config/src/env.ts`, em `openrouterEnvSchema`:
```ts
  /** Só para teste (e2e com OpenRouter falso). Em produção fica vazio. */
  OPENROUTER_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
```
- `apps/worker/src/main.ts`:
```ts
    llm: createOpenRouterClient({
      apiKey: env.OPENROUTER_API_KEY,
      appTitle: 'ia-atendimento',
      ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
    }),
```
Run: `pnpm vitest run --project unit packages/ai packages/config && pnpm --filter @atd/worker typecheck`
Expected: PASS.

- [ ] **Step 2: TOTP do e2e (teste com os vetores da RFC 6238)**

`apps/web/playwright.config.ts`: acrescentar `testMatch: '**/*.spec.ts',` logo depois de `testDir`. Assim o Playwright não pega `*.test.ts`, que roda no Vitest.

`apps/web/e2e/totp.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { codigoTotp } from './totp'

// RFC 6238, apêndice B (SHA-1, segredo ASCII "12345678901234567890"), últimos 6 dígitos
const SEGREDO = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('codigoTotp', () => {
  it('confere com os vetores da RFC', () => {
    expect(codigoTotp(SEGREDO, 59_000)).toBe('287082')
    expect(codigoTotp(SEGREDO, 1_111_111_109_000)).toBe('081804')
    expect(codigoTotp(SEGREDO, 1_234_567_890_000)).toBe('005924')
  })
  it('ignora espaços e minúsculas; segredo inválido falha', () => {
    expect(codigoTotp(SEGREDO.toLowerCase().replace(/(.{4})/g, '$1 '), 59_000)).toBe('287082')
    expect(() => codigoTotp('1!', 0)).toThrow('segredo TOTP inválido')
  })
})
```
`apps/web/e2e/totp.ts`:
```ts
import { createHmac } from 'node:crypto'

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(segredo: string): Buffer {
  let bits = 0
  let valor = 0
  const bytes: number[] = []
  for (const c of segredo.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase()) {
    const i = ALFABETO.indexOf(c)
    if (i < 0) throw new Error('segredo TOTP inválido')
    valor = ((valor << 5) | i) & 0xffff
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** RFC 6238 (SHA-1, 30 s, 6 dígitos): o mesmo cálculo do app autenticador. */
export function codigoTotp(segredo: string, agoraMs = Date.now()): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(Math.floor(agoraMs / 30_000)))
  const h = createHmac('sha1', base32(segredo)).update(contador).digest()
  const o = h[h.length - 1]! & 0x0f
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!
  return String(n % 1_000_000).padStart(6, '0')
}
```
Run: `pnpm vitest run --project unit apps/web/e2e/totp.test.ts`
Expected: PASS (escreva o teste primeiro e veja falhar pela ausência do módulo).

- [ ] **Step 3: Login de dono/gerente com MFA real**

Em `apps/web/e2e/helpers.ts`:
- `criarMembro(papel: 'dono' | 'gerente' | 'atendente')`;
- acrescentar:
```ts
import { expect, type Page } from '@playwright/test'
import { codigoTotp } from './totp'

/** Dono/gerente novo: entra, cadastra o autenticador lendo a chave da tela e confirma com o código TOTP. */
export async function entrarComoGestor(page: Page, papel: 'dono' | 'gerente' = 'dono') {
  const membro = await criarMembro(papel)
  await entrar(page, membro.email, membro.senha)
  await page.waitForURL('**/mfa')
  const segredo = (await page.locator('p.font-mono').textContent())?.trim() ?? ''
  // código perto de virar: espera o próximo período para não falhar na fronteira
  const restante = 30_000 - (Date.now() % 30_000)
  if (restante < 3_000) await page.waitForTimeout(restante + 200)
  await page.getByLabel(/^Código de 6 dígitos/).fill(codigoTotp(segredo))
  await page.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  return membro
}
```
(Troque o `import type { Page }` existente pelo import acima.)

Em `apps/web/e2e/painel.spec.ts`, substituir o teste `'simulador abre em tela cheia no celular e mostra a mensagem enviada'` por:
```ts
test('atendente não vê o simulador (ele gasta IA real)', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await expect(page.getByRole('heading', { level: 1, name: 'Início' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir simulador de WhatsApp' })).toHaveCount(0)
})
```

- [ ] **Step 4: OpenRouter falso e worker do e2e**

`apps/web/e2e/openrouter-falso.ts`:
```ts
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type TriagemFalsa = {
  itens: { servico: string; tipo: string | null; unidade: string | null; data: string | null; tema: string | null }[]
  fora_escopo: boolean
}

/** Servidor local no formato do OpenRouter: responde a triagem por regras fixas e nunca cobra. */
export async function iniciarOpenRouterFalso(responder: (mensagem: string) => TriagemFalsa) {
  const chamadas: string[] = []
  const servidor = createServer((req, res) => {
    let corpo = ''
    req.on('data', (c: Buffer) => { corpo += c.toString() })
    req.on('end', () => {
      const responderJson = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      if (req.method !== 'POST' || req.url !== '/chat/completions') return responderJson(404, { error: { message: 'rota desconhecida' } })
      const body = JSON.parse(corpo) as {
        messages: { role: string; content: string }[]
        provider?: { data_collection?: string; zdr?: boolean }
      }
      // a política de dados da LGPD também é conferida aqui
      if (body.provider?.data_collection !== 'deny' || body.provider?.zdr !== true) {
        return responderJson(400, { error: { message: 'chamada sem data_collection deny + zdr' } })
      }
      const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
      const mensagem = /<mensagem_cliente>\n([\s\S]*)\n<\/mensagem_cliente>/.exec(user)?.[1] ?? user
      chamadas.push(mensagem)
      return responderJson(200, {
        model: 'e2e/falso',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(responder(mensagem)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 },
      })
    })
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  const { port } = servidor.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    chamadas,
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  }
}
```

`apps/web/e2e/worker.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getSql } from './helpers'

const PASTA_WORKER = fileURLToPath(new URL('../../worker/', import.meta.url))
const chave = () => randomBytes(32).toString('base64')

/** Sobe o worker de verdade apontando para o OpenRouter falso. Para com erro se já houver outro worker no banco. */
export async function iniciarWorkerE2e(openrouterUrl: string): Promise<ChildProcess> {
  if (!existsSync(`${PASTA_WORKER}src/main.ts`)) throw new Error(`worker não encontrado em ${PASTA_WORKER}`)
  const outros = await getSql()`select worker_id from worker_heartbeats where last_seen_at > now() - interval '90 seconds'`
  if (outros.length > 0) {
    throw new Error('Há um worker rodando neste banco. Pare o "pnpm --filter @atd/worker dev" antes do e2e: ele chamaria a IA de verdade.')
  }
  const env = process.env
  const filho = spawn(process.execPath, ['src/main.ts'], {
    cwd: PASTA_WORKER,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      DATABASE_URL: env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      PHONE_ENC_KEY: env.PHONE_ENC_KEY ?? chave(),
      WA_ID_PEPPER: env.WA_ID_PEPPER ?? chave(),
      WHATSAPP_APP_SECRET: env.WHATSAPP_APP_SECRET ?? 'e2e',
      WHATSAPP_VERIFY_TOKEN: env.WHATSAPP_VERIFY_TOKEN ?? 'e2e',
      WHATSAPP_ACCESS_TOKEN: 'e2e', // simulação nunca chama a Meta; token inválido de propósito
      WHATSAPP_PHONE_NUMBER_ID: env.WHATSAPP_PHONE_NUMBER_ID ?? '1',
      OPENROUTER_API_KEY: 'e2e',
      OPENROUTER_BASE_URL: openrouterUrl,
      AI_TRIAGE_MODELS: 'e2e/falso',
      LOG_LEVEL: 'info',
      SENTRY_DSN: '',
    },
  })
  await new Promise<void>((ok, falha) => {
    const prazo = setTimeout(() => falha(new Error('worker do e2e não iniciou em 30 s')), 30_000)
    filho.stdout!.on('data', (b: Buffer) => {
      if (b.toString().includes('worker iniciado')) {
        clearTimeout(prazo)
        ok()
      }
    })
    filho.on('exit', (codigo) => {
      clearTimeout(prazo)
      falha(new Error(`worker do e2e saiu com código ${codigo}`))
    })
  })
  return filho
}

export async function pararWorkerE2e(filho: ChildProcess | undefined) {
  if (!filho || filho.exitCode !== null) return
  await new Promise<void>((ok) => {
    filho.once('exit', () => ok())
    filho.kill('SIGTERM')
  })
  // o heartbeat dele ficaria "vivo" por 90 s e bloquearia o próximo e2e
  await getSql()`delete from worker_heartbeats where worker_id like ${'%-' + filho.pid}`
}
```
`SENTRY_DSN: ''` desliga o Sentry no worker do teste (o schema trata vazio como ausente).

- [ ] **Step 5: Specs do 02-C**

`apps/web/e2e/s1.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE_RELOGIO = `E2E Relogio ${SUFIXO}`
const TEMA = `estacionamento e2e ${SUFIXO}`
const RESPOSTA = `Temos estacionamento conveniado no subsolo (${SUFIXO}).`

const item = (servico: string, tipo: string | null, extra: Partial<TriagemFalsa['itens'][number]> = {}) =>
  ({ servico, tipo, unidade: null, data: null, tema: null, ...extra })

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  if (m.includes('estacionamento')) return { itens: [item('horario_unidades', 'info', { tema: TEMA })], fora_escopo: false }
  if (m.includes('aberto')) return { itens: [item('horario_unidades', 'aberto_agora', { unidade: UNIDADE_RELOGIO })], fora_escopo: false }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined

test.beforeAll(async () => {
  const [r] = await getSql()`select id from restaurants limit 1`
  // a triagem reserva orçamento antes de chamar a IA: garante limites no banco do e2e
  for (const periodo of ['dia', 'mes']) {
    await getSql()`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${r!.id}, 'ia', ${periodo}, 5) on conflict do nothing`
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from knowledge_facts where tema ilike ${'%' + SUFIXO + '%'}`
  await sql`delete from knowledge_gaps where chave_normalizada ilike ${'%' + SUFIXO + '%'}`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

const simulador = (page: Page) => page.getByRole('dialog', { name: 'Simulador de WhatsApp' })

async function abrirSimuladorLimpo(page: Page) {
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  await expect(simulador(page)).toBeVisible()
  await simulador(page).getByRole('button', { name: 'Novo cliente' }).click()
}

async function perguntar(page: Page, texto: string) {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill(texto)
  await page.keyboard.press('Enter')
}

/** Próximo domingo (no fuso do restaurante) às 12:00, no formato do campo datetime-local. */
function proximoDomingoAoMeioDia(): string {
  const fuso = 'America/Sao_Paulo'
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000)
    if (new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short' }).format(d) === 'Sun') {
      return `${new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(d)}T12:00`
    }
  }
  throw new Error('domingo não encontrado')
}

test('cadastra unidade e horários; a lista mostra "Aberta agora"', async ({ page }) => {
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Unidades' }).click()
  await page.getByRole('button', { name: 'Nova unidade' }).click()
  const nome = `E2E Centro ${SUFIXO}`
  await page.getByLabel(/^Nome/).fill(nome)
  await page.getByLabel(/^Endereço/).fill('Rua do Teste, 100')
  await page.getByRole('button', { name: 'Salvar unidade' }).click()
  // depois de salvar, a tela leva à aba Horários
  const segunda = page.getByRole('group', { name: 'Segunda-feira' })
  await segunda.getByRole('button', { name: 'Adicionar turno' }).click()
  await segunda.getByLabel(/^Abre/).fill('00:00')
  await segunda.getByLabel(/^Fecha/).fill('23:59')
  await page.getByRole('button', { name: 'Copiar segunda para todos os dias' }).click()
  await page.getByRole('button', { name: 'Salvar horários' }).click()
  await expect(page.getByText('Horários salvos')).toBeVisible()
  await page.getByRole('link', { name: 'Unidades' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: nome })).toContainText('Aberta agora')
})

test('formulário de unidade: erro no campo certo, sem gravar', async ({ page }) => {
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Unidades' }).click()
  await page.getByRole('button', { name: 'Nova unidade' }).click()
  await page.getByRole('button', { name: 'Salvar unidade' }).click()
  await expect(page.getByText('Informe o nome da unidade, como "Asa Sul"')).toBeVisible()
  await expect(page.getByLabel(/^Nome/)).toBeFocused()
})

test('pergunta sem resposta: o dono responde e o simulador passa a responder', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  await getSql()`insert into knowledge_gaps (restaurant_id, chave_normalizada, pergunta_mascarada)
    values (${r!.id}, ${'info:' + TEMA}, 'tem estacionamento?')`
  await entrarComoGestor(page)
  await page.getByRole('link', { name: 'Respostas' }).click()
  await page.getByRole('button', { name: new RegExp(`^Responder: ${TEMA}`, 'i') }).click()
  await page.getByLabel(/^Resposta/).fill(RESPOSTA)
  await page.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText(/^Informação salva/)).toBeVisible()

  await abrirSimuladorLimpo(page)
  await perguntar(page, 'tem estacionamento?')
  await expect(simulador(page).getByText(RESPOSTA)).toBeVisible({ timeout: 20_000 })
  expect(falso!.chamadas).toContain('tem estacionamento?')
})

test('simulador com relógio no domingo 12h responde pelo horário de domingo', async ({ page }) => {
  const [r] = await getSql()`select id from restaurants limit 1`
  const [u] = await getSql()`insert into units (restaurant_id, nome, slug, endereco)
    values (${r!.id}, ${UNIDADE_RELOGIO}, ${'e2e-relogio-' + SUFIXO}, 'Rua do Relógio, 1') returning id`
  await getSql()`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
    values (${r!.id}, ${u!.id}, 0, 1, '11:30', '16:00')`
  await entrarComoGestor(page)
  await abrirSimuladorLimpo(page)
  const s = simulador(page)
  await s.getByRole('button', { name: 'Simular data e hora' }).click()
  await s.getByLabel('Data e hora simuladas').fill(proximoDomingoAoMeioDia())
  await s.getByRole('button', { name: 'Aplicar' }).click()
  await expect(s.getByText(/^Relógio simulado: domingo/)).toBeVisible()
  await perguntar(page, `está aberto agora na ${UNIDADE_RELOGIO}?`)
  await expect(s.getByText(`A unidade ${UNIDADE_RELOGIO} está aberta agora`, { exact: false })).toBeVisible({ timeout: 20_000 })
  // nada saiu pela Meta: toda saída da conversa simulada ficou "simulado"
  const saidas = await getSql()`select m.status_envio from messages m join conversations c on c.id = m.conversation_id
    where c.simulada and m.direcao = 'out' and m.created_at > now() - interval '5 minutes'`
  expect(saidas.length).toBeGreaterThan(0)
  expect(saidas.every((x) => x.status_envio === 'simulado')).toBe(true)
})
```
Os textos de toast ("Horários salvos", "Informação salva…") são os definidos nas Tasks 7 e 9. Se o teste e a tela discordarem, a tela vence: não mude a tela para caber no teste.

- [ ] **Step 6: Rodar o e2e**

Pré-requisitos: Supabase local rodando, `pnpm db:migrate`, **nenhum** worker local rodando e as variáveis do e2e no shell (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PHONE_ENC_KEY`, `WA_ID_PEPPER`; **nunca** gravar a service role em arquivo).

Run: `pnpm --filter @atd/web e2e`
Expected: PASS. Os specs antigos (auth, convite, painel) e os 4 novos passam no projeto `celular`.

A triagem falsa manda `unidade` com o nome exato da unidade do teste. Assim, mesmo com outras unidades no banco local, a resposta é direta (sem lista).

- [ ] **Step 7: CI**

Em `.github/workflows/ci.yml`, passo `E2E`, nada muda: o spec sobe o próprio worker e o OpenRouter falso, e a falta de `WHATSAPP_ACCESS_TOKEN` é coberta pelo valor `e2e`. Confirme lendo o passo e anote no relatório.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/openrouter.ts packages/ai/src/openrouter.test.ts packages/config/src/env.ts packages/config/src/env.test.ts apps/worker/src/main.ts apps/web/playwright.config.ts apps/web/e2e
git commit -m "Adiciona e2e do painel e do simulador com worker real, OpenRouter falso e MFA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Documentação, homologação do dono e verificação final

**Files:**
- Create: `docs/homologacao/etapa-02c.md`
- Modify: `PLAN.md` (item 02-C e "Onde paramos"), `PRD.md` (adendo da Etapa 02), `CLAUDE.md` + `AGENTS.md` ("Onde paramos"), `docs/homologacao/etapa-02b.md` (seção 6)

**Interfaces:**
- Consumes: tudo das Tasks 1–14.
- Produces: roteiro de teste do dono; registro do estado no PLAN/PRD/CLAUDE.

- [ ] **Step 1: Roteiro de homologação `docs/homologacao/etapa-02c.md`**

```markdown
# Homologação — plano 02-C (painel de S1 e simulador)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # 4 unidades, horários, exceções e informações de demonstração
pnpm dev                                # painel em http://127.0.0.1:3000
pnpm --filter @atd/worker dev           # outro terminal: o worker que responde o simulador
```
O simulador usa a IA de verdade e precisa de `OPENROUTER_API_KEY` com crédito e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Cada mensagem simulada custa uma fração de centavo e entra no limite de gastos de IA.

## 2. Unidades
1. Entre como dono. Abra **Unidades**: cada unidade mostra o selo ("Aberta agora · fecha às 23h", "Fechada · abre amanhã às 11h30", "Horário não cadastrado" ou "Desativada").
2. **Nova unidade**: salve sem nome e veja o erro no campo. Depois preencha nome e endereço, cole um link do Google Maps ("Compartilhar → Copiar link") e salve. A tela abre na aba **Horários**.
3. **Horários**: adicione turnos, use "Copiar segunda para dias úteis" e cadastre um turno que passa da meia-noite (ex.: 18:00–02:00). Aparece o aviso "Termina no dia seguinte (madrugada)." Salve.
4. **Exceções**: veja os feriados nacionais do ano com o comportamento da política; cadastre uma data especial (fechado o dia todo) e apague com confirmação.
5. Desative uma unidade em **Dados**: o selo vira "Desativada" e a IA para de citá-la.

## 3. Respostas
1. **Sem resposta**: perguntas que a IA não soube (geradas por clientes reais, nunca pelo simulador). "Responder" abre o formulário já com o assunto; salve uma resposta. "Ignorar" pede confirmação.
2. **Informações**: crie, edite e apague informações; veja as sugestões de temas comuns.
3. **Mensagens**: edite um texto e veja a prévia com dados reais. Variável escrita errada (`{ unidade }`) ou faltando mostra erro. "Restaurar padrão" volta o texto original.

## 4. Início e Mais
- **Início**: "Respondido pela IA hoje" (e nos últimos 7 dias) e as 3 perguntas sem resposta mais frequentes, com o atalho "Responder".
- **Mais → Restaurante**: nome, política de feriados e link da política de privacidade (só o dono edita).

## 5. Simulador (botão verde do WhatsApp; só dono e gerente)
1. Pergunte "abre domingo?". Em ~5 s aparece a resposta gravada pelo pipeline real (o primeiro contato também recebe o aviso de privacidade).
2. "estão abertos agora?" com várias unidades: aparece a lista; toque numa unidade.
   "endereço da Asa Sul": vem o texto e o cartão de localização. "abre no feriado e aceita pix?": pergunta composta, uma resposta para cada parte.
3. **Simular data e hora** → domingo 12:00 → "estão abertos agora?": a resposta usa o domingo. "Usar relógio real" volta ao normal.
4. **Ver detalhes**: modelo, custo e tempo de cada chamada da IA desta conversa.
5. "quero falar com um atendente": aparece o aviso de que a conversa foi para um atendente. Ela **não** entra em "Aguardando atendente" no Início. **Novo cliente** recomeça do zero.
6. Entre como atendente: o botão do simulador não aparece.

## 6. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm --filter @atd/web e2e              # pare o worker local antes: o e2e sobe o próprio, com IA falsa
```
Depois do `pnpm check`, prepare o banco de novo (seção 1).

## Se o simulador não responder
- O worker está rodando? O Início mostra "IA: Online".
- Erro do OpenRouter aparece em **Ver detalhes** (com a causa). Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
- Limite de gastos de IA atingido: a resposta é o aviso de modo econômico. Ajuste o limite em **Mais**.
```

- [ ] **Step 2: Registros**

- `docs/homologacao/etapa-02b.md`, seção 6: trocar o texto por `Telas de Unidades/Respostas e o simulador ligado ao pipeline real: ver docs/homologacao/etapa-02c.md.`
- `PRD.md`, no "Adendo — Etapa 02", acrescentar um item:
  `- **Plano 02-C (implementado, <data>):** painel de S1 (Unidades com selo "aberta agora", Horários com turno de madrugada, Exceções com feriados do ano, Respostas com Sem resposta/Informações/Mensagens, Início com taxa de resposta e perguntas sem resposta, Restaurante em Mais) sob RLS e auditoria na mesma transação; permissão por unidade em forma de initplan (\`app.minhas_unidades()\`, migration 0016); simulador ligado ao pipeline real: conversa \`simulada\` por usuário (\`sim:<userId>:<epoch>\`), ingestão pelo papel \`web_app\`, canal "simulador" no worker (nunca chama a Meta; telefone não decifrável), relógio simulado por deslocamento em \`conversations.relogio_offset_segundos\` (só S1 e pendente; orçamento no relógio real), polling por Server Action; simulador só para dono/gerente; e2e com worker real, OpenRouter falso (\`OPENROUTER_BASE_URL\`, só teste) e MFA TOTP real. Horário do atendimento humano adiado para a Etapa 06.`
- `PLAN.md`: marcar `- [x] Plano 02-C (<data>; commits <primeiro>..<último>; pnpm check com N testes; e2e N/N) — … — plano em [docs/plans/etapa-02c-painel-simulador.md](docs/plans/etapa-02c-painel-simulador.md)` e acrescentar no topo de "Onde paramos": `- **<data>** — Plano 02-C implementado (painel de S1, simulador ligado ao pipeline real, e2e). Homologação em docs/homologacao/etapa-02c.md. Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem; Postgres 17 no Supabase hospedado. Próximo: homologação do dono e fechamento da Etapa 02.`
- `PLAN.md`, Etapa 08: no item `Direitos do titular (acesso/exclusão), configuração de retenção, cron de retenção`, acrescentar `; apagar simulações com mais de 7 dias (spec 02 §5.3)`, e no item `Telas de limites (IA e WhatsApp), alertas, relatórios de custo` acrescentar `; custo de simulação mostrado à parte (ai_runs.simulado)`.
- `CLAUDE.md`: mesma linha no topo de "Onde paramos"; depois `cp CLAUDE.md AGENTS.md`.

Use a data real e os números reais da execução (contagem de testes, intervalo de commits). Não copie números deste plano.

- [ ] **Step 3: Verificação final**

Run: `pnpm check && pnpm --filter @atd/web e2e`
Expected: PASS. Cole no relatório o resumo do `pnpm check` (arquivos/testes) e do Playwright.
Depois: `pnpm db:migrate && pnpm --filter @atd/db demo:s1` para deixar o banco local pronto para a homologação.

- [ ] **Step 4: Commit**

```bash
git add docs/homologacao/etapa-02c.md docs/homologacao/etapa-02b.md PLAN.md PRD.md CLAUDE.md AGENTS.md
git commit -m "Documenta o plano 02-C e o roteiro de homologação do painel e do simulador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
