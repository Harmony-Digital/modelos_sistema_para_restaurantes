# Etapa 04 — Eventos (S3) — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** interfaces, regras, testes obrigatórios e decisões; código completo só nos trechos delicados (migrations/RLS/grants, revelação do telefone, gravação na transação). **Revisão por bloco** (A–D) + revisão final. Testes de banco **nunca** em paralelo entre agentes (o banco local é único).

**Goal:** a IA informa espaços de evento e coleta pedidos (confirmação sempre humana); a equipe trabalha a fila de pedidos no painel.

**Architecture:** triagem v4 extrai itens de evento e recebe a pergunta pendente; `@atd/core/s3` (puro) decide coleta/registro/cancelamento/listagem de espaços; o worker grava na transação do commit. Painel: aba "Espaços" na unidade, fila "Eventos" dentro do novo item "Agenda", telefone revelado sob demanda com auditoria.

**Tech Stack:** igual às etapas anteriores (Next 16, React 19, Drizzle 0.45, Postgres/Supabase, pg-boss, Zod 4, Vitest, Playwright).

**Spec:** [docs/specs/2026-10-05-etapa-04-s3-design.md](../specs/2026-10-05-etapa-04-s3-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `etapa-04-s3-eventos` (criada da `main` com a Etapa 03). Nunca commitar na `main`; nunca `--force`.
- Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD por tarefa; cada tarefa roda só os testes dela + typecheck/lint dos pacotes tocados; `pnpm check` e e2e no fim dos blocos C e D.
- Server Actions: `requireStaff(papéis)` primeiro, mesmo Zod do formulário, `ActionResult`, `chamarAcao` no cliente. Mutações do painel com `audit_log` na mesma transação, sem PII no `diff` (nunca nome, telefone, notas internas).
- Navegador importa só `@atd/core/s1|s2|s3`; nunca valores de `@atd/db`.
- Migrations só via `drizzle-kit generate`/`--custom`; nunca editar 0000–0022. **Grants por coluna** para `authenticated` (padrão 0012/0020/0022), `mfa_required` restritiva, sem DELETE.
- Prompts: `triage-v3` não muda; criar `triage-v4`. Conteúdo do cliente só dentro de `<mensagem_cliente>`, com `redactPii` + `neutralize`; `provider: { data_collection: 'deny', zdr: true }`.
- A IA **nunca** escreve "reservado"/"confirmado" para pedido de evento (teste de texto nos evals).
- Simulação: pedido de conversa simulada grava `simulado = true` e nunca entra na fila nem nas contagens.
- Padrões de UI do painel (estado vazio que ensina, skeleton, toast, confirmação, alvos ≥ 44 px, foco visível, `dd/mm/aaaa`, nunca `text-primary` como texto, guarda `useRef` contra duplo envio).
- Antes do e2e: `pnpm db:migrate`, bootstrap se faltar, `pnpm --filter @atd/db demo:s1`; nenhum worker local rodando.

## Decisões deste plano

1. **ItemExtraido** ganha `convidados: number | null`, `tipoEvento: string | null`, `espaco: string | null` (v2/v3 preenchem null); `TIPOS_S3 = ['pedido', 'cancelar', 'espacos']`.
2. **Pendente** ganha a variante `{ tipo: 'pedido_evento', pergunta, campo: 'unidade'|'data'|'convidados'|'tipo'|'espaco', item, unitId?, expiraEm }` (60 min).
3. **Contexto da triagem:** `triageV4(llm, { models, restaurante, text, pendente?: { pergunta: string; conhecido: Record<string, string | number> } })` — `pergunta` é texto nosso; `conhecido` só com valores já validados (sem texto livre do cliente além de nomes de unidade/espaço do banco).
4. **Resposta curta sem LLM** continua só para "pessoas" (S2) e escolha na lista; as demais respostas a perguntas pendentes passam pela triagem v4 com contexto.
5. **Agenda:** rota `/agenda?aba=previsao|eventos`; `/previsao` redireciona preservando `data`; item da barra "Agenda" (ícone `CalendarDays`).
6. **Revelar telefone:** função de servidor única `revelarTelefonePedido(db, claims, pedidoId, phoneKey)` — lê via RLS (só quem vê a unidade), decifra, audita; nunca loga o número.
7. **Simulador auditado:** as Server Actions do simulador gravam `audit_log` (`simulador.aberto`, `simulador.novo_cliente`, `simulador.relogio`) via `withUserContext` (o `web_app` não tem INSERT em `audit_log`).
8. **`chamarAcao`** repropaga erros de navegação do Next (redirect/notFound) — confirme no Context7 a forma suportada no Next 16 para código cliente (`unstable_rethrow` ou `isRedirectError`/`isNotFoundError`).

## Review Focus

1. **Coleta em várias mensagens com resposta curta** ("aniversário", "dia 20", "uns 40", "Asa Sul") — o pedido avança e registra; teste no worker (Task 4) e casos com `pergunta_pendente` nos evals (Task 3).
2. **IA dizendo "confirmado/reservado"** — proibido em qualquer texto S3; asserção global nos evals (Task 3).
3. **Atendente na fila** — muda status/responsável/notas, não cria nem apaga, não revela telefone de unidade sem acesso; testes Task 1 e Task 5.
4. **Transição de status inválida / duplo clique** — confirmado/recusado/cancelado não volta para novo; segunda gravação igual é idempotente; teste Task 1.
5. **Telefone** — revelado só para quem vê a unidade, auditado, ausente em pedido sem cliente; teste Task 1 (banco) e Task 5 (UI).

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `packages/db/src/schema/s3.ts`, migrations `0023` (gerada) + `0024` (custom RLS/grants), `packages/db/src/eventos.ts` (worker), `packages/db/src/painel-eventos.ts` (painel) | 1 |
| `packages/core/src/s3/*` (+ export `./s3`), `s1/tipos.ts`, `s1/modelos.ts`, `s2/atendimento.ts` (compõe S3) | 2 |
| `packages/ai/src/prompts/triage-v4.ts`, `triage.ts`, `packages/ai/evals/s3/*`, CI | 3 |
| `apps/worker/src/jobs/process-conversation.ts` (+ teste s3) | 4 |
| `apps/web/app/(painel)/agenda/**`, `previsao` → redirect, `components/painel/{eventos,pedido-detalhe}.tsx`, `bottom-nav.tsx`, `lib/schemas/eventos.ts` | 5 |
| `apps/web/components/painel/{espacos,espaco-form}.tsx`, aba "Espaços" na unidade, Início, `lib/modelos-tela.ts`, `lib/action-result.ts`, `simulador-actions.ts` | 6 |
| `apps/web/e2e/s3.spec.ts`, `docs/homologacao/etapa-04.md`, PLAN/PRD/CLAUDE/AGENTS | 7 |

Blocos: **A** = Task 1 · **B** = Tasks 2–4 · **C** = Tasks 5–6 · **D** = Task 7 (+ revisão final).

---

## Bloco A — Banco

### Task 1: `event_spaces`, `event_requests`, RLS e funções de banco

**Files:** Create `packages/db/src/schema/s3.ts`, `packages/db/src/eventos.ts`, `packages/db/src/painel-eventos.ts`, testes `eventos.db.test.ts`, `painel-eventos.db.test.ts`, `s3-rls.db.test.ts`; Modify `schema/index.ts`, `src/index.ts`; migrations.

**Interfaces (Produces):**
```ts
// eventos.ts — worker_app (filtra restaurant_id sempre)
export type EspacoS3 = { id: string; unitId: string; nome: string; capacidadeMin: number; capacidadeMax: number; descricao: string | null; condicoes: string | null }
export function espacosAtivos(db: Db | Tx, restaurantId: string): Promise<EspacoS3[]>
export type PedidoAtivo = { id: string; unitId: string; data: string; convidados: number; tipo: TipoEvento; status: 'novo' | 'em_contato' | 'confirmado' }
export function pedidosDoCliente(db: Db | Tx, p: { restaurantId: string; customerId: string; aPartirDe: string }): Promise<PedidoAtivo[]> // status novo/em_contato/confirmado
export type GravarPedido = { restaurantId: string; customerId: string; unitId: string; spaceId: string | null; data: string; convidados: number; tipo: TipoEvento; tipoTexto: string | null; observacoes: string | null; nome: string | null; simulado: boolean }
export function registrarPedidoEvento(tx: Tx, p: GravarPedido): Promise<{ id: string }>
export function cancelarPedidoDoCliente(tx: Tx, p: { restaurantId: string; customerId: string; pedidoId: string }): Promise<boolean> // só novo/em_contato

// painel-eventos.ts — withUserContext + registrarAuditoria
export type EspacoPainel = EspacoS3 & { ativo: boolean }
export function listarEspacos(db: Db, claims: JwtClaims, unitId: string): Promise<EspacoPainel[]>
export function salvarEspaco(db: Db, claims: JwtClaims, id: string | null, v: { unitId: string; nome: string; capacidadeMin: number; capacidadeMax: number; descricao: string | null; condicoes: string | null; ativo: boolean }): Promise<ResultadoPainel<{ id: string }>> // nome duplicado na unidade ⇒ 'nome_duplicado'
export type StatusPedido = 'novo' | 'em_contato' | 'confirmado' | 'recusado' | 'cancelado'
export type PedidoPainel = { id: string; unitId: string; unidade: string; spaceId: string | null; espaco: string | null; nome: string | null; data: string; convidados: number; tipo: TipoEvento; tipoTexto: string | null; observacoes: string | null; status: StatusPedido; responsavelId: string | null; responsavel: string | null; notasInternas: string | null; temTelefone: boolean; criadoEm: Date }
export function listarPedidos(db: Db, claims: JwtClaims, f: { status: StatusPedido[]; unitId: string | null }): Promise<PedidoPainel[]> // simulado=false, ordem data asc, criadoEm asc
export function contarPedidosNovos(db: Db, claims: JwtClaims): Promise<number>
export function atualizarPedido(db: Db, claims: JwtClaims, id: string, m: { status?: StatusPedido; responsavelId?: string | null; notasInternas?: string | null }): Promise<ResultadoPainel | { ok: false; erro: 'transicao_invalida' }>
export function revelarTelefonePedido(db: Db, claims: JwtClaims, pedidoId: string, phoneKey: Buffer): Promise<ResultadoPainel<{ telefone: string }>>
export function membrosDaEquipe(db: Db, claims: JwtClaims): Promise<{ id: string; nome: string }[]> // para o seletor de responsável
```
`TipoEvento = 'aniversario' | 'casamento' | 'corporativo' | 'confraternizacao' | 'outro'` (exportado do schema e reexportado pelo core na Task 2 — defina o enum no schema e um tipo espelho em `@atd/core/s3` com teste de igualdade no Task 2).

Transições válidas (DAL): `novo → em_contato | confirmado | recusado | cancelado`; `em_contato → confirmado | recusado | cancelado`; `confirmado → cancelado`; `recusado`/`cancelado` finais. Mesmo status ⇒ ok sem auditar.

- [ ] **Step 1: Testes (falham).** Mínimo: criar/listar espaços (gerente restrito só na sua unidade; atendente não grava; nome duplicado); `registrarPedidoEvento` + `pedidosDoCliente`; `cancelarPedidoDoCliente` de outro cliente ⇒ false, de `confirmado` ⇒ false; `listarPedidos` exclui simulados e filtra unidade/status; atendente atualiza status/responsável/notas (audit `evento.status`, `evento.responsavel`, `evento.notas` sem o texto das notas); transições inválidas ⇒ `transicao_invalida`; `revelarTelefonePedido`: decifra o telefone do cliente (use `encryptPhone` no teste), audita `evento.telefone_visualizado` sem o número, gerente de outra unidade ⇒ `nao_encontrada`, pedido sem cliente ⇒ `nao_encontrada`; RLS: dono via `withUserContext` tentando `update simulado`/`unit_id` ⇒ 42501, `insert` em `event_requests` ⇒ 42501, `delete` ⇒ recusado; policies em initplan (padrão `s2-rls.db.test.ts`); `rls.db.test.ts` (mfa_required em toda tabela) continua verde.
- [ ] **Step 2: Schema** `schema/s3.ts` (padrão `schema/s2.ts`): enums `event_type` e `event_status`; `eventSpaces` (check `1 <= capacidade_min <= capacidade_max <= 1000`, único `(unit_id, nome)`, índice `(restaurant_id, unit_id)`, FK composta `(unit_id, restaurant_id)` cascade); `eventRequests` (FK composta unidade; `space_id` → `event_spaces.id` `set null`; `customer_id` → customers `set null`; `responsavel_id` → `auth.users` `set null`; checks convidados 1–1000, `tipo_texto` ≤ 60, `observacoes` ≤ 300, `notas_internas` ≤ 2000; índices `(restaurant_id, status, data)` e `(restaurant_id, unit_id, data)`). Gerar `0023_eventos`.
- [ ] **Step 3: RLS/grants (custom `0024_eventos_rls`, código delicado):**
```sql
alter table public.event_spaces enable row level security;--> statement-breakpoint
alter table public.event_requests enable row level security;--> statement-breakpoint
revoke all on public.event_spaces, public.event_requests from authenticated;--> statement-breakpoint
grant select on public.event_spaces, public.event_requests to authenticated;--> statement-breakpoint
grant insert (restaurant_id, unit_id, nome, capacidade_min, capacidade_max, descricao, condicoes, ativo) on public.event_spaces to authenticated;--> statement-breakpoint
grant update (nome, capacidade_min, capacidade_max, descricao, condicoes, ativo, updated_at) on public.event_spaces to authenticated;--> statement-breakpoint
grant update (status, responsavel_id, notas_internas, updated_at) on public.event_requests to authenticated;--> statement-breakpoint
grant select, insert, update on public.event_spaces, public.event_requests to web_app, worker_app;--> statement-breakpoint
revoke delete, truncate on public.event_spaces, public.event_requests from authenticated, web_app, worker_app;--> statement-breakpoint
create policy app_roles on public.event_spaces for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy app_roles on public.event_requests for all to web_app, worker_app using (true) with check (true);--> statement-breakpoint
create policy mfa_required on public.event_spaces as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy mfa_required on public.event_requests as restrictive for all to authenticated using ((select app.mfa_ok())) with check ((select app.mfa_ok()));--> statement-breakpoint
create policy equipe_read on public.event_spaces for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy gestao_write on public.event_spaces for all to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id()) and (select app.my_role()) in ('dono','gerente')
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy equipe_read on public.event_requests for select to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and not simulado
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));--> statement-breakpoint
create policy equipe_update on public.event_requests for update to authenticated
  using (restaurant_id = (select app.my_restaurant_id()) and not simulado
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])))
  with check (restaurant_id = (select app.my_restaurant_id())
    and ((select app.acesso_todas_unidades()) or unit_id = any ((select app.minhas_unidades())::uuid[])));
```
(Confira `app.my_role()` aceita os três papéis; o atendente precisa de `equipe_update`.) `pnpm db:migrate`.
- [ ] **Step 4: Implementar** `eventos.ts` e `painel-eventos.ts` no padrão de `avisos.ts`/`painel-avisos.ts` (insert por SQL parametrizado só nas colunas concedidas quando for `authenticated`; `semPermissaoVira`; `exigirPapel`). `revelarTelefonePedido` (delicado):
```ts
export function revelarTelefonePedido(db: Db, claims: JwtClaims, pedidoId: string, phoneKey: Buffer) {
  return withUserContext(db, claims, async (tx) => {
    const [r] = await tx.select({ restaurantId: eventRequests.restaurantId, cifrado: customers.telefoneCifrado })
      .from(eventRequests).innerJoin(customers, eq(customers.id, eventRequests.customerId))
      .where(eq(eventRequests.id, pedidoId)) // RLS de event_requests limita à unidade visível
    if (!r || r.cifrado === TELEFONE_SIMULADO) return falha('nao_encontrada')
    const telefone = decryptPhone(r.cifrado, phoneKey)
    await registrarAuditoria(tx, claims, { restaurantId: r.restaurantId, acao: 'evento.telefone_visualizado', entidade: 'event_request', entidadeId: pedidoId })
    return ok({ telefone })
  })
}
```
(Confirme que `authenticated` lê `customers.telefone_cifrado` sob RLS; se não ler, faça a leitura do `telefone_cifrado` como `web_app` **depois** de confirmar via `withUserContext` que o pedido é visível — nunca sem essa confirmação.)
- [ ] **Step 5: Verde + EXPLAIN** de `listarPedidos` (índice `(restaurant_id, status, data)`) no relatório. `pnpm vitest run --project db packages/db/src/eventos.db.test.ts packages/db/src/painel-eventos.db.test.ts packages/db/src/s3-rls.db.test.ts packages/db/src/rls.db.test.ts && pnpm --filter @atd/db typecheck && pnpm lint`.
- [ ] **Step 6: Commit** — "Cria espaços e pedidos de evento com RLS por unidade, grants por coluna e telefone auditado".

**Fim do Bloco A → revisão.**

---

## Bloco B — Domínio, triagem e worker

### Task 2: Domínio S3 em `@atd/core/s3`

**Files:** Create `packages/core/src/s3/{tipos,tipo-evento,resolver,index}.ts` + testes; Modify `packages/core/package.json` (`"./s3"`), `src/index.ts`, `s1/tipos.ts` (ItemExtraido + `TIPOS_S3`), `s1/modelos.ts` (modelos S3), `s1/resolver.ts` (ignora `evento`), `s2/atendimento.ts` (compõe S3), e os ajustes mínimos de compilação em `packages/ai/src/triage.ts` (v2/v3 preenchem os 3 campos com null), worker `itemSchema` (campos novos default null) e `apps/web/lib/modelos-tela.ts` (títulos das chaves novas).

**Interfaces:**
```ts
export const TIPOS_EVENTO = ['aniversario', 'casamento', 'corporativo', 'confraternizacao', 'outro'] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]
export function normalizarTipoEvento(texto: string | null): { tipo: TipoEvento; texto: string } | null // "niver"/"festa de 15 anos"→aniversario; "bodas"→casamento; "empresa"/"reunião da firma"→corporativo; "fim de ano"/"encontro"→confraternizacao; outro texto curto→outro; vazio→null
export type CampoPedido = 'unidade' | 'data' | 'convidados' | 'tipo' | 'espaco'
export type AcaoS3 =
  | { tipo: 'registrar_evento'; unitId: string; spaceId: string | null; data: string; convidados: number; tipoEvento: TipoEvento; tipoTexto: string; observacoes: string | null }
  | { tipo: 'cancelar_evento'; pedidoId: string; texto: string; textoSeFalhar: string }
export type ResultadoS3 = { texto: string | null; acoes: AcaoS3[]; perguntar: { campo: CampoPedido; item: ItemExtraido; unitId: string | null } | null; pendenteUnidade: ItemExtraido[]; handoff: boolean; lacunas: Lacuna[]; validos: number; respondidos: number }
export function resolverS3(itens: readonly ItemExtraido[], ctx: ContextoS1, espacos: readonly EspacoS3Core[], agora: Date, pedidos: readonly PedidoAtivoS3[], escolhidaId?: string): ResultadoS3
```
`ResultadoAtendimento` ganha `acoesS3`, `perguntarEvento`, `handoff`; `resolverAtendimento(itens, ctx, agora, avisos, escolhidaId?, s3?: { espacos; pedidos })`. Regras: spec §2.2 na íntegra (ordem unidade → data → convidados → tipo; espaço opcional com checagem de capacidade e sugestões; unidade fechada ⇒ observação "Unidade fechada nesse dia pelo horário cadastrado" e registra; cancelar com as regras de alvo do S2; `confirmado` ⇒ `handoff: true` e texto `evento_confirmado_humano`; `espacos` sem cadastro ⇒ lacuna `eventos:espacos`).

Modelos (texto exato; regra estrita de variáveis):
```ts
evento_registrado: { texto: 'Recebemos seu pedido de {tipo} para {convidados} na unidade {unidade}, {quando}{espaco}. Nossa equipe vai entrar em contato para confirmar.', variaveis: ['tipo', 'convidados', 'unidade', 'quando', 'espaco'] },
evento_pergunta_unidade: { texto: 'Para qual unidade é o evento? Toque em "Ver unidades" e escolha.', variaveis: [] },
evento_pergunta_data: { texto: 'Para qual data é o evento?', variaveis: [] },
evento_pergunta_convidados: { texto: 'Para quantos convidados?', variaveis: [] },
evento_pergunta_tipo: { texto: 'Qual o tipo do evento? (aniversário, casamento, corporativo, confraternização…)', variaveis: [] },
evento_data_fora: { texto: 'Consigo registrar pedidos de evento de amanhã até {limite}. Qual data você prefere?', variaveis: ['limite'] },
evento_convidados_invalido: { texto: 'Consigo registrar eventos de 1 a 1000 convidados. Para quantos convidados?', variaveis: [] },
evento_espaco_capacidade: { texto: 'O espaço {espaco} recebe de {min} a {max} pessoas.{sugestoes} Qual espaço prefere? Se tanto faz, diga "pode ser qualquer um".', variaveis: ['espaco', 'min', 'max', 'sugestoes'] },
evento_espacos: { texto: 'Espaços para eventos:\n{linhas}', variaveis: ['linhas'] },
evento_cancelado: { texto: 'Pronto, cancelei seu pedido de evento: {unidade}, {quando}.', variaveis: ['unidade', 'quando'] },
evento_nao_encontrado: { texto: 'Não encontrei pedido de evento seu em andamento.', variaveis: [] },
evento_qual_cancelar: { texto: 'Você tem estes pedidos:\n{linhas}\nPara cancelar, mande por exemplo: "{exemplo}".', variaveis: ['linhas', 'exemplo'] },
evento_confirmado_humano: { texto: 'Esse evento já foi confirmado pela equipe. Vou chamar um atendente para te ajudar.', variaveis: [] },
```
`{convidados}` = "40 convidados"/"1 convidado"; `{espaco}` = `", no espaço Salão"` ou `''`; `{sugestoes}` = `" Para {n} pessoas, sugiro: A, B."` ou `''`; `{tipo}` = rótulo pt-BR ("aniversário", …) ou o `tipoTexto` quando `outro`; linhas de espaços `• {nome} ({unidade}) — {min} a {max} pessoas. {descricao} {condicoes}` (sem campos nulos).

- [ ] **Step 1: Testes (falham):** tabela de `normalizarTipoEvento`; cada regra do `resolverS3` (incl. ordem das perguntas, data hoje ⇒ fora, +366 ⇒ fora, espaço inexistente ⇒ trata como não citado e informa, capacidade ⇒ sugestões, "pode ser qualquer um" (espaço = null explícito via `item.espaco === '*'` definido pela triagem v4) registra sem espaço, unidade fechada ⇒ observação, cancelar 0/1/vários/alvo não reconhecido/confirmado ⇒ handoff, espaços listados/lacuna); `resolverAtendimento` com S1+S3 e S2+S3 na mesma mensagem; **nenhum texto S3 contém "confirmad" exceto `evento_confirmado_humano` nem "reservad"** (varra todos os modelos `evento_*` no teste).
- [ ] **Step 2: Implementar** (puro; imports só de `../s1`, `../s2`, `../normalize.ts`). Atualize helpers de evals/testes S1/S2 que constroem `ItemExtraido` (campos novos `null`); snapshots S1/S2 só podem mudar onde `evento` antes gerava `em_breve` (registre).
- [ ] **Step 3: Verde:** `pnpm vitest run --project unit packages/core packages/ai/evals && pnpm typecheck && pnpm lint`.
- [ ] **Step 4: Commit** — "Adiciona o domínio de eventos: coleta guiada, espaços, cancelamento e composição".

### Task 3: Triagem v4 com pergunta pendente e evals S3

**Files:** Create `packages/ai/src/prompts/triage-v4.ts`, `packages/ai/evals/s3/{casos,composicao.test,extracao,comparar}.ts`; Modify `packages/ai/src/triage.ts` (`triageV4`, `parseTriageV4`, `TRIAGE_V4_PROMPT_VERSION`), `packages/ai/package.json` (`eval:s3`), CI (`evals-extracao` roda `eval:s3`), evals S1/S2 passam a poder rodar com a v4 (`--triagem v4`).

**Interface:** Decisão 3. O `user` vira:
```ts
const blocoPendente = p.pendente
  ? `<pergunta_pendente>\n${neutralize(p.pendente.pergunta)}\n</pergunta_pendente>\n<pedido_em_andamento>\n${neutralize(JSON.stringify(p.pendente.conhecido))}\n</pedido_em_andamento>\n`
  : ''
user: `${blocoPendente}<mensagem_cliente>\n${neutralize(redactPii(p.text))}\n</mensagem_cliente>`
```
Prompt v4 = v3 + seção de eventos (`pedido` vs `cancelar` vs `espacos`; `convidados`; `tipoEvento` como o cliente disse; `espaco` como o cliente disse ou `"*"` para "qualquer um") + regra: "quando houver `<pergunta_pendente>`, a mensagem do cliente é a resposta a ela: devolva o item do serviço do `<pedido_em_andamento>` com o campo respondido preenchido, repetindo os campos já conhecidos" + instrução de que o conteúdo das três tags é dado. Parse: `convidados` inteiro 1..10000 ou null, `tipoEvento` ≤ 60, `espaco` ≤ 60.

- [ ] **Step 1: Testes (falham):** `triage-v4.test.ts` (schema estrito; bloco pendente aparece só com `pendente`; `neutralize` aplicado nas três tags; v3 inalterada); `evals/s3/composicao.test.ts` com **≥ 50 casos** (spec §6.1) sobre `resolverAtendimento` com fixture de espaços (crie `evals/s3/fixture.ts` com 2–3 espaços por unidade sobre a fixture do S1) + asserção global "nenhum texto contém confirmad/reservad exceto o handoff de confirmado" + `horasInventadas` do S1 (nenhum horário inventado).
- [ ] **Step 2: Implementar** prompt, parser, casos e `extracao.ts` (≥ 30 frases, incluindo pares `pendente + resposta curta`; meta 95%; teto de custo); opção `--triagem v4` nos `extracao.ts` de S1/S2.
- [ ] **Step 3: Verde:** `pnpm vitest run --project unit packages/ai && pnpm --filter @atd/ai typecheck && pnpm lint`. Camada 1 só com crédito (registre "não rodado — sem crédito").
- [ ] **Step 4: Commit** — "Adiciona a triagem v4 com pergunta pendente e os evals de eventos".

### Task 4: Worker — S3 no pipeline real

**Files:** Modify `apps/worker/src/jobs/process-conversation.ts`; Create `apps/worker/src/jobs/process-conversation-s3.db.test.ts`.

**Mudanças:**
1. `triageV3` → `triageV4`, passando `pendente` quando a conversa tiver pendente não expirado: `pergunta` = texto que o sistema enviou (guardado no pendente), `conhecido` = campos já validados (unidade pelo nome do banco, data ISO, convidados, tipo normalizado, espaço pelo nome do banco). Vale para pendentes S2 (`pessoas`, `unidade`) e S3.
2. Pendente ganha a variante `pedido_evento` (Decisão 2); pendentes antigos continuam válidos.
3. Carregar `espacosAtivos` e `pedidosDoCliente` (relógio da conversa) junto com os avisos; passar a `resolverAtendimento`.
4. `handoff` do resultado ⇒ `novoEstado: 'aguardando_humano'` + `audit 'conversa.handoff_evento'` (mesmo caminho do handoff existente).
5. **Na transação do commit (delicado)**, depois de `alreadyDone`/`humanOwns`, junto do bloco de avisos:
```ts
for (const a of d.acoesS3 ?? []) {
  if (a.tipo === 'registrar_evento') {
    const r = await registrarPedidoEvento(tx, { restaurantId, customerId: ctx.customer.id, unitId: a.unitId, spaceId: a.spaceId, data: a.data,
      convidados: a.convidados, tipo: a.tipoEvento, tipoTexto: a.tipoTexto, observacoes: a.observacoes, nome: ctx.customer.nomePerfil, simulado: ctx.conv.simulada })
    await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_criado', entidade: 'event_request', entidadeId: r.id })
  } else {
    const ok = await cancelarPedidoDoCliente(tx, { restaurantId, customerId: ctx.customer.id, pedidoId: a.pedidoId })
    if (ok) await tx.insert(auditLog).values({ restaurantId, atorTipo: 'ia', acao: 'evento.pedido_cancelado', entidade: 'event_request', entidadeId: a.pedidoId })
    else saidas = trocarTrecho(saidas, a.texto, a.textoSeFalhar)
  }
}
```
(use o mesmo `trocarTrecho` do S2.)

- [ ] **Step 1: Testes (falham)**, padrão `process-conversation-s2.db.test.ts`: pedido completo numa mensagem ⇒ texto "Recebemos seu pedido…" + linha `novo`; coleta em 4 mensagens (sem unidade → lista → toque; "para qual data?" → "dia 20"; "quantos convidados?" → "uns 40"; "tipo?" → "aniversário") com a triagem falsa recebendo `pendente` (asserte que o `user` enviado contém `<pergunta_pendente>`) ⇒ registra; espaço com capacidade insuficiente ⇒ sugestões e nada gravado; "pode ser qualquer um" ⇒ registra sem espaço; cancelar próprio / de outro cliente / confirmado ⇒ handoff (`aguardando_humano`); simulada ⇒ `simulado = true`; humano assumiu antes do commit ⇒ nada gravado; S1/S2 continuam verdes.
- [ ] **Step 2: Implementar.** **Step 3: Verde:** `pnpm vitest run --project db apps/worker && pnpm typecheck && pnpm lint`. **Step 4: Commit** — "Liga os pedidos de evento ao pipeline do worker com coleta guiada".

**Fim do Bloco B → revisão** (foco: Review Focus 1–2, transação, isolamento, nenhum "confirmado").

---

## Bloco C — Painel

### Task 5: Agenda (Previsão + Eventos), fila e detalhe do pedido

**Files:** Create `apps/web/app/(painel)/agenda/{page,loading}.tsx`, `apps/web/app/(painel)/agenda/eventos-actions.ts` (+ teste), `apps/web/components/painel/{eventos,pedido-detalhe}.tsx` (+ testes), `apps/web/lib/schemas/eventos.ts`; Modify `apps/web/app/(painel)/previsao/page.tsx` (vira `redirect('/agenda?aba=previsao&data=…')`; mova a página para `agenda` reaproveitando os componentes de Previsão e as actions existentes), `components/shell/bottom-nav.tsx` (+ teste), `e2e/painel.spec.ts`/`s2.spec.ts` (rótulo "Agenda").

**Comportamento:** abas "Previsão" e "Eventos" (`Abas`). Eventos: filtro de status (chips; padrão `novo` + `em_contato`) e de unidade (só permitidas); itens com selo de status (cores do design system, sem `text-primary`), data `dd/mm/aaaa` + dia da semana, convidados, tipo, unidade/espaço, nome ou "Sem nome", "há X horas". Detalhe (`FolhaFormulario`): dados + observações; **Status** (`Select` só com transições válidas); **Responsável** (`membrosDaEquipe` + "Ninguém"); **Notas internas** (textarea ≤ 2000); **Salvar** (uma action `atualizarPedidoAction(id, { status, responsavelId, notasInternas })`); **Mostrar telefone** (`revelarTelefoneAction(id)` → mostra número com links `tel:` e `https://wa.me/`, some ao fechar; ausente quando `!temTelefone`). Papéis: dono/gerente/atendente (todos trabalham a fila); `revelarTelefoneAction` e `atualizarPedidoAction` com `requireStaff()` (todos os papéis) — a RLS limita a unidade. `transicao_invalida` ⇒ "Esse status não pode mais ser alterado assim." Estado vazio: "Nenhum pedido de evento por aqui. Quando um cliente pedir pelo WhatsApp, ele aparece nesta lista."

- [ ] **Step 1: Testes (falham):** schema (notas > 2000, status inválido); actions (Zod antes do banco; mapeamento de erros; telefone só via action, nunca em props iniciais da página); UI (fila filtra, detalhe mostra só transições válidas, salvar uma vez com duplo clique, Mostrar telefone chama a action e exibe/oculta, atendente vê e trabalha a fila); bottom-nav com "Agenda" e `aria-current` em `/agenda`.
- [ ] **Step 2: Implementar.** **Step 3: Verde:** unit + ui `apps/web`, typecheck, lint, build. **Step 4: Commit** — "Adiciona a Agenda com a fila de pedidos de evento e o telefone sob demanda".

### Task 6: Espaços na unidade, Início, modelos e backlog

**Files:** Create `apps/web/components/painel/{espacos,espaco-form}.tsx` (+ teste), `apps/web/lib/schemas/espacos.ts`; Modify `apps/web/app/(painel)/unidades/[id]/page.tsx` (aba `espacos`), `unidades/actions.ts` (`salvarEspacoAction`), `app/(painel)/page.tsx` (cartão "Pedidos de evento novos" → `/agenda?aba=eventos`), `lib/modelos-tela.ts` (títulos/exemplos das chaves `evento_*`), `lib/action-result.ts` (`chamarAcao` repropaga navegação — Decisão 8, com teste), `app/(painel)/simulador-actions.ts` (auditoria — Decisão 7, com teste).

**Comportamento:** aba "Espaços": lista (nome, "de X a Y pessoas", ativo), "Novo espaço"/editar (`FolhaFormulario`), desativar via switch; schema: nome 1–60, min/max inteiros 1–1000, min ≤ max ("A capacidade mínima não pode ser maior que a máxima."), descrição ≤ 300, condições ≤ 500; dono/gerente editam, atendente só lê. Cartão do Início visível para todos os papéis. Lacuna `eventos:espacos` na aba "Sem resposta": `acaoDaLacuna` (`apps/web/lib/respostas.ts`) ganha a ação `'espacos'`, título "Espaços de evento não cadastrados" e o botão leva à primeira unidade na aba Espaços (`/unidades/<id>?aba=espacos`, ou `/unidades` sem unidade) — com teste.

- [ ] **Step 1: Testes (falham)** para cada item (inclui `chamarAcao` repropagando um erro de redirect do Next e o simulador gravando `audit_log` com as três ações).
- [ ] **Step 2: Implementar.** **Step 3: Verde** (unit + ui web, typecheck, lint, build) e, no fim do bloco, **`pnpm check`**. **Step 4: Commit** — "Adiciona espaços de evento na unidade, o cartão de pedidos no Início e ajustes do painel".

**Fim do Bloco C → revisão** (foco: Review Focus 3–5, layout 360 px, LGPD do telefone).

---

## Bloco D — E2E, docs e verificação

### Task 7: E2E S3, homologação e registros

- [ ] **Step 1: E2E `apps/web/e2e/s3.spec.ts`** (padrão `s2.spec.ts`; triagem falsa devolve itens S3 e ecoa `<pergunta_pendente>`):
  1. Simulador: "quero fazer um aniversário para 40 pessoas na <unidade E2E> dia <amanhã>" ⇒ começa com "Recebemos seu pedido"; o pedido **não** aparece em Agenda → Eventos.
  2. Simulador: coleta em mensagens (sem tipo ⇒ "Qual o tipo do evento?" ⇒ "aniversário") ⇒ "Recebemos seu pedido"; a triagem falsa recebeu `<pergunta_pendente>`.
  3. Painel (dono): Unidade E2E → Espaços → "Novo espaço" (min > max dá erro; depois salva).
  4. Pedido real inserido por SQL (cliente com telefone cifrado) aparece na fila; mudar status para "Em contato", responsável e notas; **Mostrar telefone** exibe o número e grava `evento.telefone_visualizado`.
  5. Atendente vê a fila e muda o status; não vê "Novo espaço".
- [ ] **Step 2:** e2e completo verde (variáveis só no shell, sem worker local).
- [ ] **Step 3: Docs:** `docs/homologacao/etapa-04.md`; PRD (spec §10 + adendo Etapa 04); PLAN (itens da Etapa 04 com data/evidência; "Onde paramos"); CLAUDE "Onde paramos"; `cp CLAUDE.md AGENTS.md`.
- [ ] **Step 4: Verificação final:** `pnpm check` + e2e; banco pronto (`db:migrate`, bootstrap se faltar, `demo:s1`).
- [ ] **Step 5: Commit** — "Adiciona o e2e e o roteiro de homologação da Etapa 04".

**Fim do Bloco D → revisão final da branch → onda única de correções → re-revisão.**

## Medição
O ledger registra início/fim de cada bloco para comparar com a Etapa 03 (~1h30).
