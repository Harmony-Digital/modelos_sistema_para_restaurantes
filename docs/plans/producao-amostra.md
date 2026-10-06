# Testes mais rápidos + amostra em produção — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** 3 tarefas, revisão por tarefa (curta) + revisão final. Testes de banco nunca em paralelo com outro agente.

**Goal:** `pnpm check` em ~2 min sem perder testes, e tudo pronto para publicar uma amostra (painel + simulador) num único ambiente de produção.

**Architecture:** vitest `globalSetup` cria um banco modelo migrado e um banco clonado por worker (`CREATE DATABASE … TEMPLATE`), liberando paralelismo no projeto `db`; reset mais barato; produção sem Meta (variáveis aleatórias), limite de upload configurável para a Vercel, demo aplicável em produção por env dedicado e runbook curto.

**Tech Stack:** Vitest 5 (projects, globalSetup, `VITEST_POOL_ID`), Postgres 17 local (Supabase CLI), Drizzle migrator, Next.js 16, Docker, OpenRouter.

**Spec:** [docs/specs/2026-10-06-producao-amostra-design.md](../specs/2026-10-06-producao-amostra-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `producao-amostra` (a partir da `main` com o PR #8). Nunca `--force`. Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Nenhum teste removido, pulado ou afrouxado**; contagem de testes do `pnpm check` igual ou maior que 1928.
- Segredos nunca em arquivo versionado nem em log; `.env*` nunca commitado; chave de serviço só no shell/arquivo de env fora do git.
- Produção exige ZDR: `OPENROUTER_DEV_SEM_ZDR` continua recusada com `NODE_ENV=production`.
- Nada sai pela Meta na amostra; o webhook continua exigindo HMAC válido.
- Consultar Context7/docs atuais antes de usar opção de biblioteca (vitest globalSetup/`provide`/`fsModuleCache`, Next/Vercel).

## Decisões deste plano

1. Banco modelo `atd_test_template` (migrado pelo migrator do Drizzle, como `pnpm db:migrate`) e bancos `atd_test_<VITEST_POOL_ID>` clonados no `globalSetup` do projeto `db` (ou na primeira chamada de `getTestDb()` por worker, com trava `pg_advisory_lock`). URL base: `TEST_DATABASE_URL` ou a padrão `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Os bancos clonados são recriados a cada rodada (drop + create) — sem estado entre rodadas.
2. Paralelismo do projeto `db`: `fileParallelism: true`, `maxWorkers` = `ATD_DB_WORKERS ?? 4`.
3. O worker do e2e e o `next dev` continuam no banco `postgres` (nada muda para o e2e).
4. Limite de upload: `NEXT_PUBLIC_LIMITE_UPLOAD_MB` (inteiro 1–20, padrão 20) lido em `apps/web/lib/arquivo-cardapio.ts`; mensagens usam o número ("O arquivo passa de 4 MB…"). Runbook manda `4` na Vercel.
5. `demo:s1` e `bootstrap` ganham variantes `demo:s1:prod`/`bootstrap:prod` que leem `../../.env.production-bootstrap` (nunca o `.env` local) e recusam rodar se o arquivo não existir.

## Review Focus

1. **Testes de banco que dependem de ordem ou de dados globais** (ex.: `auth.users`, filas do pg-boss, Realtime) quebrando com paralelismo — cada worker tem banco próprio; rodar a suíte `db` 3× seguidas sem falha intermitente (Task 1).
2. **Rodada interrompida deixando bancos `atd_test_*` presos/abertos** — próxima rodada derruba e recria (`drop database … with (force)`) (Task 1).
3. **CI com menos CPU** — `ATD_DB_WORKERS` configurável; CI usa 2 (Task 1).
4. **Upload de 4–20 MB em produção** — recusado no cliente e no servidor com a mensagem do limite configurado, antes de chegar ao corpo da Vercel (Task 2).
5. **`demo:s1:prod` rodado sem o arquivo de produção** — falha com mensagem clara, nunca cai no `.env` local (Task 2).

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `vitest.config.ts`, `packages/db/src/test-utils.ts`, novo `packages/db/test/global-setup.ts`, `.github/workflows/ci.yml`, `package.json` | 1 |
| `apps/web/lib/arquivo-cardapio.ts` (+ teste), `components/painel/{arquivos-cardapio,importar}.tsx`, `lib/server/upload-arquivo.ts`, `packages/db/package.json` (scripts prod), `.env.example` | 2 |
| `docs/runbooks/producao-amostra.md`, `scripts/producao/verificar.sh`, `docs/runbooks/deploy.md` (apontador), PLAN, CLAUDE/AGENTS | 3 |

---

### Task 1: Testes de banco em paralelo e reset barato

**Files:** Create `packages/db/test/global-setup.ts`; Modify `vitest.config.ts` (projeto `db`), `packages/db/src/test-utils.ts`, `.github/workflows/ci.yml`, `package.json` (se preciso).

**Interfaces:** `getTestDb()` mantém a assinatura; passa a apontar para o banco do worker. `resetDb(sql)` mantém a assinatura.

- [ ] **Step 1: Medir a linha de base** (anote no relatório): `time pnpm test:db` e `time pnpm test` (2 rodadas), e o tempo de um `resetDb` isolado (script ou teste temporário com `performance.now()`); investigar o `TRUNCATE` lento visto em 06/10 (ex.: `pg_stat_activity`/locks, tamanho de `pgboss.job`/`realtime.messages`/`audit_log`) e registrar a causa.
- [ ] **Step 2: Global setup** — conecta no banco base como `postgres`; `drop database if exists atd_test_template with (force)`; `create database atd_test_template`; roda as migrations nele (mesmo migrator/pasta de `pnpm db:migrate`); para `n` em 1..`maxWorkers`: `drop … with (force)` + `create database atd_test_<n> template atd_test_template`. `test-utils.ts`: URL do worker = base com o nome do banco trocado por `atd_test_${process.env.VITEST_POOL_ID}` (fallback para o base se a variável não existir, para scripts avulsos). Confirme no Context7 os nomes `globalSetup` por projeto e `VITEST_POOL_ID` no Vitest 5. Atenção: roles `web_app`/`worker_app`, schema `auth`/`storage` e extensões são do cluster ou do banco — garanta que o clone tem tudo que os testes usam (rode a suíte inteira).
- [ ] **Step 3: Reset barato** — medir alternativas (`truncate` único sem `restart identity`; `delete` em ordem de FK; `truncate` só das tabelas com linhas via `pg_stat_user_tables.n_live_tup`/`n_tup_ins`) e ficar com a mais rápida que mantém os testes verdes. Se algum teste depender de ids reiniciados (`restart identity`), ajuste o teste para não depender (sem afrouxar o que ele verifica) ou mantenha `restart identity` só onde precisa.
- [ ] **Step 4: Paralelismo** — projeto `db`: `fileParallelism: true`, `maxWorkers: Number(process.env.ATD_DB_WORKERS ?? 4)`, `globalSetup`. Cache: `fsModuleCache` (ou equivalente atual do Vitest 5) ligado no config raiz.
- [ ] **Step 5: Verificar** — `pnpm test:db` **3× seguidas** verdes; `pnpm check` verde com contagem ≥ 1928; tempos antes/depois no relatório (meta: `pnpm check` ~2 min). CI: `ATD_DB_WORKERS=2` no passo `test:db`; timeout do job revisto.
- [ ] **Step 6: Commit** — "Roda os testes de banco em paralelo com um banco por processo".

### Task 2: Limite de upload configurável e comandos de produção

**Files:** Modify `apps/web/lib/arquivo-cardapio.ts` (+ teste), `apps/web/components/painel/arquivos-cardapio.tsx`, `apps/web/components/painel/importar.tsx`, `apps/web/lib/server/upload-arquivo.ts`, `packages/db/package.json`, `.env.example`.

```ts
// apps/web/lib/arquivo-cardapio.ts
const mb = Number(process.env.NEXT_PUBLIC_LIMITE_UPLOAD_MB ?? 20)
export const LIMITE_ARQUIVO_MB = Number.isInteger(mb) && mb >= 1 && mb <= 20 ? mb : 20
export const LIMITE_ARQUIVO_BYTES = LIMITE_ARQUIVO_MB * 1024 * 1024
export const MENSAGEM_LIMITE = `O arquivo passa de ${LIMITE_ARQUIVO_MB} MB. Envie um PDF menor ou uma foto.`
```
(Todas as mensagens de tamanho passam a usar `MENSAGEM_LIMITE`; o `bodySizeLimit`/`proxyClientMaxBodySize` de 21 MB continuam — a Vercel corta antes em ~4,5 MB, por isso o limite de 4 no cliente e no servidor.)

```json
// packages/db/package.json — scripts
"bootstrap:prod": "node --env-file=../../.env.production-bootstrap scripts/bootstrap.ts",
"demo:s1:prod": "node --env-file=../../.env.production-bootstrap scripts/demo-s1.ts"
```
(`node --env-file` com arquivo ausente já falha; confira e, se não falhar, adicione checagem no script.) `.env.example`: `NEXT_PUBLIC_LIMITE_UPLOAD_MB` comentado ("4 na Vercel") e nota de que a amostra usa valores aleatórios para `WHATSAPP_*`.

- [ ] **Step 1: Testes (falham):** limite padrão 20; com env 4 ⇒ 4 MB e mensagem com "4 MB"; valores inválidos (0, 25, "abc") ⇒ 20; validação do servidor e dos componentes usam a mesma mensagem.
- [ ] **Step 2–3:** implementar; `pnpm vitest run --project unit --project ui apps/web && pnpm typecheck && pnpm lint`; conferir `pnpm --filter @atd/db demo:s1:prod` sem o arquivo ⇒ erro claro.
- [ ] **Step 4: Commit** — "Torna o limite de upload configurável e adiciona os comandos de produção".

### Task 3: Runbook da amostra, modelos de IA e verificação de produção

**Files:** Create `docs/runbooks/producao-amostra.md`; Modify `docs/runbooks/deploy.md` (apontador no topo), `PLAN.md`, `CLAUDE.md` + `cp CLAUDE.md AGENTS.md`.

- [ ] **Step 1: Modelos com ZDR** — consultar a API do OpenRouter (endpoints por modelo; filtro de provedores com ZDR) e escolher: triagem (barato, structured outputs, com provedor ZDR) e leitura de cardápio (imagem + PDF nativo, structured outputs, ZDR). Registrar no runbook com o custo estimado por conversa e por importação, e a observação "confirmar com o smoke test após pôr crédito".
- [ ] **Step 2: Runbook** (curto, numerado, em PT-BR, para quem publica): 1) Supabase sa-east-1, **Postgres 17**, Auth (sem cadastro público, TOTP, senha ≥ 12, Site URL/Redirect, template de convite), Data API sem schemas expostos, Realtime (canais privados autorizados por RLS — conferir a configuração "allow public access" do projeto), Storage (buckets `cardapio`/`importacoes` privados criados pela 0027); 2) migrations 0000–0032 pela conexão direta de admin; 3) senhas de `web_app`/`worker_app`; 4) `.env.production-bootstrap` (fora do git, `chmod 600`) + `bootstrap:prod` + `demo:s1:prod`; 5) Vercel (Root `apps/web`, `gru1`, variáveis do `webEnvSchema` + `NEXT_PUBLIC_LIMITE_UPLOAD_MB=4`, `WHATSAPP_*` aleatórios); 6) OpenRouter (chave com `limit` mensal, Guardrail com ZDR, crédito ~US$ 10, modelos do Step 1); 7) VPS + worker (workflow `Worker deploy`, `.env` do worker com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_TRIAGE_MODELS`, `AI_INGEST_MODELS`, `WHATSAPP_*` aleatórios, **sem** `OPENROUTER_DEV_SEM_ZDR`); 8) checklist final (login com TOTP; Início "IA: Online"; simulador responde S1–S4; inbox recebe handoff em tempo real; importar CSV; gerente restrito vê só a sua unidade); 9) o que **não** está na amostra (Meta, staging, itens da Etapa 09) com link para `deploy.md`.
- [ ] **Step 2b: Runbook executável por outro agente (pedido do dono, 06/10/2026):** quem publica é **outra pessoa, com acesso à Vercel e ao VPS da empresa, usando o Claude Code**. O runbook é escrito para esse agente seguir sozinho, com o humano só para o que exige acesso/segredo:
  - topo com **"Para o agente que vai publicar"**: ordem de leitura, regras (nunca commitar segredo, nunca `--force`, parar e pedir ao humano em cada ponto marcado 🔑), e o resultado esperado;
  - cada passo com: **pré-condição verificável**, **comando exato** (ou caminho exato no painel web, quando não houver CLI), **verificação com saída esperada** e **o que fazer se falhar**; passos que só o humano pode fazer (criar projeto, gerar chaves, colar segredos, aprovar deploy) marcados 🔑 com o que o agente deve pedir;
  - tabela de **todas as variáveis** por destino (Vercel, `.env` do worker no VPS, `.env.production-bootstrap`): nome, obrigatória?, de onde vem, exemplo de formato (sem valor real);
  - script **`scripts/producao/verificar.sh`** (só leitura, sem imprimir segredos) que o agente roda para checar: variáveis presentes por destino (recebe o caminho do arquivo de env), versão do Postgres e migrations aplicadas (`__drizzle_migrations` = 33 entradas 0000–0032), buckets `cardapio`/`importacoes` privados, roles `web_app`/`worker_app` com login, restaurante e demo presentes, e `curl` no domínio (`/login` 200); saída `OK/FALHA` por item e código de saída ≠ 0 se algo falhar; teste do script com um env de exemplo;
  - **checklist final** com evidência a colher (comandos e o que anotar) e um modelo de mensagem de "pronto" para o agente devolver ao humano;
  - `CLAUDE.md`/`AGENTS.md`: seção curta **"Deploy da amostra"** apontando para `docs/runbooks/producao-amostra.md` (o agente de quem publica lê o CLAUDE.md primeiro).
- [ ] **Step 3: Verificação local de produção** — `docker build -f apps/worker/Dockerfile .` (sucesso); `pnpm build`; ensaio: rodar a imagem (ou `node`) do worker com `NODE_ENV=production`, `OPENROUTER_DEV_SEM_ZDR=1` ⇒ recusa no boot; sem a chave ⇒ sobe e loga `worker iniciado` contra o banco local com `WHATSAPP_*` aleatórios. Registrar comandos e saídas (sem segredos) no relatório. `pnpm check` + e2e completo verdes.
- [ ] **Step 4: Registros** — PLAN: seção "Amostra em produção (06/10/2026)" com itens marcados e evidência, e o que ficou para a Etapa 09; "Onde paramos" (PLAN e CLAUDE) com entrada no topo; `cp CLAUDE.md AGENTS.md`.
- [ ] **Step 5: Commit** — "Adiciona o runbook da amostra em produção".

**Fim → revisão final da branch → onda única de correções → re-revisão.**
