# Atendimento IA — guia dos agentes de código

> **CLAUDE.md e AGENTS.md são cópias idênticas** (lidos por IAs diferentes). Ao editar um: `cp CLAUDE.md AGENTS.md`.

## Ordem de leitura (antes de qualquer tarefa)

1. Este arquivo.
2. [PLAN.md](PLAN.md) — coração da construção: etapas em checklist, "Onde paramos".
3. [PRD.md](PRD.md) — instrução técnica: arquitetura, modelo de dados, pipeline da IA, LGPD, **invariantes (§10)**.
4. O plano detalhado da etapa corrente em `docs/plans/`.

Conflito entre plano e PRD: **o invariante do PRD vence**.

## O que é

Atendimento ao cliente de um restaurante multiunidade **100% por IA via WhatsApp oficial**, com handoff para humano. Quatro serviços: (S1) horários e unidades, (S2) aviso de presença, (S3) eventos, (S4) cardápio. Painel web para dono/gerente/atendente, com limites de gasto de IA e WhatsApp. LGPD é base de tudo.

## Stack (detalhes e motivos no PRD §2)

TypeScript strict · pnpm + Turborepo · Next.js 16 (Vercel gru1) · Node 24 worker (Docker, VPS Hostinger, sem portas abertas) · Supabase Postgres sa-east-1 + Auth + Storage + Realtime · Drizzle ORM · pg-boss · OpenRouter (cliente `fetch` próprio) · Zod 4 · Tailwind v4 + shadcn/ui · Vitest · Playwright · Sentry.

**Não adicionar** NestJS, tRPC, Redis, outro ORM ou outro storage sem decisão registrada no PRD.

## Como trabalhar

1. Pegue o próximo item não marcado da etapa corrente no PLAN.md. Trabalho fora do plano entra primeiro como item.
2. **Consulte a documentação atual (Context7)** antes de usar API de biblioteca — não confie em memória.
3. **TDD:** teste que falha → implementação mínima → verde → refatora. Teste também o caso ruim (entrada inválida, sem permissão, concorrência).
4. Antes de declarar pronto: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (+ evals se tocou em `packages/ai`). Evidência antes de afirmação.
5. Marque `[x]` no PLAN.md com data e evidência; atualize "Onde paramos".
6. Commits pequenos, mensagem em português no imperativo.

## Regras invioláveis (resumo — lista completa no PRD §10)

- **Escopo da IA:** só os 4 serviços. Fora de escopo é barrado no pré-filtro/triagem, sem chamar o modelo principal.
- **Grounding:** preço, horário, endereço e disponibilidade só de dado aprovado no banco, via tool. Nada de conhecimento geral.
- **LLM só age por tools** tipadas e validadas no código. Saída do LLM sempre validada com Zod.
- **Orçamento:** nenhuma chamada paga sem reserva atômica bem-sucedida.
- **LGPD:** redação de PII antes do LLM; `data_collection: 'deny'` + `zdr: true` em toda chamada; dado de saúde nunca persistido em campo estruturado; telefone cifrado; áudio descartado após transcrição; nada de PII em log/Sentry.
- **Segurança:** RLS em toda tabela; toda Server Action verifica sessão + papel + unidade na DAL (nunca confiar só no `proxy.ts`); webhook só com HMAC válido; `service_role` e segredos nunca no browser; `set_config` sempre **parametrizado** (nunca `sql.raw` com dado).
- **Banco:** dinheiro em centavos (`integer`) ou `numeric`, nunca `float`; `timestamptz`; toda consulta de caminho quente com índice e `EXPLAIN` revisado; migrations só via `drizzle-kit`, nunca editar migration já aplicada.
- **Documentos enviados** nunca viram dado oficial sem aprovação humana.

## Convenções

- Idioma: código (identificadores) em inglês; textos de UI, mensagens ao cliente, docs e commits em português do Brasil.
- `packages/core` é domínio puro: sem `fetch`, sem DB direto — recebe dependências por parâmetro (testável).
- Prompts versionados em `packages/ai/prompts/vN.ts`; nunca editar uma versão publicada — criar `vN+1`.
- Segredos só em env (validado por Zod no boot); `.env*` nunca commitado.

## Onde paramos

- **06/10/2026** — Etapa 04 (S3, eventos) implementada na branch `etapa-04-s3-eventos` (b99f5bb..HEAD): espaços e fila de pedidos de evento, `triage-v4` com pergunta pendente, Agenda (Previsão | Eventos), telefone sob demanda auditado; `pnpm check` com 1292 testes; e2e 28/28. Pendentes externos: crédito no OpenRouter (camada 1 dos evals e modelo de triagem). Próximo: revisão final da branch, homologação do dono (`docs/homologacao/etapa-04.md`) e fechamento da Etapa 04.
- **05/10/2026** — Rodada residual da Etapa 03 aplicada (`1170d36..HEAD`; `pnpm check` com 1056 testes; e2e 23/23). Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem. Próximo: homologação do dono (`docs/homologacao/etapa-03.md`) e fechamento da Etapa 03.
- **05/10/2026** — Revisão final da Etapa 03 e onda final de correções aplicadas (`c71ca44..HEAD`; migration 0022; `pnpm check` com 1052 testes; e2e 23/23). Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem. Próximo: homologação do dono (`docs/homologacao/etapa-03.md`) e fechamento da Etapa 03.
- **05/10/2026** — Etapa 03 (S2, avisos de presença) implementada na branch `etapa-03-s2-avisos` (34d0650..HEAD; `pnpm check` com 1040 testes; e2e 23/23). Homologação em `docs/homologacao/etapa-03.md`. Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem. Próximo: revisão final da branch, homologação do dono e fechamento da Etapa 03.
- **05/10/2026** — Plano 02-C (painel de S1 e simulador ligado ao pipeline real) implementado; revisão final e leva de correções aplicadas (`f008e26..5e809ed`; `pnpm check` com 782 testes; e2e 19/19). Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem. Próximo: homologação do dono (`docs/homologacao/etapa-02c.md`) e fechamento da Etapa 02.
- **05/10/2026** — Plano 02-C implementado (painel de S1, simulador ligado ao pipeline real, e2e). Homologação em docs/homologacao/etapa-02c.md. Pendentes externos: crédito no OpenRouter e escolha do modelo de triagem; Postgres 17 no Supabase hospedado. Próximo: homologação do dono e fechamento da Etapa 02.
- **05/10/2026** — Plano 02-B (dados por unidade, feriados, resolução/composição, triage-v2, lacunas, localização/lista, evals; camada 2 com 101 casos) implementado. Pendente: chave do OpenRouter para escolher o modelo de triagem (`docs/homologacao/etapa-02b.md`). Leva final de correções aplicada (`pnpm check` com 661 testes). Próximo: plano 02-C.
- **05/10/2026** — Homologação local do 02-A aprovada pelo dono, com dois ajustes: cartões da Início sem vazar no celular e quadro **Gastos** (IA e WhatsApp, hoje e no mês). Repositório publicado em `Harmony-Digital/modelos_sistema_para_restaurantes` (branches `main`, `etapa-01-fundacao`, `etapa-02-s1`); PRs abertos para a `main` — mesclar primeiro o da Etapa 01. Próximo: plano 02-B.
- **05/10/2026** — Plano 02-A (design system, navegação, formulários, definir senha, Devolver à IA, casca do simulador) implementado; e2e `celular` 15/15; revisão final sem críticos e leva de correção aplicada (`d10cfff..9ec0da2`, 427 testes). Próximo: plano 02-B.
- **05/10/2026** — Revisão final + leva de correção aplicadas (250 testes verdes). Repositório GitHub ainda não existe: publicar seguindo `docs/runbooks/publicar-repositorio.md` (repositório vazio, push de `main` e `etapa-01-fundacao`, nunca `--force`). Registro da execução em `docs/historico/etapa-01-ledger.md`. Próximo: refinamento da Etapa 02.
- **05/10/2026** — Etapa 01 implementada e revisada tarefa a tarefa (240 testes verdes; e2e 4/4). Próximo: deploy em staging + homologação do dono (`docs/homologacao/etapa-01.md`); depois refinamento da Etapa 02, incluindo o design system.
- **05/10/2026** — Arquitetura aprovada; PRD v1.0, PLAN e CLAUDE.md criados; plano da Etapa 01 escrito em `docs/plans/etapa-01-fundacao.md` (21 tarefas). Próximo: executar a partir da Task 1.
