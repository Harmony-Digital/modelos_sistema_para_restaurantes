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

- **05/10/2026** — Arquitetura aprovada; PRD v1.0, PLAN e CLAUDE.md criados; plano da Etapa 01 escrito em `docs/plans/etapa-01-fundacao.md` (21 tarefas). Próximo: executar a partir da Task 1.
