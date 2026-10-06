# IA de produção pela OpenAI direto — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** 3 tarefas, revisão por tarefa + revisão final. **Nenhuma chamada real à OpenAI** (o dono não quer gastar agora): só `fetch` falso e o OpenRouter falso/OpenAI falso do e2e.

**Goal:** produção usa a API da OpenAI direto; local continua no OpenRouter grátis; mesmo `LlmClient`, orçamento e evals nos dois.

**Architecture:** `createOpenAiClient` implementa `LlmClient` (Chat Completions + `json_schema` strict, imagem/PDF nativos, reserva entre modelos no código, custo por tabela de preços); fábrica `createLlmClient(env)` escolhe por `AI_PROVIDER`; env validado com regra de produção; evals/smoke usam a fábrica; PRD/runbook atualizados.

**Tech Stack:** igual + OpenAI Chat Completions (`/v1/chat/completions`).

**Spec:** [docs/specs/2026-10-06-openai-producao-design.md](../specs/2026-10-06-openai-producao-design.md). PRD §10 vence conflitos, exceto o invariante de ZDR, que esta spec revisa por decisão do time (registrar no PRD).

## Global Constraints

- Branch `openai-producao` (a partir da `main` com o PR #9). Nunca `--force`. Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nenhuma chamada real à OpenAI nem uso da chave dela** durante o desenvolvimento.
- Nenhum teste removido/afrouxado; `pnpm check` e e2e verdes ao fim.
- Toda chamada paga só com reserva antes; custo sempre calculável (modelo sem preço ⇒ erro no boot).
- `store: false` em toda chamada OpenAI; nada de conteúdo/PII em log; PII redigida antes (já existe).
- OpenRouter continua com `deny` + `zdr` + `require_parameters` (exceto a chave de dev local); produção exige `AI_PROVIDER=openai`.
- Consultar a doc atual da OpenAI (Context7 / developers.openai.com) para: `response_format` json_schema strict, parte `file` de PDF, `image_url`, `max_completion_tokens`, `reasoning_effort`, `usage.prompt_tokens_details.cached_tokens`, `refusal`, códigos de erro; e preços atuais dos modelos da tabela.

## Decisões deste plano

1. Arquivos: `packages/ai/src/openai.ts` (cliente), `packages/ai/src/precos-openai.ts` (tabela + `custoOpenAi(modelo, usage)`), `packages/ai/src/llm.ts` (`createLlmClient(cfg)`), `openrouter.ts` intacto salvo exportar o que for comum.
2. Tabela inicial: `gpt-4.1-mini`, `gpt-4.1`, `gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano` (preços conferidos na doc na data da implementação, com a data no arquivo).
3. Modelos de partida em produção: triagem `gpt-4.1-mini`; cardápio `gpt-4.1-mini,gpt-4.1`.
4. E2E: o servidor falso existente passa a responder também no caminho OpenAI (`/chat/completions` com `store:false`, sem `provider`), e o e2e roda com `AI_PROVIDER=openai` + `OPENAI_BASE_URL` falso para exercitar o caminho de produção (local de desenvolvimento continua OpenRouter).

## Review Focus

1. **Modelo da lista sem preço cadastrado** — worker não sobe em qualquer ambiente com `AI_PROVIDER=openai` (Task 1/2).
2. **429/5xx no primeiro modelo** — passa ao segundo; esgotou ⇒ `retryable: true` e a reserva é estornada pelo chamador como hoje (Task 1).
3. **Resposta com `refusal` ou JSON fora do esquema** — `saida_invalida`, sem quebrar a triagem (Task 1).
4. **PDF/imagem grandes** — mesmo limite de hoje; corpo montado sem duplicar base64 em log (Task 1).
5. **`.env` local antigo sem `AI_PROVIDER`** — continua funcionando como OpenRouter (Task 2).

---

### Task 1: Cliente OpenAI e tabela de preços (`@atd/ai`)

**Files:** Create `packages/ai/src/{openai.ts,openai.test.ts,precos-openai.ts,precos-openai.test.ts,llm.ts,llm.test.ts}`; Modify `packages/ai/src/index.ts`.

**Interfaces:**
```ts
export function createOpenAiClient(cfg: { apiKey: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }): LlmClient
export type PrecoModelo = { entrada: number; cache: number; saida: number } // USD por 1M tokens
export const PRECOS_OPENAI: Record<string, PrecoModelo>; export const PRECOS_CONSULTADOS_EM: string // 'AAAA-MM-DD'
export function custoOpenAi(modelo: string, u: { tokensIn: number; tokensCache: number; tokensOut: number }): string | null // null se fora da tabela; tokensIn inclui o cache (desconta)
export function modelosSemPreco(modelos: string[]): string[]
export type ProvedorIa = 'openrouter' | 'openai'
export function createLlmClient(cfg: { provider: 'openrouter'; apiKey: string; baseUrl?: string; semZdrDev?: boolean; timeoutMs?: number } | { provider: 'openai'; apiKey: string; baseUrl?: string; timeoutMs?: number }): LlmClient
```
- [ ] **Step 1: Testes (falham)** com `fetch` falso: corpo (`model`, `store:false`, `response_format` strict com nome/esquema, `max_completion_tokens`, sem `provider`/`plugins`/`models`); imagem `image_url` data URL; PDF parte `file`; `reasoning_effort` só para `gpt-5*`/`o*` quando `reasoning !== true`; sucesso ⇒ `data` validada pelo `parse`, `model`, `usage` com cache, `costUsd` pela tabela; reserva: 429/500/timeout no 1º ⇒ 2º; 400 de requisição inválida ⇒ para; `refusal` ⇒ `saida_invalida`; `finish_reason: length` ⇒ `saida_truncada` (não tenta o próximo); JSON inválido ⇒ `saida_invalida`; erro sem conteúdo em log; `custoOpenAi` (cache descontado, arredondamento em micros, modelo desconhecido ⇒ null); `createLlmClient` escolhe a implementação.
- [ ] **Step 2–3:** implementar; `pnpm vitest run --project unit packages/ai && pnpm typecheck && pnpm lint`.
- [ ] **Step 4: Commit** — "Adiciona o cliente da OpenAI com tabela de preços".

### Task 2: Escolha do provedor no worker, evals, smoke e e2e

**Files:** Modify `packages/config/src/env.ts` (+ teste), `apps/worker/src/main.ts`, `apps/worker/src/smoke-openrouter.ts` → `smoke-ia.ts` (+ teste, script `smoke:ia:prod`), `apps/worker/scripts/*`, evals `packages/ai/evals/*/extracao.ts` e `ingestao/leitura.ts` (cliente pela fábrica + `--provider`), `packages/ai/package.json` (`eval:prod`), `apps/web/e2e/{openrouter-falso.ts,worker.ts}`, `.env.example`.

- [ ] **Step 1: Testes (falham):** env — sem `AI_PROVIDER` ⇒ `openrouter` exigindo `OPENROUTER_API_KEY`; `openai` exige `OPENAI_API_KEY` e não exige a do OpenRouter; `NODE_ENV=production` com `openrouter` ⇒ erro; `openai` com modelo fora da tabela ⇒ erro listando os modelos; smoke com os dois provedores; e2e falso aceita o caminho OpenAI.
- [ ] **Step 2–3:** implementar (worker cria o cliente por `createLlmClient`; log de boot diz o provedor sem segredo; `eval:prod` = S1–S4 + frustração com `--env-file=../../.env.worker-producao` e `AI_PROVIDER=openai`); e2e com `AI_PROVIDER=openai` + base falsa; `pnpm check` + e2e.
- [ ] **Step 4: Commit** — "Escolhe o provedor de IA por ambiente e usa a OpenAI em produção".

### Task 3: PRD, runbook da amostra e registros

**Files:** Modify `PRD.md` (stack §2, invariante de ZDR §10, adendo), `docs/runbooks/producao-amostra.md` (passo OpenRouter → OpenAI: projeto com limite de gasto, liberar modelos, chave do projeto, `smoke:ia:prod`, `eval:prod`; tabela de variáveis), `scripts/producao/verificar.sh` (variáveis por provedor), `docs/runbooks/deploy.md` (apontador), `PLAN.md` (item desta mudança + Etapa 09: política/RIPD com OpenAI, avaliar ZDR), `CLAUDE.md` (stack e regra de LGPD revistas; "Onde paramos") + `cp CLAUDE.md AGENTS.md`.
- [ ] **Step 1:** atualizar docs; `verificar.sh` testado contra o local (OK com env OpenAI de exemplo; FALHA provocado sem `OPENAI_API_KEY`).
- [ ] **Step 2:** `pnpm check` + e2e verdes.
- [ ] **Step 3: Commit** — "Atualiza o PRD e o runbook para a IA de produção na OpenAI".

**Fim → revisão final → onda única de correções → re-revisão.**
