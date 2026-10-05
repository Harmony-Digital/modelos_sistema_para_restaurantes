# PLAN — roteiro de construção

> **Coração da construção.** Tudo o que foi feito e o que falta, em etapas e checklist.
> Regras técnicas: [PRD.md](PRD.md). Como trabalhar: [CLAUDE.md](CLAUDE.md).
> Ao concluir um item: marcar `[x]` com **data e evidência** (commit, teste, URL).
> Trabalho fora deste plano entra primeiro aqui como item, depois é executado.

## Onde paramos

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

## Etapa 02 — Horários, funcionamento e unidades (S1)
- [ ] Refinamento (inclui **definição do design system**)
- [ ] Plano detalhado
- [ ] CRUD unidades, horários, exceções, fatos (painel)
- [ ] Tools `listar_unidades`, `horarios_unidade`, `buscar_info`; "aberto agora" com fuso/feriado/virada de dia
- [ ] Prompt v1 + evals S1 + escolha de modelos por evals
- [ ] Homologação

## Etapa 03 — Avisos de presença (S2)
- [ ] Refinamento · Plano detalhado
- [ ] Tools `registrar_aviso_presenca`, `cancelar_aviso_presenca`
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
- [ ] Telas de limites (IA e WhatsApp), alertas, relatórios de custo
- [ ] Direitos do titular (acesso/exclusão), configuração de retenção, cron de retenção
- [ ] Teste de estresse do teto · Homologação

## Etapa 09 — Go-live
- [ ] Revisão de segurança completa e teste de carga (inclui CSP com nonce via `proxy.ts`)
- [ ] Política, LIA e RIPD revisados pelo jurídico; runbook de incidente
- [ ] Número oficial em produção; Guardrail OpenRouter em produção
- [ ] Checklist de produção 100% · Homologação final
