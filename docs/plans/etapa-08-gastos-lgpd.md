# Etapa 08 — Gastos, limites, LGPD e equipe — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** interfaces, regras, testes obrigatórios e decisões; código completo só nos trechos delicados. Revisão por bloco (A–D) + revisão final. Testes de banco em paralelo já são seguros (um banco por processo), mas **dois agentes nunca rodam `test:db` ao mesmo tempo**.

**Goal:** dono configura limites e vê gastos/alertas no painel; simulação com limite próprio; LGPD (fila do titular, exclusão, retenção diária) e convite de equipe.

**Architecture:** migrations (escopo `simulacao`, `budget_alerts`, cotação, funções `security definer` de exclusão e retenção); DAL + Server Actions em Mais (Gastos e limites, Privacidade, Equipe); worker passa a reservar `simulacao` em conversa simulada, grava alertas, agenda a retenção diária e processa convites (chave de serviço só no worker).

**Tech Stack:** igual + `boss.schedule` do pg-boss e o admin do Supabase Auth no worker.

**Spec:** [docs/specs/2026-10-06-etapa-08-gastos-lgpd-design.md](../specs/2026-10-06-etapa-08-gastos-lgpd-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `etapa-08-gastos-lgpd` (da `main` com o PR #10). Nunca `--force`. Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD por tarefa; `pnpm check` e e2e no fim dos blocos C e D.
- Server Actions: `requireStaff(papéis)` + Zod + `ActionResult` + `chamarAcao`; mutações com `audit_log` na mesma transação, **sem PII (nome, e-mail, telefone, texto) no `diff`**.
- Migrations só via `drizzle-kit generate`/`--custom`; nunca editar 0000–0032. Funções `security definer` com `set search_path = ''`, nomes qualificados, `revoke all … from public` e `grant execute` só ao role que precisa (`web_app` para exclusão; `worker_app` para retenção).
- Dinheiro em USD `numeric`; R$ só exibição (US$ × cotação).
- Chave de serviço do Supabase só no worker; nunca no web/navegador/log.
- Nenhuma chamada paga sem reserva (inalterado); conversa simulada reserva no escopo `simulacao`.
- Consultar Context7/docs atuais: `boss.schedule` (pg-boss 12), `auth.admin.inviteUserByEmail` (supabase-js), enum `ADD VALUE` no Postgres 17 (não usar o valor novo na mesma transação da migration).

## Decisões deste plano

1. Escopo novo `simulacao` no enum `budget_scope` (migration gerada à parte, antes de usar o valor). Bootstrap e uma migration de dados criam os limites padrão de `simulacao` (1/dia, 10/mês) para restaurantes existentes.
2. `budget_alerts` (id, restaurant_id, escopo, periodo, inicio_periodo, nivel smallint 80|100, created_at; único por restaurante+escopo+período+início+nível); gravado pelo worker na mesma transação da reserva/liquidação que cruzar o limiar; leitura dono/gerente por RLS.
3. `restaurants.cotacao_usd_brl numeric(10,4) not null default 5.5`; UPDATE só dono (grant de coluna + DAL).
4. Exclusão: `app.excluir_titular(p_customer uuid, p_ator uuid) returns jsonb` (contagens); retenção: `app.aplicar_retencao(p_restaurant uuid, p_agora timestamptz, p_lote int default 5000) returns jsonb`. Ambas checam o `restaurant_id`; a de exclusão confere que o ator é dono/gerente ativo do restaurante.
5. Convite: Server Action grava `staff_invites` (restaurant_id, email, nome, papel, unidades, status `pendente|enviado|erro|aceito`, erro, created_by) e enfileira `equipe.convite`; o worker chama `inviteUserByEmail` (com `redirectTo` do Site URL) e cria/atualiza `staff`. E-mail nunca vai para log/`diff`.
6. Retenção: `boss.schedule('retencao.diaria', '0 3 * * *', {}, { tz: 'America/Sao_Paulo' })` no boot do worker; o handler itera restaurantes.
7. Navegação: Mais ganha "Gastos e limites", "Privacidade (LGPD)" e "Equipe" (dono/gerente; atendente não vê os três).

## Review Focus

1. **Dono baixa o limite abaixo do já gasto** — salva; próximas reservas recusadas (modo econômico); alerta 100% aparece (Task 3).
2. **Simulação estoura o limite próprio** — só a conversa simulada vai para modo econômico; conversa real no mesmo minuto segue respondendo (Task 3).
3. **Exclusão de cliente com conversa aberta em atendimento humano / pedido de evento confirmado** — tudo do cliente some ou é anonimizado; inbox e agenda não quebram; auditoria sem PII (Task 1/5).
4. **Retenção rodando duas vezes no mesmo dia / interrompida no meio** — idempotente, em lotes, sem apagar o que não venceu (Task 1/3).
5. **Convite para e-mail já existente ou papel inválido / atendente tentando convidar** — erro amigável; só dono convida (Task 3/6).

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `packages/db/src/schema/{ops,restaurant}.ts` (+ `staff_invites`), migrations 0033+ (enum, tabelas, grants, funções), `packages/db/src/{painel-gastos,painel-privacidade,painel-equipe}.ts`, `budget.ts` (alertas), `bootstrap.ts` | 1 |
| `packages/core/src/gastos/*` (agregação do relatório, % e nível de alerta, conversão R$) | 2 |
| `apps/worker/src/jobs/{process-conversation,ingest-document}.ts` (escopo simulacao + alertas), `jobs/retencao.ts`, `jobs/convite.ts`, `main.ts`, `packages/db/src/queue.ts` | 3 |
| `apps/web/app/(painel)/mais/gastos/**`, Início (quadro e alertas), barra de alerta | 4 |
| `apps/web/app/(painel)/mais/privacidade/**` | 5 |
| `apps/web/app/(painel)/mais/equipe/**`, simulador (aviso de limite de simulação) | 6 |
| e2e, docs | 7 |

Blocos: **A** = Task 1 · **B** = Tasks 2–3 · **C** = Tasks 4–6 · **D** = Task 7 (+ revisão final).

---

## Bloco A — Banco

### Task 1: Esquema, funções de exclusão/retenção e DAL

**Files:** Modify `packages/db/src/schema/{ops,restaurant}.ts`, `budget.ts`, `bootstrap.ts`, `queue.ts` (filas `equipe.convite`, `retencao.diaria`); Create `packages/db/src/{painel-gastos,painel-privacidade,painel-equipe}.ts` + testes `*.db.test.ts`, `lgpd-funcoes.db.test.ts`, `gastos-rls.db.test.ts`; migrations.

**Interfaces (Produces):**
```ts
// budget.ts
export type NivelAlerta = 80 | 100
export function registrarAlertas(tx: Tx, p: { restaurantId: string; escopo: Escopo; agora: Date }): Promise<NivelAlerta[]> // compara contadores × limites; insere os níveis cruzados (on conflict do nothing); devolve os novos
// painel-gastos.ts
export function lerLimites(db, claims): Promise<{ limites: LimitePainel[]; cotacao: string }>
export function salvarLimite(db, claims, v: { escopo: 'ia'|'simulacao'|'whatsapp'; periodo: 'dia'|'mes'; limiteUsd: string; alertaPct: number }): Promise<ResultadoPainel> // só dono; audita antigo/novo
export function salvarCotacao(db, claims, cotacao: string): Promise<ResultadoPainel> // só dono; 0.5–50
export function resumoGastos(db, claims, agora: Date): Promise<{ hoje: Record<Escopo, string>; mes: Record<Escopo, string>; alertas: AlertaPainel[] }>
export function relatorioMes(db, claims, mes: string /* 'AAAA-MM' */): Promise<LinhasRelatorio> // ai_runs agregados: por dia×simulado, por etapa, por modelo, por unidade, conversas reais
// painel-privacidade.ts
export function listarPedidosTitular(db, claims, p: { status?: StatusDsr[] }): Promise<PedidoTitular[]>
export function resumoAcessoTitular(db, claims, pedidoId: string): Promise<ResumoTitular | null>
export function concluirAcesso(db, claims, pedidoId: string): Promise<ResultadoPainel>
export function executarExclusao(db, claims, pedidoId: string): Promise<ResultadoPainel<{ contagens: Record<string, number> }>> // chama app.excluir_titular
export function negarPedido(db, claims, pedidoId: string, resposta: string): Promise<ResultadoPainel>
export function lerRetencao(db, claims): Promise<RetencaoPainel[]>; export function salvarRetencao(db, claims, v: { dado: DadoRetencao; dias: number }): Promise<ResultadoPainel> // só dono; mínimos
// painel-equipe.ts
export function listarEquipe(db, claims): Promise<MembroEquipe[]>
export function criarConvite(db, claims, v: { email: string; nome: string; papel: 'gerente'|'atendente'; unidades: string[] | 'todas' }): Promise<ResultadoPainel<{ conviteId: string }>> // só dono; 'ja_existe'
export function reenviarConvite(db, claims, conviteId: string): Promise<ResultadoPainel>
export function definirAtivo(db, claims, staffId: string, ativo: boolean): Promise<ResultadoPainel> // não a si mesmo
// worker
export function conviteParaProcessar(db, id: string): Promise<{ email: string; nome: string; papel: string; unidades: string[]; restaurantId: string } | null>
export function concluirConvite(db, id: string, r: { ok: true; userId: string } | { ok: false; erro: string }): Promise<void>
export function restaurantesAtivos(db): Promise<string[]>
```
**Trecho delicado — esqueleto da exclusão (escrever assim, completar as tabelas):**
```sql
create or replace function app.excluir_titular(p_customer uuid, p_ator uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rest uuid; n_msgs int; n_conv int; n_av int; n_ev int;
begin
  select restaurant_id into v_rest from public.customers where id = p_customer for update;
  if v_rest is null then return jsonb_build_object('ja_inexistente', true); end if;
  if not exists (select 1 from public.staff s where s.user_id = p_ator and s.restaurant_id = v_rest and s.ativo and s.papel in ('dono','gerente')) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  delete from public.messages m using public.conversations c where m.conversation_id = c.id and c.customer_id = p_customer;
  get diagnostics n_msgs = row_count;
  delete from public.conversations where customer_id = p_customer; get diagnostics n_conv = row_count;
  update public.attendance_notices set customer_id = null, nome = null, anonimizado = true where customer_id = p_customer; get diagnostics n_av = row_count;
  update public.event_requests set customer_id = null, nome = null, notas_internas = null, tipo_texto = null, observacoes = null, anonimizado = true where customer_id = p_customer; get diagnostics n_ev = row_count;
  update public.data_subject_requests set customer_id = null where customer_id = p_customer; -- o pedido fica, sem vínculo
  delete from public.customers where id = p_customer;
  return jsonb_build_object('mensagens', n_msgs, 'conversas', n_conv, 'avisos', n_av, 'eventos', n_ev);
end $$;
revoke all on function app.excluir_titular(uuid, uuid) from public;
grant execute on function app.excluir_titular(uuid, uuid) to web_app;
```
(Confira FKs reais — `ai_runs.conversation_id` `set null`, `data_subject_requests.customer_id` nullable? ajuste com migration se preciso — e colunas exatas; a DAL marca o pedido `concluido` e audita na mesma transação.)

- [ ] **Step 1: Testes (falham):** RLS/grants (gerente vê gastos, só dono altera limite/cotação/retenção/convida; atendente não vê nada disso); `salvarLimite` audita antigo/novo; `registrarAlertas` (cruza 80 e 100 uma vez só; concorrência); relatório (agregações, simulação à parte, por unidade e "sem unidade"); exclusão (tudo do cliente some/anonimiza; outro cliente intacto; sem permissão; cliente já apagado; com conversa em `humano` e pedido de evento confirmado); retenção (cada regra, lote, idempotência, nada não vencido apagado, simulações > 7 dias); convites (criar, `ja_existe`, reenviar, desativar a si mesmo recusado); bootstrap cria limites de `simulacao`.
- [ ] **Step 2–4:** migrations (enum à parte), funções, DAL; `pnpm vitest run --project db <arquivos> && pnpm typecheck && pnpm lint`; `EXPLAIN` do relatório no relatório.
- [ ] **Step 5: Commit** — "Cria o banco de gastos, alertas, privacidade e equipe".

**Fim do Bloco A → revisão.**

---

## Bloco B — Domínio e worker

### Task 2: Domínio de gastos (`@atd/core/gastos`)
**Interfaces:** `nivelAlerta(gastoMaisReservado: number, limite: number, alertaPct: number): 0 | 80 | 100`; `emReais(usd: string, cotacao: string): string` (centavos arredondados, "R$ 1.234,56"); `formatarUsd(usd: string): string`; `percentual(gasto: string, limite: string): number`.
- [ ] Testes (limites exatos, arredondamento, limite zero recusado) → implementar → `pnpm vitest run packages/core` → commit "Adiciona o domínio de gastos".

### Task 3: Worker — escopo de simulação, alertas, retenção e convites
**Files:** `apps/worker/src/jobs/{process-conversation,ingest-document}.ts`, Create `jobs/retencao.ts`, `jobs/convite.ts` (+ testes db), `main.ts`, `packages/config/src/env.ts` (se precisar de `SITE_URL` para o `redirectTo`).
- [ ] **Regras:** conversa simulada ⇒ `reserveBudget` com escopo `simulacao` (liquidação/estorno idem); após reservar e após liquidar, `registrarAlertas` na mesma transação; sem saldo na simulação ⇒ mesmo caminho do modo econômico, com `audit` `orcamento.sem_saldo_simulacao`; `retencao.diaria` agendada no boot e handler que chama `app.aplicar_retencao` por restaurante e audita `retencao.executada`; `equipe.convite` chama `inviteUserByEmail(email, { redirectTo })` com o cliente admin (chave de serviço), cria `staff` com papel/unidades e marca o convite; erro amigável sem e-mail em log.
- [ ] **Testes (falham):** simulada reserva em `simulacao` e real em `ia`; estouro da simulação não afeta conversa real; alerta gravado ao cruzar; retenção agendada e handler (com banco); convite com cliente admin falso (sucesso, e-mail existente, erro); **estresse do teto:** 20 reservas concorrentes nunca ultrapassam o limite.
- [ ] `pnpm vitest run --project db apps/worker && pnpm typecheck && pnpm lint` → commit "Separa o gasto da simulação, grava alertas e agenda a retenção e os convites no worker".

**Fim do Bloco B → revisão.**

---

## Bloco C — Painel

### Task 4: Gastos e limites + alertas no painel
**Files:** `apps/web/app/(painel)/mais/gastos/{page.tsx,actions.ts,actions.test.ts}`, `components/painel/{limites,relatorio-gastos,alerta-gastos}.tsx`, Início (`spend-card.tsx` com provedor real, R$ e simulação; cartão de alertas), layout (faixa de alerta), Mais (links).
- [ ] Testes de actions (papel, Zod: limite > 0 e ≤ 10 000, alerta 1–100, cotação 0,5–50) e componentes (R$ e US$, faixa de alerta, relatório vazio que ensina) → implementar → commit "Adiciona a tela de gastos e limites com alertas no painel".

### Task 5: Privacidade (titular e retenção)
**Files:** `apps/web/app/(painel)/mais/privacidade/**`, componentes da fila, resumo (copiar/baixar .txt), confirmação dupla da exclusão, prazos de retenção; alerta de prazo no Início.
- [ ] Testes (papéis, exclusão com confirmação, resumo sem telefone salvo clique auditado, retenção com mínimos) → implementar → commit "Adiciona a privacidade com pedidos do titular e retenção".

### Task 6: Equipe e aviso de limite no simulador
**Files:** `apps/web/app/(painel)/mais/equipe/**`; simulador mostra "Limite de simulação atingido hoje — ajuste em Gastos e limites" quando a última resposta veio do modo econômico por `sem_saldo_simulacao`.
- [ ] Testes (só dono convida; e-mail inválido; unidades; reenviar; desativar; não a si mesmo) → implementar → **`pnpm check`** → commit "Adiciona a equipe por convite e o aviso de limite no simulador".

**Fim do Bloco C → revisão.**

---

## Bloco D — E2E e registros

### Task 7: E2E, homologação e registros
- [ ] **E2E `apps/web/e2e/gastos-lgpd.spec.ts`:** dono altera limite e cotação (R$ aparece); limite de simulação baixo ⇒ simulador mostra o aviso e uma conversa "real" inserida por SQL ainda é atendida; alerta aparece; pedido do titular inserido por SQL ⇒ resumo ⇒ exclusão confirmada ⇒ dados somem; retenção chamada direto (função) apaga simulação antiga; convite com worker de e2e (admin falso ou Supabase local) cria membro; gerente não vê "Equipe" de edição; 360 px.
- [ ] **E2E completo verde; docs:** `docs/homologacao/etapa-08.md`, PRD (spec §9 + adendo), PLAN (itens da Etapa 08 com evidência; "Onde paramos"), CLAUDE "Onde paramos", runbook da amostra (convite de equipe pelo painel; limites pelo painel), `cp CLAUDE.md AGENTS.md`.
- [ ] **Verificação final:** `pnpm check` + e2e; banco pronto (`db:migrate`, bootstrap se faltar, `demo:s1`).
- [ ] **Commit** — "Adiciona o e2e e o roteiro de homologação da Etapa 08".

**Fim → revisão final da branch → onda única de correções → re-revisão.**
