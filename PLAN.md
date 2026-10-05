# PLAN — roteiro de construção

> **Coração da construção.** Tudo o que foi feito e o que falta, em etapas e checklist.
> Regras técnicas: [PRD.md](PRD.md). Como trabalhar: [CLAUDE.md](CLAUDE.md).
> Ao concluir um item: marcar `[x]` com **data e evidência** (commit, teste, URL).
> Trabalho fora deste plano entra primeiro aqui como item, depois é executado.

## Onde paramos

- **05/10/2026** — Etapa 01 (arquitetura e stack) **definida e aprovada**; PRD v1.0, PLAN e CLAUDE.md escritos; **plano detalhado da Etapa 01 escrito** em [docs/plans/etapa-01-fundacao.md](docs/plans/etapa-01-fundacao.md) (21 tarefas). Próximo passo: revisão do plano pelo dono e escolha do modo de execução; depois Task 1.

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
- [ ] Monorepo: pnpm + Turborepo, `packages/config` (tsconfig strict, eslint, env Zod)
- [ ] Supabase CLI local; extensões `pg_trgm`, `unaccent` (`pg_cron` entra na Etapa 08, com a retenção)
- [ ] `packages/db`: schema base (restaurants, units, staff, customers, conversations, messages, ai_runs, budget_*, spend_ledger, audit_log, data_subject_requests, retention_settings, worker_heartbeats) + policies RLS + role `worker_app`
- [ ] Cliente DB com contexto RLS **parametrizado**; testes de RLS por papel
- [ ] `apps/web`: Next.js 16, auth Supabase com MFA, papéis, layout mínimo do painel, headers de segurança
- [ ] `packages/whatsapp`: HMAC, schemas Zod do webhook, cliente de envio (texto)
- [ ] Webhook: verificação GET, POST com HMAC → transação (customer, conversation, message idempotente, `sendDebounced`)
- [ ] `apps/worker`: pg-boss (filas, singleton, DLQ), heartbeat, shutdown gracioso, Dockerfile não-root
- [ ] `packages/core`: pré-filtro (humano, saudação, flood, LGPD, mídia não suportada), redação de PII, orçamento atômico (+ teste concorrente)
- [ ] `packages/ai`: cliente OpenRouter (`dataCollection: 'deny'`, fallback, registro de `usage.cost`), triagem com `json_schema`, resposta fixa de fora de escopo
- [ ] Aviso LGPD na primeira interação + página pública de política (rascunho)
- [ ] Sentry (web + worker) com scrub de PII
- [ ] CI GitHub Actions (lint, typecheck, test, build); deploy Vercel; imagem GHCR + deploy VPS
- [ ] Hardening VPS (UFW, fail2ban, unattended-upgrades, usuário de deploy)
- [ ] Homologação do dono

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
