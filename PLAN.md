# PLAN — roteiro de construção

> **Coração da construção.** Tudo o que foi feito e o que falta, em etapas e checklist.
> Regras técnicas: [PRD.md](PRD.md). Como trabalhar: [CLAUDE.md](CLAUDE.md).
> Ao concluir um item: marcar `[x]` com **data e evidência** (commit, teste, URL).
> Trabalho fora deste plano entra primeiro aqui como item, depois é executado.

## Onde paramos

- **05/10/2026** — Plano 02-C implementado (painel de S1, simulador ligado ao pipeline real, e2e). Revisão final da branch feita e leva de correções aplicada (`f008e26..5e809ed`; `pnpm check` com 782 testes; e2e 19/19). Homologação em docs/homologacao/etapa-02c.md. Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem; Postgres 17 no Supabase hospedado. Próximo: homologação do dono e fechamento da Etapa 02.
- **05/10/2026** — Plano 02-C escrito (`docs/plans/etapa-02c-painel-simulador.md`, 15 tarefas: banco do painel com RLS/auditoria e initplan por unidade, telas Unidades/Respostas/Início/Restaurante, simulador ligado ao pipeline real com canal sem Meta e relógio simulado, e2e com worker real e OpenRouter falso). Próximo: revisão do dono e execução.
- **05/10/2026** — Plano 02-B (dados por unidade, feriados, resolução/composição, triage-v2, lacunas, localização/lista, evals; camada 2 com 101 casos) implementado. Pendente: chave do OpenRouter para escolher o modelo de triagem (`docs/homologacao/etapa-02b.md`). Leva final de correções aplicada (`pnpm check` com 661 testes). Próximo: plano 02-C.
- **05/10/2026** — Homologação local do 02-A aprovada pelo dono, com dois ajustes: cartões da Início sem vazar no celular e quadro **Gastos** (IA e WhatsApp, hoje e no mês). Repositório publicado em `Harmony-Digital/modelos_sistema_para_restaurantes` (branches `main`, `etapa-01-fundacao`, `etapa-02-s1`); PRs abertos para a `main` — mesclar primeiro o da Etapa 01. Próximo: plano 02-B.
- **05/10/2026** — Plano 02-A (design system, navegação, formulários, convite/definir senha, Devolver à IA, casca do simulador) implementado; projeto Playwright `celular` com 15 testes verdes e docs da Etapa 01 fechados. Revisão final da branch feita (sem críticos) e leva de correção aplicada (`d10cfff..9ec0da2`; `pnpm check` com 427 testes). Próximo: plano 02-B (dados por unidade, feriados, resolução, triage-v2, lacunas, evals).
- **05/10/2026** — Revisão final da branch inteira feita (sem críticos) e uma leva de correção aplicada (até `d600d25`; `pnpm check` com 250 testes em 29 arquivos). Ficaram 2 correções de documentação (itens abaixo, na Etapa 01). **Repositório no GitHub ainda não existe** (sem permissão na organização) — procedimento em [docs/runbooks/publicar-repositorio.md](docs/runbooks/publicar-repositorio.md); backup em bundle local. Registro completo da execução em [docs/historico/etapa-01-ledger.md](docs/historico/etapa-01-ledger.md). Próximo: refinamento da Etapa 02 (em paralelo à publicação, staging e homologação).
- **05/10/2026** — Etapa 01 **implementada e revisada tarefa a tarefa** (`etapa-01-fundacao`, 683bf9c..77dab37; `pnpm check` verde com 240 testes em 27 arquivos; e2e do web 4/4). Roteiro de homologação em [docs/homologacao/etapa-01.md](docs/homologacao/etapa-01.md). Próximo: deploy em staging (docs/runbooks/deploy.md) + homologação do dono; depois refinamento da Etapa 02, incluindo o design system.
- **05/10/2026** — Etapa 01 (arquitetura e stack) **definida e aprovada**; PRD v1.0, PLAN e CLAUDE.md escritos; **plano detalhado da Etapa 01 escrito** em [docs/plans/etapa-01-fundacao.md](docs/plans/etapa-01-fundacao.md) (21 tarefas). Próximo passo: revisão do plano pelo dono e escolha do modo de execução; depois Task 1.
- **05/10/2026** — Modelos de triagem (provisórios, definitivos nos evals da Etapa 02; consulta à API pública de modelos): principal `mistralai/mistral-nemo` (US$ 0,019/M entrada, 0,03/M saída), fallback `google/gemini-2.5-flash-lite` (US$ 0,10/M entrada, 0,40/M saída); ambos com saída estruturada. Gravados em `AI_TRIAGE_MODELS` no `.env` local.

## Ciclo de cada etapa

1. **Refinamento** — perguntas e decisões específicas da etapa (bibliotecas, telas, regras). Consultar documentação atual (Context7) antes de escrever código. Decisões registradas no PRD.
2. **Plano detalhado** — `docs/plans/etapa-NN-<nome>.md` com tarefas pequenas, arquivos, testes e critérios de aceite.
3. **Execução** — TDD; cada tarefa termina com testes verdes e commit.
4. **Verificação** — lint, typecheck, testes, evals (quando houver IA), build; revisão de segurança dos pontos tocados.
5. **Homologação pelo dono** — roteiro de teste manual; aprovação explícita encerra a etapa.

## Protocolo para outra IA continuar

Ler CLAUDE.md → este arquivo → PRD.md → plano detalhado da etapa corrente. Escolher o próximo item não marcado, executar exatamente o descrito, testar o caso ruim, marcar com evidência, atualizar "Onde paramos" e `cp CLAUDE.md AGENTS.md` se tocou no CLAUDE.md. Nada depende de memória de conversa.

---

## Paralelo (sem bloquear etapas)

- [ ] **P4** — Verificação da empresa no Meta Business + número oficial do WhatsApp (dono; leva dias)
- [ ] **P1** — Confirmar datacenter da VPS Hostinger
- [ ] **P2/P5** — Jurídico: prazos de retenção, política de privacidade, LIA, RIPD
- [ ] Contratar/confirmar: Vercel Pro, projeto Supabase prod (sa-east-1) + staging, conta OpenRouter (key de produção + Guardrail), Sentry

---

## Etapa 01 — Fundação ⏳ (arquitetura aprovada 05/10/2026)

**Objetivo:** o esqueleto inteiro funcionando ponta a ponta com segurança, sem nenhum dos 4 serviços ainda.

**Critério de pronto:** mensagem real no número de teste recebe resposta; "como está o tempo?" é barrado **sem chamar o modelo principal**; testes de RLS e de reserva concorrente passando; deploy de web e worker automatizado.

- [x] Arquitetura e stack definidas (PRD §2) — 05/10/2026
- [x] PRD.md, PLAN.md, CLAUDE.md/AGENTS.md — 05/10/2026
- [x] Plano detalhado `docs/plans/etapa-01-fundacao.md` (21 tarefas, TDD) — 05/10/2026
- [x] Monorepo: pnpm + Turborepo, `packages/config` (tsconfig strict, eslint, env Zod) — 05/10/2026, commits 683bf9c..bcbf374
- [x] Supabase CLI local; extensões `pg_trgm`, `unaccent` (`pg_cron` entra na Etapa 08, com a retenção) — 05/10/2026, commits bcbf374..36456bb
- [x] `packages/db`: schema base (restaurants, units, staff, customers, conversations, messages, ai_runs, budget_*, spend_ledger, audit_log, data_subject_requests, retention_settings, worker_heartbeats) + policies RLS + role `worker_app` — 05/10/2026, commits `36456bb..123cb85` (schema, Tasks 4–5), `50140d5..4e51dec` (RLS e roles, Task 7), `339de6f..9a4ea51` (orçamento, Task 10)
- [x] Cliente DB com contexto RLS **parametrizado**; testes de RLS por papel — 05/10/2026, commits `123cb85..50140d5` (cliente com contexto parametrizado); `50140d5..4e51dec` (policies RLS e testes por papel)
- [x] `apps/web`: Next.js 16, auth Supabase com MFA, papéis, layout mínimo do painel, headers de segurança — 05/10/2026, commits `fcc5504..463142a` (e2e 4/4); bootstrap e /privacidade `463142a..47c0e04`
- [x] `packages/whatsapp`: HMAC, schemas Zod do webhook, cliente de envio (texto) — 05/10/2026, commits 9a4ea51..1f7453f
- [x] Webhook: verificação GET, POST com HMAC → transação (customer, conversation, message idempotente, `sendDebounced`) — 05/10/2026, commits `d0b918e..a02f4f1` (ingestão, Task 13) e `41c9e58..8c64115` (rota, Task 15)
- [x] `apps/worker`: pg-boss (filas, singleton, DLQ), heartbeat, shutdown gracioso, Dockerfile não-root — 05/10/2026, commits a02f4f1..41c9e58
- [x] `packages/core`: pré-filtro (humano, saudação, flood, LGPD, mídia não suportada), redação de PII, orçamento atômico (+ teste concorrente) — 05/10/2026, commits 4e51dec..9a4ea51 (pré-filtro, PII, orçamento + teste concorrente)
- [x] `packages/ai`: cliente OpenRouter (`dataCollection: 'deny'`, fallback, registro de `usage.cost`), triagem com `json_schema`, resposta fixa de fora de escopo — 05/10/2026, commits `1f7453f..d0b918e` (testes unitários com fetch falso)
- [ ] Smoke test real + roteamento ZDR dos modelos de triagem — pendente: precisa da key do OpenRouter
- [x] Aviso LGPD na primeira interação + página pública de política (rascunho) — 05/10/2026, commits 463142a..47c0e04 (/privacidade) e 8c64115..fcc5504 (aviso no worker)
- [x] Sentry (web + worker) com scrub de PII — 05/10/2026, commits 47c0e04..023cce5
- [ ] CI GitHub Actions (lint, typecheck, test, build); deploy Vercel; imagem GHCR + deploy VPS — workflows escritos (commits 434f157, d28f8d9..77dab37); pendente: CI verde no GitHub, deploy Vercel, imagem GHCR e deploy na VPS (dependem da nuvem)
- [ ] Hardening VPS (UFW, fail2ban, unattended-upgrades, usuário de deploy) — script e runbook escritos (commits d28f8d9..77dab37); pendente: executar na VPS
- [ ] Homologação do dono — pendente: roteiro em [docs/homologacao/etapa-01.md](docs/homologacao/etapa-01.md) pronto; depende de staging + número de teste Meta + key OpenRouter

### Pendências que fecham a Etapa 01
- [x] (05/10/2026, Task 13) Doc: `docs/homologacao/etapa-01.md` passo 9 — usar `updateUserById(id, { password, email_confirm: true })` (sem isso o dono convidado não entra no Supabase hospedado)
- [x] (05/10/2026, Task 13) Doc: `docs/runbooks/deploy.md` "Release regular" — desligar o deploy automático de produção da Vercel na `main` (produção só via promoção, depois da migration)
- [x] Publicar o repositório (`docs/runbooks/publicar-repositorio.md`) e abrir o PR `etapa-01-fundacao → main` — 05/10/2026, [Harmony-Digital/modelos_sistema_para_restaurantes](https://github.com/Harmony-Digital/modelos_sistema_para_restaurantes)
- [x] Página para o usuário convidado definir a senha — 05/10/2026 (Task 10 do 02-A, `/definir-senha`; E2E em `apps/web/e2e/convite.spec.ts`)

## Etapa 02 — Horários, funcionamento e unidades (S1) + design system
Spec aprovada: [docs/specs/2026-10-05-etapa-02-s1-design.md](docs/specs/2026-10-05-etapa-02-s1-design.md)
- [x] Refinamento (abordagem A: IA extrai lista de itens, código responde; lacunas; design system Harmony escuro; simulador de WhatsApp; formulários componentizados) — 05/10/2026
- [x] Plano 02-A (05/10/2026; commits d10cfff..9ec0da2; `pnpm check` verde com 427 testes em 52 arquivos; e2e celular 15/15; revisão final sem críticos) — design system, layout/navegação, componentes de formulário, Definir senha, Devolver à IA, casca do simulador, docs pendentes da Etapa 01 — plano escrito em [docs/plans/etapa-02a-design-system.md](docs/plans/etapa-02a-design-system.md) (13 tarefas). Pendentes herdados: scanners de e-mail podem consumir o link de convite (página intermediária de confirmação é acompanhamento), validade do OTP no painel Supabase = 1 h
- [x] Ajustes da homologação do 02-A: cartões da tela Início sem vazar no celular; quadro **Gastos** com IA e WhatsApp (API oficial), hoje e no mês — 05/10/2026 (ver commit "Mostra gastos de IA e do WhatsApp…")
- [x] Plano 02-B (05/10/2026; commits 06803a8..até o commit desta leva final de correções; `pnpm check` verde com 661 testes em 73 arquivos; camada 2 com 101 casos) — dados + RLS por unidade, feriados, resolução/composição, triage-v2, lacunas, localização/lista, evals — plano escrito em [docs/plans/etapa-02b-s1-resolucao.md](docs/plans/etapa-02b-s1-resolucao.md) (14 tarefas; código puro validado antes: 166 testes, 101 casos de avaliação)
- [ ] Escolha do modelo de triagem — camada 1 dos evals (precisa da OPENROUTER_API_KEY; confirmar ZDR do endpoint e o schema com tipo nulo no provedor)
- [x] Plano 02-C (05/10/2026; commits 3775617..79f8ab7 + leva final de correções f008e26..5e809ed; `pnpm check` com 782 testes em 99 arquivos; e2e 19/19) — painel de S1 (Unidades, Horários, Exceções, Respostas, Início, Restaurante) e simulador ligado ao pipeline real — plano em [docs/plans/etapa-02c-painel-simulador.md](docs/plans/etapa-02c-painel-simulador.md); homologação em [docs/homologacao/etapa-02c.md](docs/homologacao/etapa-02c.md)
  - Pendências menores do 02-C (revisões; não bloqueiam): `chamarAcao` deve repropagar o erro de redirect do Next (`unstable_rethrow`); RLS não isola simulações entre membros da equipe (só a aplicação filtra); mutações do simulador (abrir, novo cliente, relógio) sem `audit_log`; "Ver detalhes" sem itens extraídos; selo "Personalizado" para modelo antigo inválido; clique duplo concorrente em "Salvar horários" dá erro genérico (serializar com `FOR UPDATE`); auditoria grava só o estado novo; slug recalculado ao renomear unidade; "Nova unidade" visível para gerente restrito; prévia de Mensagens com horários de exemplo; ao mudar o relógio simulado, limpar a lista pendente.
- [ ] Homologação do dono (simulador + celular)

## Etapa 03 — Avisos de presença (S2)
- [ ] Refinamento · Plano detalhado — spec [docs/specs/2026-10-05-etapa-03-s2-design.md](docs/specs/2026-10-05-etapa-03-s2-design.md); plano enxuto [docs/plans/etapa-03-s2-avisos.md](docs/plans/etapa-03-s2-avisos.md) (6 tarefas, 4 blocos de revisão)
- [ ] Registro/cancelamento de aviso (resolvidos pelo código, como o S1 — não são tools de LLM)
- [ ] Painel "previsão do dia" por unidade
- [ ] Evals S2 · Homologação

## Etapa 04 — Eventos (S3)
- [ ] Refinamento · Plano detalhado
- [ ] Espaços de evento (painel); tool `registrar_pedido_evento`; coleta guiada
- [ ] Fila de pedidos com status e responsável
- [ ] Evals S3 · Homologação

## Etapa 05 — Cardápio (S4)
- [ ] Refinamento · Plano detalhado
- [ ] CRUD categorias/itens, exceções por unidade, arquivos de cardápio
- [ ] Busca full-text + trigram; tools `buscar_cardapio`, `enviar_cardapio` (cache `wa_media_id`)
- [ ] Evals S4 · Homologação

## Etapa 06 — Atendimento humano + áudio
- [ ] Refinamento · Plano detalhado
- [ ] Inbox em tempo real (Broadcast privado + RLS), assumir/devolver, notificações
- [ ] Handoff por frustração/falhas; horário de atendimento humano
- [ ] Áudio: download Meta, limite de duração, STT, descarte do arquivo
- [ ] Evals de áudio · Homologação

## Etapa 07 — Ingestão de documentos
- [ ] Refinamento · Plano detalhado
- [ ] Upload seguro (magic bytes, tamanho, sha256), job `document.ingest`, Structured Outputs por alvo
- [ ] Tela de revisão/aprovação do rascunho → tabelas oficiais
- [ ] Evals de extração · Homologação

## Etapa 08 — Gastos, limites e LGPD no painel
- [ ] Refinamento · Plano detalhado
- [ ] Telas de limites (IA e WhatsApp), alertas, relatórios de custo; custo de simulação mostrado à parte (ai_runs.simulado)
- [ ] Direitos do titular (acesso/exclusão), configuração de retenção, cron de retenção; apagar simulações com mais de 7 dias (spec 02 §5.3)
- [ ] Teste de estresse do teto · Homologação

## Etapa 09 — Go-live
- [ ] Revisão de segurança completa e teste de carga (inclui CSP com nonce via `proxy.ts`)
- [ ] Política, LIA e RIPD revisados pelo jurídico; runbook de incidente
- [ ] Número oficial em produção; Guardrail OpenRouter em produção
- [ ] Checklist de produção 100% · Homologação final
