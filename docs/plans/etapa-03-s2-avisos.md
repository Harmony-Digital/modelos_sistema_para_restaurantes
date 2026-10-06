# Etapa 03 — Avisos de presença (S2) — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado (decisão do dono, 05/10/2026):** o plano traz interfaces, testes obrigatórios, decisões e critérios; **código completo só nas partes delicadas** (migration/RLS, upsert concorrente, transação do worker). O implementador escreve o resto seguindo os padrões do repositório. **Revisão por bloco** (A–D), não por tarefa; revisão final da branch no fim.

**Goal:** o cliente registra/atualiza/cancela avisos de presença pelo WhatsApp (resolvidos pelo código, como o S1) e a equipe vê a previsão do dia por unidade no painel.

**Architecture:** a triagem `triage-v3` extrai itens S2 (`registrar`/`cancelar`, unidade, data, pessoas, horário); `@atd/core/s2` (puro) decide a ação e o texto a partir do contexto S1 e dos avisos ativos do cliente; o worker executa a ação na **mesma transação** do commit da resposta. O painel lê/grava `attendance_notices` sob RLS com auditoria.

**Tech Stack:** o mesmo do 02-C (Next 16, React 19, Drizzle 0.45, Postgres/Supabase, pg-boss, Zod 4, Vitest, Playwright).

**Spec:** [docs/specs/2026-10-05-etapa-03-s2-design.md](../specs/2026-10-05-etapa-03-s2-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `etapa-03-s2-avisos` (já criada a partir da `main` com o 02-C). Nunca commitar na `main`; nunca `--force`.
- Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD por tarefa: teste que falha → implementação → verde. Cada tarefa roda **só os testes dela** + typecheck/lint dos pacotes tocados; `pnpm check` e e2e no fim de cada bloco (C e D) e na verificação final.
- Toda Server Action: `requireStaff(papéis)` primeiro, mesmo schema Zod do formulário, `ActionResult`; escrita só dono/gerente; atendente só lê. Toda mutação do painel grava `audit_log` na mesma transação, sem PII no `diff` (nunca nome/telefone).
- Código de navegador importa só `@atd/core/s1` / `@atd/core/s2` (o índice de `@atd/core` puxa `node:crypto`) e nunca valores de `@atd/db`.
- Migrations só via `drizzle-kit generate`/`--custom`; nunca editar 0000–0017.
- Prompts versionados: `triage-v2` não muda; criar `triage-v3`.
- Simulação: aviso de conversa simulada grava `simulado = true` e nunca entra na previsão nem em contagens.
- Padrões de UI do 02-C (estado vazio que ensina, skeleton, toast, confirmação antes de cancelar, alvos ≥ 44 px, foco visível, datas `dd/mm/aaaa`, horas `HH:mm`, nunca `text-primary` como cor de texto, guarda contra duplo envio com `useRef`, `chamarAcao` para erro de action).
- `pnpm test`/projeto `db` apagam o banco local. Antes do e2e: `pnpm db:migrate`, bootstrap se faltar restaurante, `pnpm --filter @atd/db demo:s1`.

## Decisões deste plano

1. **Sem tool-loop de LLM:** S2 segue a abordagem do S1 (spec §2, PRD §9 da spec).
2. **Sem confirmação:** registra direto e responde com resumo.
3. **Data ausente = hoje;** pessoas ausente ⇒ pergunta; unidade ausente ⇒ lista do S1 (ou assume se só houver uma ativa).
4. **Pendente vira união:** `{ tipo: 'unidade', … }` (o atual) ou `{ tipo: 'pessoas', pergunta, item, expiraEm }`. Pendente antigo sem `tipo` é lido como `'unidade'`.
5. **Texto "Anotado" vs "Atualizei"** decidido no core pelos avisos ativos lidos antes; corrida concorrente pode trocar só o texto — o banco garante um aviso ativo por cliente/unidade/dia.
6. **Mensagens S2 entram em `MODELOS_S1`** (renomear o tipo exportado não é necessário; a aba Mensagens lista tudo de `ChaveModelo`).
7. **Previsão na barra inferior** (5 itens).

## Review Focus

1. **Dois avisos simultâneos do mesmo cliente/unidade/dia** (job e painel, ou dois jobs) — sempre um único aviso ativo; teste de concorrência na Task 1.
2. **Cliente tentando cancelar aviso de outro cliente** — cancelamento filtra por `customer_id` da conversa; teste na Task 4.
3. **"Hoje" perto da meia-noite / relógio simulado** — data resolvida no fuso do restaurante com o relógio da conversa; teste na Task 2 (23h50 e 00h10).
4. **Resposta curta ambígua após "Para quantas pessoas?"** ("não sei", "uns 4 ou 5", "amanhã") — não registra lixo: só número claro 1–60 vira pessoas; o resto segue para a triagem normal; teste na Task 2/4.
5. **Gerente restrito / atendente na Previsão** — vê só unidades permitidas; atendente não cria nem cancela; testes nas Tasks 1 e 5.

## Mapa de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `packages/db/src/schema/s2.ts`, `schema/index.ts`, migrations `0018` (gerada) + `0019` (custom RLS) | tabela `attendance_notices` | 1 |
| `packages/db/src/avisos.ts` | operações do worker (ler ativos do cliente, upsert, cancelar) | 1 |
| `packages/db/src/painel-avisos.ts` | previsão do dia, criar/cancelar pelo painel (RLS + auditoria) | 1 |
| `packages/core/src/s2/*` + export `./s2` | tipos S2, `lerPessoas`, `normalizarHorario`, `resolverS2`, `resolverAtendimento` | 2 |
| `packages/core/src/s1/modelos.ts`, `tipos.ts`, `resolver.ts` | modelos S2, `ItemExtraido` estendido, S1 ignora itens S2 | 2 |
| `packages/ai/src/prompts/triage-v3.ts`, `triage.ts` | triagem v3 | 3 |
| `packages/ai/evals/s2/*` | evals S2 (camadas 1 e 2) | 3 |
| `apps/worker/src/jobs/process-conversation.ts` | integração S2, pendente de pessoas, gravação na transação | 4 |
| `apps/web/app/(painel)/previsao/**`, `components/painel/previsao*.tsx`, `lib/schemas/avisos.ts`, `components/shell/bottom-nav.tsx`, Início, `lib/modelos-tela.ts` | painel | 5 |
| `apps/web/e2e/s2.spec.ts`, `docs/homologacao/etapa-03.md`, PLAN/PRD/CLAUDE/AGENTS | e2e e docs | 6 |

Blocos de revisão: **A** = Task 1 · **B** = Tasks 2–4 · **C** = Task 5 · **D** = Task 6 (+ revisão final da branch).

---

## Bloco A — Banco

### Task 1: Tabela `attendance_notices`, RLS e funções de banco

**Files:** Create `packages/db/src/schema/s2.ts`, `packages/db/src/avisos.ts`, `packages/db/src/painel-avisos.ts`, testes `avisos.db.test.ts`, `painel-avisos.db.test.ts`, `s2-rls.db.test.ts`; Modify `schema/index.ts`, `src/index.ts`; migrations geradas.

**Interfaces (Produces):**
```ts
// avisos.ts — worker (worker_app; filtra restaurant_id em toda consulta)
export type AvisoAtivo = { id: string; unitId: string; data: string /* YYYY-MM-DD */; pessoas: number; horarioAprox: string | null }
export function avisosAtivosDoCliente(db: Db | Tx, p: { restaurantId: string; customerId: string; aPartirDe: string }): Promise<AvisoAtivo[]>
export type GravarAviso = { restaurantId: string; customerId: string; unitId: string; data: string; pessoas: number; horarioAprox: string | null; nome: string | null; simulado: boolean }
export function registrarAviso(tx: Tx, a: GravarAviso): Promise<{ id: string; atualizado: boolean }>
export function cancelarAvisoDoCliente(tx: Tx, p: { restaurantId: string; customerId: string; avisoId: string }): Promise<boolean>

// painel-avisos.ts — sob withUserContext + registrarAuditoria (painel-comum.ts)
export type AvisoPainel = { id: string; unitId: string; nome: string | null; pessoas: number; horarioAprox: string | null; origem: 'ia' | 'painel'; status: 'ativo' | 'cancelado' }
export type PrevisaoUnidade = { unitId: string; unidade: string; totalPessoas: number; avisos: AvisoPainel[] }
export function previsaoDoDia(db: Db, claims: JwtClaims, p: { data: string; incluirCancelados: boolean }): Promise<PrevisaoUnidade[]> // só unidades ativas visíveis, ordenadas como no S1; simulado=false; total só de ativos
export function totalPrevistoHoje(db: Db, claims: JwtClaims, agora?: Date): Promise<number>
export function criarAvisoPainel(db: Db, claims: JwtClaims, p: { unitId: string; data: string; pessoas: number; horarioAprox: string | null; nome: string | null }): Promise<ResultadoPainel<{ id: string }>>
export function cancelarAvisoPainel(db: Db, claims: JwtClaims, avisoId: string): Promise<ResultadoPainel>
```

- [ ] **Step 1: Testes (falham).** Cobrir, no mínimo:
  - `registrarAviso` cria; segundo registro do mesmo cliente/unidade/dia **atualiza** (`atualizado: true`, um só ativo); após cancelar, novo registro cria outro.
  - **Concorrência:** `Promise.all` de dois `registrarAviso` iguais em transações separadas ⇒ 1 linha ativa, nenhum erro.
  - `cancelarAvisoDoCliente` com aviso de **outro** cliente ⇒ `false`, nada muda.
  - `avisosAtivosDoCliente` ignora cancelados e datas anteriores a `aPartirDe`.
  - `previsaoDoDia`: totais só de ativos e não simulados; gerente restrito vê só sua unidade; atendente lê; `incluirCancelados`.
  - `criarAvisoPainel`/`cancelarAvisoPainel`: dono/gerente ok com `audit_log` (`aviso.criado_painel`/`aviso.cancelado_painel`, `diff` sem `nome`); atendente ⇒ `sem_permissao`; gerente restrito em outra unidade ⇒ `sem_permissao`; cancelar inexistente ⇒ `nao_encontrada`; aviso manual tem `origem 'painel'`, `customer_id` nulo, `criado_por` = usuário.
  - RLS (`s2-rls.db.test.ts`): policies usam `app.minhas_unidades()` em initplan (mesmo padrão do teste `s1-rls-initplan.db.test.ts`).
- [ ] **Step 2: Schema.** `packages/db/src/schema/s2.ts` (siga `schema/s1.ts`: `restaurantFk`, FK composta `(unit_id, restaurant_id)`):
```ts
export const attendanceStatus = pgEnum('attendance_status', ['ativo', 'cancelado'])
export const attendanceOrigin = pgEnum('attendance_origin', ['ia', 'painel'])

export const attendanceNotices = pgTable('attendance_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  restaurantId: restaurantFk(),
  unitId: uuid('unit_id').notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  nome: text('nome'),
  data: date('data', { mode: 'string' }).notNull(),
  pessoas: smallint('pessoas').notNull(),
  horarioAprox: text('horario_aprox'),
  status: attendanceStatus('status').notNull().default('ativo'),
  origem: attendanceOrigin('origem').notNull(),
  simulado: boolean('simulado').notNull().default(false),
  anonimizado: boolean('anonimizado').notNull().default(false),
  criadoPor: uuid('criado_por').references(() => authUsers.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => [
  foreignKey({ columns: [t.unitId, t.restaurantId], foreignColumns: [units.id, units.restaurantId], name: 'attendance_notices_unit_fk' }).onDelete('cascade'),
  check('attendance_pessoas_ck', sql`${t.pessoas} between 1 and 60`),
  check('attendance_horario_ck', sql`${t.horarioAprox} is null or char_length(${t.horarioAprox}) <= 40`),
  uniqueIndex('attendance_ativo_uq').on(t.customerId, t.unitId, t.data).where(sql`status = 'ativo'`),
  index('attendance_previsao_idx').on(t.restaurantId, t.unitId, t.data),
])
```
Run `pnpm --filter @atd/db exec drizzle-kit generate --name=avisos_presenca` ⇒ `0018_avisos_presenca.sql` (leia: só enums, tabela, checks, FKs e índices).
- [ ] **Step 3: RLS (custom).** `pnpm --filter @atd/db exec drizzle-kit generate --custom --name=avisos_rls` ⇒ `0019_avisos_rls.sql`:
```sql
alter table public.attendance_notices enable row level security;--> statement-breakpoint
grant select, insert, update on public.attendance_notices to authenticated;--> statement-breakpoint
grant select, insert, update on public.attendance_notices to worker_app, web_app;--> statement-breakpoint
create policy app_roles on public.attendance_notices for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy equipe_read on public.attendance_notices for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_insert on public.attendance_notices for insert to authenticated
  with check (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_update on public.attendance_notices for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id())
    and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
```
(Confira nas migrations 0004/0012/0016 os grants e o padrão de `revoke` de sequência/`delete`; não conceda `delete`.) `pnpm db:migrate`.
- [ ] **Step 4: Upsert do worker (código delicado).**
```ts
export async function registrarAviso(tx: Tx, a: GravarAviso): Promise<{ id: string; atualizado: boolean }> {
  const [r] = await tx.insert(attendanceNotices)
    .values({ restaurantId: a.restaurantId, customerId: a.customerId, unitId: a.unitId, data: a.data, pessoas: a.pessoas,
      horarioAprox: a.horarioAprox, nome: a.nome, origem: 'ia', simulado: a.simulado })
    .onConflictDoUpdate({
      target: [attendanceNotices.customerId, attendanceNotices.unitId, attendanceNotices.data],
      targetWhere: sql`status = 'ativo'`,
      set: { pessoas: a.pessoas, horarioAprox: a.horarioAprox, nome: sql`coalesce(excluded.nome, ${attendanceNotices.nome})`, updatedAt: sql`now()` },
    })
    // xmax <> 0 ⇒ a linha já existia (foi atualizada)
    .returning({ id: attendanceNotices.id, atualizado: sql<boolean>`(xmax <> 0)` })
  return r!
}
```
`cancelarAvisoDoCliente`: `update … set status='cancelado' where id = $avisoId and restaurant_id and customer_id and status='ativo' returning id`. Painel: `criarAvisoPainel` usa insert simples (sem `customer_id` não há conflito) e `semPermissaoVira`; `cancelarAvisoPainel` faz update + `exigirPapel` para distinguir silêncio da RLS (padrão do `painel-respostas.ts`).
- [ ] **Step 5: Verde + EXPLAIN.** `pnpm vitest run --project db packages/db/src/avisos.db.test.ts packages/db/src/painel-avisos.db.test.ts packages/db/src/s2-rls.db.test.ts && pnpm --filter @atd/db typecheck && pnpm lint`. Cole no relatório o `EXPLAIN` da consulta de `previsaoDoDia` (deve usar `attendance_previsao_idx`; em tabela vazia use `set enable_seqscan = off`).
- [ ] **Step 6: Commit** — "Cria a tabela de avisos de presença com RLS por unidade e operações do worker e do painel".

**Fim do Bloco A → revisão do bloco.**

---

## Bloco B — Domínio, triagem e worker

### Task 2: Domínio S2 em `@atd/core/s2`

**Files:** Create `packages/core/src/s2/{tipos,pessoas,horario,resolver,atendimento,index}.ts` + testes; Modify `packages/core/package.json` (export `"./s2": "./src/s2/index.ts"`), `packages/core/src/index.ts` (reexporta s2), `s1/tipos.ts`, `s1/modelos.ts`, `s1/resolver.ts`.

**Interfaces:**
```ts
// s1/tipos.ts — ItemExtraido estendido (v2 preenche null)
export const TIPOS_S2 = ['registrar', 'cancelar'] as const
export type TipoS2 = (typeof TIPOS_S2)[number]
export type ItemExtraido = { servico: Servico; tipo: TipoS1 | TipoS2 | null; unidade: string | null; data: string | null; tema: string | null; pessoas: number | null; horario: string | null }

// s2/pessoas.ts
export function lerPessoas(texto: string): number | null // "4", "somos 5", "quatro", "eu e minha esposa"→2, "só eu"→1; ambíguo ("uns 4 ou 5", "não sei")→null; fora de 1–60 → null
// s2/horario.ts
export function normalizarHorario(texto: string | null): { hhmm: string | null; livre: string | null } // "20h"→20:00, "às 19:30"→19:30, "19h30"→19:30, "à noite"→livre "à noite" (≤40), lixo→ambos null

// s2/resolver.ts
export type AcaoS2 =
  | { tipo: 'registrar'; unitId: string; data: string; pessoas: number; horarioAprox: string | null; atualiza: boolean }
  | { tipo: 'cancelar'; avisoId: string }
export type ResultadoS2 = { texto: string | null; acoes: AcaoS2[]; perguntarPessoas: ItemExtraido | null; pendenteUnidade: ItemExtraido[]; validos: number; respondidos: number }
export function resolverS2(itens: readonly ItemExtraido[], ctx: ContextoS1, agora: Date, avisos: readonly AvisoAtivoS2[], escolhidaId?: string): ResultadoS2
export type AvisoAtivoS2 = { id: string; unitId: string; data: string; pessoas: number; horarioAprox: string | null }

// s2/atendimento.ts — compõe S1 + S2 numa resposta
export type ResultadoAtendimento = ResultadoS1 & { acoesS2: AcaoS2[]; perguntarPessoas: ItemExtraido | null }
export function resolverAtendimento(itens: readonly ItemExtraido[], ctx: ContextoS1, agora: Date, avisos: readonly AvisoAtivoS2[], escolhidaId?: string): ResultadoAtendimento
```
Regras (spec §2.2): data ausente = hoje (fuso do restaurante); fora de `[hoje, hoje+30]` ⇒ `aviso_data_fora`; pessoas null ⇒ `perguntarPessoas` (sem ação) e texto `aviso_pessoas`; pessoas fora de 1–60 ⇒ `aviso_pessoas_invalido`; unidade não encontrada com >1 ativa ⇒ `pendenteUnidade` (o `resolverAtendimento` monta a **mesma** lista do S1, unindo pendentes S1+S2); 1 ativa ⇒ assume; fechada no dia (`horarioDoDia`) ⇒ `aviso_unidade_fechada`; `hhmm` fora dos turnos do dia (incluindo madrugada) ⇒ `aviso_horario_fora`; ok ⇒ ação `registrar` + `aviso_registrado` ou `aviso_atualizado` (se `avisos` tem o mesmo unit/data). Cancelar: por unidade/data; sem ambos e 1 aviso ⇒ esse; vários ⇒ `aviso_qual_cancelar` com linhas `• Asa Sul — sábado (11/10), 4 pessoas`; nenhum ⇒ `aviso_nao_encontrado`. Cada item S2 conta em `validos`; `respondidos` só quando registra/cancela. `resolverS1` passa a **ignorar** itens `aviso_presenca` (sem `em_breve`); `NOME_SERVICO` perde `aviso_presenca`.

Modelos novos em `MODELOS_S1` (textos exatos; variáveis validadas pela regra estrita do 02-C):
```ts
aviso_registrado: { texto: 'Anotado: {unidade}, {quando}, {pessoas}{horario}. Se mudar de ideia, é só me avisar.', variaveis: ['unidade', 'quando', 'pessoas', 'horario'] },
aviso_atualizado: { texto: 'Atualizei seu aviso: {unidade}, {quando}, {pessoas}{horario}.', variaveis: ['unidade', 'quando', 'pessoas', 'horario'] },
aviso_pessoas: { texto: 'Para quantas pessoas?', variaveis: [] },
aviso_pessoas_invalido: { texto: 'Consigo anotar avisos de 1 a 60 pessoas. Para grupos maiores, fale com a nossa equipe.', variaveis: [] },
aviso_data_fora: { texto: 'Consigo anotar avisos de hoje até {limite}. Pode me dizer outro dia?', variaveis: ['limite'] },
aviso_unidade_fechada: { texto: '{quando}, a unidade {unidade} não abre. Quer avisar para outro dia?', variaveis: ['quando', 'unidade'] },
aviso_horario_fora: { texto: '{quando}, a unidade {unidade} funciona {turnos}. Pode me dizer um horário dentro desse período?', variaveis: ['quando', 'unidade', 'turnos'] },
aviso_cancelado: { texto: 'Pronto, cancelei seu aviso: {unidade}, {quando}.', variaveis: ['unidade', 'quando'] },
aviso_nao_encontrado: { texto: 'Não encontrei nenhum aviso ativo seu.', variaveis: [] },
aviso_qual_cancelar: { texto: 'Você tem estes avisos:\n{linhas}\nQual deseja cancelar? Diga a unidade e o dia.', variaveis: ['linhas'] },
```
`{quando}` = `rotuloDoDia` do S1 ("hoje (05/10)"/"sábado (11/10)" — use o formato que o S1 já produz); `{pessoas}` = "1 pessoa"/"4 pessoas"; `{horario}` = `", por volta " + dasHora(hhmm)` ⇒ ", por volta das 20h" (`dasHora` do S1) ou `", à noite"` ou `''`; `{limite}` = `dd/mm`.

- [ ] **Step 1: Testes (falham)** em `s2/*.test.ts`: tabela de `lerPessoas` (≥ 15 entradas, incluindo ambíguas ⇒ null) e `normalizarHorario`; `resolverS2` cobrindo cada regra acima com o contexto de fixture do S1 (`packages/ai/evals/s1/fixture.ts` pode ser importado nos testes); **meia-noite**: agora 23h50 de sábado ⇒ "hoje" é sábado; 00h10 de domingo ⇒ domingo; atualização (`atualiza: true`); cancelar com 0/1/vários; `resolverAtendimento` com S1+S2 na mesma mensagem e com pendente de unidade unindo itens S1 e S2 numa só lista; `resolverS1` ignora S2.
- [ ] **Step 2: Implementar** os módulos (puros: sem `fetch`, sem DB; imports só de `../s1/*` e `../normalize.ts`). Atualize evals S1 / testes existentes que constroem `ItemExtraido` para incluir `pessoas: null, horario: null` (helpers `h()`/`o()` de `casos.ts`); snapshots da camada 2 do S1 **não** podem mudar exceto onde `aviso_presenca` deixava `em_breve` (registre quais).
- [ ] **Step 3: Verde:** `pnpm vitest run --project unit packages/core packages/ai/evals && pnpm --filter @atd/core typecheck && pnpm lint`.
- [ ] **Step 4: Commit** — "Adiciona o domínio de avisos de presença: pessoas, horário, resolução e composição com S1".

### Task 3: Triagem v3 e evals S2

**Files:** Create `packages/ai/src/prompts/triage-v3.ts`, `packages/ai/evals/s2/{casos,composicao.test,extracao}.ts` (+ `fixture` reutilizando o do S1), snapshot; Modify `packages/ai/src/triage.ts` (exporta `triageV3`, `TRIAGE_V3_PROMPT_VERSION`, `parseTriageV3`; `parseTriageV2` passa a preencher `pessoas: null, horario: null`), `packages/ai/package.json` (`"eval:s2"`), `.github/workflows/ci.yml` (job `evals-extracao` também roda `eval:s2` quando mudar `packages/ai/src/prompts/`, `triage.ts` ou `evals/s2`).

**Interfaces:** `triageV3(llm, { models, restaurante, text }): Promise<JsonCallResult<TriageV3>>` com `TriageV3 = { itens: ItemExtraido[]; fora_escopo: boolean }`; mesmo `provider` (deny + zdr), mesmo `redactPii` + delimitadores do v2; `tipo` aceita `TIPOS_S1 ∪ TIPOS_S2`; `pessoas` inteiro 1–60 ou null; `horario` ≤ 40 chars ou null. Prompt = v2 + seção de aviso de presença (registrar vs. cancelar, contar o cliente — "eu e minha esposa" = 2, não é aviso: perguntas sobre lotação/grupos/reserva → `horario_unidades:info` com tema), com 4–6 exemplos curtos.

- [ ] **Step 1: Testes (falham):** `triage-v3.test.ts` (schema estrito, parse aceita item S2 completo, rejeita `pessoas: 0`/`61`, v2 continua passando); `evals/s2/composicao.test.ts` com **≥ 40 casos** (spec §6.1) rodando `resolverAtendimento` e conferindo texto exato/ações/pergunta, mais o mesmo `horasInventadas` do S1 (nenhum horário inventado no texto).
- [ ] **Step 2: Implementar** prompt v3, parser, casos e `extracao.ts` (cópia adaptada do `evals/s1/extracao.ts`, com teto de custo; **≥ 30 frases** reais de aviso/cancelamento e de "não é aviso"; meta 95%).
- [ ] **Step 3: Verde:** `pnpm vitest run --project unit packages/ai && pnpm --filter @atd/ai typecheck && pnpm lint`. (A camada 1 roda com chave: `pnpm --filter @atd/ai eval:s2 --teto 0.50`; sem chave, registrar "não rodado — sem crédito" no relatório.)
- [ ] **Step 4: Commit** — "Adiciona a triagem v3 com avisos de presença e os evals do S2".

### Task 4: Worker — S2 no pipeline real

**Files:** Modify `apps/worker/src/jobs/process-conversation.ts`; Create `apps/worker/src/jobs/process-conversation-s2.db.test.ts`.

**Mudanças (código delicado indicado):**
1. Triagem: trocar `triageV2` por `triageV3` (`promptVersion` v3 em `ai_runs`).
2. Pendente como união (substitui `pendenteSchema`):
```ts
const pendenteUnidadeSchema = z.object({
  tipo: z.literal('unidade').default('unidade'),
  pergunta: z.string().max(300).default(''),
  itens: z.array(itemSchema).min(1).max(5),
  opcoes: z.array(z.string()).min(1).max(10),
  expiraEm: z.iso.datetime(),
})
const pendentePessoasSchema = z.object({
  tipo: z.literal('pessoas'),
  pergunta: z.string().max(300).default(''),
  item: itemSchema,
  expiraEm: z.iso.datetime(),
})
const pendenteSchema = z.union([pendentePessoasSchema, pendenteUnidadeSchema])
```
`itemSchema` ganha `tipo: z.enum([...TIPOS_S1, ...TIPOS_S2]).nullable()`, `pessoas: z.number().int().min(1).max(60).nullable().default(null)`, `horario: z.string().max(40).nullable().default(null)` (pendentes antigos sem os campos continuam válidos).
3. Resposta curta ao pendente de pessoas (antes da triagem, como `respostaDaLista`): uma única mensagem de texto, pendente `pessoas` válido e não expirado (relógio da conversa) e `lerPessoas(texto) !== null` ⇒ `resolverAtendimento([{ ...item, pessoas: n }], …)` sem LLM (`ai_runs` determinístico `promptVersion 's2-pessoas'`, custo 0). Senão ⇒ segue a triagem normal (o pendente é substituído pela nova decisão).
4. `decisaoS1` vira `decisaoAtendimento(r: ResultadoAtendimento, …)`: grava pendente `pessoas` quando `r.perguntarPessoas`; pendente `unidade` como hoje; `Decision` ganha `avisos?: AcaoS2[]`.
5. Contexto: antes de resolver, carregar `avisosAtivosDoCliente(db, { restaurantId, customerId, aPartirDe: hojeDaConversa })`.
6. **Gravação na transação do commit (código delicado)** — dentro de `commit`, **depois** do teste `alreadyDone`/`humanOwns` (se o humano assumiu, não grava aviso) e antes de inserir as mensagens:
```ts
for (const a of d.avisos ?? []) {
  if (a.tipo === 'registrar') {
    const r = await registrarAviso(tx, {
      restaurantId, customerId: ctx.customer.id, unitId: a.unitId, data: a.data, pessoas: a.pessoas,
      horarioAprox: a.horarioAprox, nome: ctx.customer.nomePerfil, simulado: ctx.conv.simulada,
    })
    await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: r.atualizado ? 'aviso.atualizado' : 'aviso.registrado', entidade: 'attendance_notice', entidadeId: r.id })
  } else {
    const ok = await cancelarAvisoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, avisoId: a.avisoId })
    if (ok) await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'aviso.cancelado', entidade: 'attendance_notice', entidadeId: a.avisoId })
  }
}
```
(Confira o tipo de `auditLog.entidadeId` — se for `uuid`, ok; mantenha `diff` ausente.)

- [ ] **Step 1: Testes (falham)** no padrão de `process-conversation-s1.db.test.ts` (fakeLlm/fakeWa, `deps.now` fixo): registra e responde "Anotado…"; mesmo pedido de novo ⇒ "Atualizei…", 1 linha ativa; sem pessoas ⇒ "Para quantas pessoas?" e pendente `pessoas`; "4" ⇒ registra **sem chamar o LLM**; "uns 4 ou 5" ⇒ chama a triagem (não registra lixo); sem unidade com 4 ativas ⇒ lista e, ao tocar, registra; cancelar o próprio; cliente B não cancela aviso do cliente A (mesmo id passado à mão no item ⇒ "Não encontrei…"); conversa simulada ⇒ aviso `simulado = true`; humano assume antes do commit ⇒ nenhum aviso gravado; `audit_log` com as ações; S1 continua respondendo (rodar também os testes S1 existentes).
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verde:** `pnpm vitest run --project db apps/worker && pnpm --filter @atd/worker typecheck && pnpm lint`.
- [ ] **Step 4: Commit** — "Liga os avisos de presença ao pipeline do worker com pendente de pessoas".

**Fim do Bloco B → revisão do bloco** (Tasks 2–4 juntas; foco: Review Focus 2–4, transação, isolamento da simulação, nenhum horário inventado).

---

## Bloco C — Painel

### Task 5: Tela Previsão, cartão no Início, navegação e modelos

**Files:** Create `apps/web/lib/schemas/avisos.ts`, `apps/web/app/(painel)/previsao/{page,loading,actions}.tsx|ts` (+ `actions.test.ts`), `apps/web/components/painel/{previsao,aviso-form}.tsx` (+ `previsao.test.tsx`), `apps/web/lib/previsao.ts` (+ teste); Modify `components/shell/bottom-nav.tsx` (+ teste), `app/(painel)/page.tsx` (cartão "Previstos hoje"), `lib/modelos-tela.ts` (`ROTULOS_MODELO` e `exemploDeVariaveis` das 10 chaves novas), `e2e/painel.spec.ts` (navegação agora com 5 itens).

**Interfaces / comportamento:**
- `avisoSchema` (cliente+servidor): `unitId` uuid; `data` `YYYY-MM-DD` válida e em `[hoje, hoje+30]` no fuso `America/Sao_Paulo` (recebe `hoje` por parâmetro: `avisoSchema(hoje)`); `pessoas` 1–60 ("Informe de 1 a 60 pessoas."); `horario` vazio ou `HH:mm`; `nome` ≤ 60, opcional. Mensagens em pt-BR.
- Actions (todas `requireStaff`): `criarAvisoAction(form)` — dono/gerente; valida unidade aberta na data com `horarioDoDia` (carrega `carregarUnidadesPainel`) e horário dentro dos turnos (mesma regra do core: reutilize a função do `@atd/core/s2` que o resolver usa — exporte-a, ex. `validarAvisoNaAgenda(unidade, data, hhmm, politica, feriados)`); `cancelarAvisoAction(id)` — dono/gerente; `revalidatePath('/previsao')` e `'/'`.
- Página `/previsao?data=YYYY-MM-DD`: seletor de dia (anterior/próximo + input date, limitado a ±30), chips/abas por unidade só quando houver mais de uma permitida; por unidade: "**N pessoas** · M avisos" e lista (nome ou "Sem nome", pessoas, horário, selo IA/Painel); "Mostrar cancelados"; **Novo aviso** (folha/diálogo `FolhaFormulario`) e **Cancelar** (`Confirmar` com `rotuloAndamento="Cancelando…"`) só para dono/gerente; estado vazio da spec §4; `loading.tsx` com skeleton.
- Início: cartão "Previstos hoje" (`totalPrevistoHoje`) com link "Ver previsão", visível para todos os papéis (é contagem, sem custo).
- Barra inferior: `Início, Previsão (ícone CalendarCheck), Unidades, Respostas, Mais`; grade de 5 colunas sem estourar em 360 px (rótulos `text-[11px]` se preciso).

- [ ] **Step 1: Testes (falham):** schema (datas limite, pessoas 0/61, horário inválido); actions (papéis, Zod antes do banco, unidade fechada ⇒ erro no campo `data` "A unidade não abre nesse dia.", horário fora ⇒ erro no campo `horario` com os turnos do dia); UI (lista e totais, atendente sem botões, cancelar com confirmação, duplo envio do formulário chama a action uma vez, estado vazio); bottom-nav com 5 links e `aria-current`.
- [ ] **Step 2: Implementar.** Reaproveite `FolhaFormulario`, `Confirmar`, `Abas`, `chamarAcao`, `SubmitButton`, `Field`, `useZodForm`.
- [ ] **Step 3: Verde:** `pnpm vitest run --project unit apps/web && pnpm vitest run --project ui apps/web && pnpm --filter @atd/web typecheck && pnpm lint && pnpm --filter @atd/web build`.
- [ ] **Step 4: Fim do bloco:** `pnpm check` (apaga o banco) — registre o resultado.
- [ ] **Step 5: Commit** — "Adiciona a tela Previsão, o cartão de previstos no Início e os modelos de aviso".

**Fim do Bloco C → revisão do bloco** (foco: Review Focus 5, padrões de UI, layout em 360 px).

---

## Bloco D — E2E, docs e verificação final

### Task 6: E2E S2, homologação e registros

**Files:** Create `apps/web/e2e/s2.spec.ts`, `docs/homologacao/etapa-03.md`; Modify `apps/web/e2e/openrouter-falso.ts` só se precisar (a triagem falsa vive no spec), `PLAN.md`, `PRD.md` (spec §9), `CLAUDE.md` + `AGENTS.md`.

- [ ] **Step 1: E2E** (reutilize `entrarComoGestor`, `iniciarOpenRouterFalso`, `iniciarWorkerE2e`, limpeza por sufixo único):
  1. Simulador: "vou hoje na <unidade E2E> com 4 pessoas às 20h" (triagem falsa devolve item S2 `registrar` com unidade/pessoas/horario) ⇒ texto começa com "Anotado:"; a Previsão de hoje **não** mostra esse aviso (simulação isolada).
  2. Simulador: "vou amanhã na <unidade E2E>" (sem pessoas) ⇒ "Para quantas pessoas?"; responder "3" ⇒ "Anotado:" e o OpenRouter falso recebeu **uma** chamada para as duas mensagens.
  3. Painel: **Novo aviso** (unidade E2E, hoje, 6 pessoas) ⇒ aparece com "6 pessoas"; **Cancelar** ⇒ some e o total volta.
  4. Atendente vê a Previsão sem "Novo aviso".
  A unidade E2E é criada por SQL com horário cobrindo o dia todo (00:00–23:59, 7 dias) para os testes não dependerem da hora.
- [ ] **Step 2: Rodar o e2e completo** (variáveis só no shell, como no 02-C; nenhum worker local rodando): todos os specs verdes.
- [ ] **Step 3: Docs:** `docs/homologacao/etapa-03.md` (preparar banco; simulador: registrar, atualizar, pessoas, lista, cancelar, aviso + pergunta de horário na mesma mensagem; Previsão: navegar dias, novo aviso, cancelar, gerente/atendente; worker com `WHATSAPP_ACCESS_TOKEN=local-sem-meta`; crédito do OpenRouter). PRD: aplicar spec §9 (adendo "Etapa 03"). PLAN: marcar os itens da Etapa 03 com data/evidência reais e "Onde paramos"; CLAUDE "Onde paramos"; `cp CLAUDE.md AGENTS.md`.
- [ ] **Step 4: Verificação final:** `pnpm check` + e2e; deixar o banco pronto (`db:migrate`, bootstrap se faltar, `demo:s1`).
- [ ] **Step 5: Commit** — "Adiciona o e2e e o roteiro de homologação da Etapa 03".

**Fim do Bloco D → revisão final da branch** (modelo mais capaz) **→ onda única de correções → re-revisão.**

## Medição

O ledger da execução registra o horário de início/fim de cada bloco (implementação, revisão, correções) para comparar com o 02-C.
