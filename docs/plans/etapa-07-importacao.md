# Etapa 07 — Importação por IA (informações, horários, espaços) e melhorias do cardápio — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** interfaces, regras, testes e decisões; código completo só nos trechos delicados. Revisão por bloco (A–D) + revisão final. Dois agentes nunca rodam `test:db` ao mesmo tempo.

**Goal:** importação genérica por alvo (cardápio, informações, horários, espaços) com vários arquivos, PDF em lotes e modo "só preços", sempre com revisão e confirmação humana.

**Architecture:** banco ganha alvos, arquivos por importação e progresso de lotes; `@atd/core/importacao` define rascunho e junção por alvo; `@atd/ai` ganha prompts por alvo e leitura com várias partes; o worker lê um lote por execução (pdf-lib para dividir) e reenfileira; o painel tem a aba Conteúdo → Importar com revisão por alvo.

**Tech Stack:** igual + `pdf-lib` (só no worker).

**Spec:** [docs/specs/2026-10-06-etapa-07-importacao-design.md](../specs/2026-10-06-etapa-07-importacao-design.md). PRD §10 vence conflitos (I10).

## Global Constraints

- Branch `etapa-07-importacao` (da `main` com o PR #11). Nunca `--force`. Commits em português no imperativo, terminando com as duas linhas exatas `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_015ce8Cfg6prhqAgCRc3Vzvo`.
- TDD por tarefa; `pnpm check` e e2e no fim dos blocos C e D.
- **Nada vira dado oficial sem confirmação humana** (I10); aplicar é transacional, idempotente e auditado sem conteúdo do documento.
- Server Actions: `requireStaff` + Zod + `ActionResult`; permissão: dono, ou gerente com acesso a todas as unidades.
- Migrations só via `drizzle-kit`; nunca editar 0000–0039; enum recriado como na 0033 (o migrator roda numa transação só).
- Prompts novos versionados (`ingestao-<alvo>-v1`); `ingestao-cardapio-v1` intacto; documento é dado, nunca instrução; saída validada com Zod; nenhuma chamada paga sem reserva; nada de conteúdo em log.
- `pdf-lib` só no worker; registrar no PRD.
- Consultar Context7/docs: pdf-lib (split/copyPages), pg-boss (`send` com `startAfter`/`singletonKey`), OpenAI/OpenRouter com várias partes de imagem/arquivo.

## Decisões deste plano

1. `knowledge_documents`: `alvo` (enum recriado: `cardapio|informacoes|horarios|espacos`), `modo` (`completo|so_precos`, check: `so_precos` só com `cardapio`), `lote_atual int default 0`, `lotes_total int null`, `draft_parcial jsonb null`. `storage_path` da linha principal passa a ser opcional para `origem='arquivo'` (os arquivos ficam em `knowledge_document_files`); a dedup vira por `sha256` do conjunto + alvo + modo.
2. `knowledge_document_files` (id, restaurant_id, importacao_id FK, ordem 1–10, storage_path, mime, tamanho, sha256, paginas int null; único (importacao_id, ordem)); RLS igual a `knowledge_documents`.
3. Lote: PDF ⇒ blocos de 5 páginas (`pdf-lib` copia as páginas para um PDF novo em memória); imagens ⇒ grupos de 3; ordem = arquivos em ordem, páginas em ordem. `lotes_total` calculado no primeiro passo.
4. Job: `document.ingest` com `{ importacaoId }` processa **um** lote e, se faltar, `boss.send(QUEUES.ingest, { importacaoId }, { singletonKey: importacaoId + ':' + proximoLote })`. Retomada usa `lote_atual`.
5. Junção (`@atd/core/importacao`): `juntarCardapio`, `juntarInformacoes`, `juntarHorarios`, `juntarEspacos` — puras, idempotentes, com limites por alvo.
6. Rótulos de novo/atualizar calculados na DAL ao montar a revisão (compara com o cadastro atual por nome normalizado).

## Review Focus

1. **Horário de unidade não reconhecida confirmado sem escolher a unidade** — recusado; exige escolha ou "ignorar" (Task 1/5).
2. **Mesmo item em duas fotos com preços diferentes** — vira um item com conflito marcado na revisão, não dois itens (Task 2).
3. **Worker cai no lote 4 de 7** — retoma no 4, sem reler 1–3 nem cobrar de novo (Task 4).
4. **"Só preços" com item novo ou sem preço lido** — novo é ignorado (listado à parte); sem preço não zera o existente (Task 1/2).
5. **Clique duplo em Confirmar / dois gerentes confirmando** — aplica uma vez (Task 1).

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `packages/db/src/schema/s4.ts`, migrations 0040+, `packages/db/src/importacoes.ts` (+ `importacoes-alvos.ts`), testes db | 1 |
| `packages/core/src/importacao/*` (rascunhos e junção por alvo) | 2 |
| `packages/ai/src/prompts/ingestao-{informacoes,horarios,espacos}-v1.ts`, `ingestao.ts`, evals por alvo | 3 |
| `apps/worker/src/jobs/ingest-document.ts`, `apps/worker/src/lotes.ts`, `apps/worker/package.json` (pdf-lib) | 4 |
| `apps/web/app/(painel)/conteudo/**` (aba Importar), `components/painel/importacao/*` | 5 |
| e2e, docs | 6 |

Blocos: **A** = Task 1 · **B** = Tasks 2–4 · **C** = Task 5 · **D** = Task 6 (+ revisão final).

---

### Task 1: Banco — alvos, arquivos, lotes e aplicação por alvo

**Interfaces (Produces):**
```ts
export type AlvoImportacao = 'cardapio' | 'informacoes' | 'horarios' | 'espacos'
export type ModoImportacao = 'completo' | 'so_precos'
export function criarImportacaoArquivos(db, claims, v: { alvo: AlvoImportacao; modo: ModoImportacao }): Promise<ResultadoPainel<{ id: string }>> // status 'enviado' sem arquivos
export function anexarArquivo(db, claims, importacaoId: string, a: { storagePath: string; mime: string; tamanho: number; sha256: string }): Promise<ResultadoPainel<{ ordem: number }>> // ≤ 10; só em 'enviado' e antes de ler
export function removerArquivo(db, claims, importacaoId: string, ordem: number): Promise<ResultadoPainel>
export function iniciarLeitura(db, claims, importacaoId: string): Promise<ResultadoPainel> // ≥ 1 arquivo; dedup do conjunto ⇒ 'ja_importado' com id existente
export function revisaoImportacao(db, claims, id: string): Promise<RevisaoImportacao | null> // rascunho + rótulos novo/atualizar por alvo
export function aplicarImportacao(db, claims, id: string, rascunho: unknown /* validado pelo schema do alvo */): Promise<ResultadoPainel<{ criados: number; atualizados: number; ignorados: number }>> // trava, status rascunho→aprovado, auditoria
// worker
export function proximoLote(db, id: string): Promise<{ alvo: AlvoImportacao; modo: ModoImportacao; restaurantId: string; loteAtual: number; lotesTotal: number | null; arquivos: ArquivoImportacao[]; draftParcial: unknown } | null>
export function salvarLote(db, id: string, p: { lote: number; lotesTotal: number; draftParcial: unknown }): Promise<void> // só avança se lote == lote_atual (idempotente)
export function concluirIngestao(...) // existente, generalizado por alvo
```
- Aplicar por alvo: **cardápio completo** (código atual), **só preços** (só `preco_centavos` de itens existentes; null nunca sobrescreve), **informações** (insert/update de `knowledge_facts` por tema normalizado + unidade), **horários** (por unidade marcada: delete+insert da semana; upsert de exceções por data ≥ hoje no fuso), **espaços** (insert/update por nome na unidade; checks de capacidade).
- [x] Testes (falham): migrations e RLS dos novos campos/tabela; anexar/remover/limite 10/estado; dedup do conjunto; `iniciarLeitura` sem arquivo; `salvarLote` idempotente; cada aplicação (novo, atualizar, ignorar, transação, segunda aplicação ⇒ `ja_aplicado`, concorrência `Promise.all`, permissão de gerente restrito recusada, horário sem unidade recusado, só preços sem preço não zera); cardápio antigo (Etapa 05) continua funcionando.
- [x] Implementar; `pnpm vitest run --project db <arquivos> && pnpm typecheck && pnpm lint`; commit "Generaliza as importações por alvo com vários arquivos e lotes".

### Task 2: Domínio — rascunhos e junção por alvo (`@atd/core/importacao`)
- Schemas Zod por alvo (cardápio reaproveita `rascunhoSchema`; informações, horários, espaços novos; só preços = itens `{ nome, categoria | null, precoCentavos }`), limites e `juntar*` (dedupe por nome normalizado; conflito de preço marcado `precoConflito: number[]`; horários por unidade/dia com turnos ordenados e sem sobreposição; informações por tema).
- [x] Testes (falham) por alvo, incluindo os casos do Review Focus 2 e 4 → implementar → `pnpm vitest run --project unit packages/core` → commit "Adiciona os rascunhos e a junção da importação por alvo".

### Task 3: IA — prompts por alvo, leitura com várias partes e evals
- `lerDocumentoPorIa(llm, { alvo, modo, partes: ConteudoUsuario[] })` escolhendo prompt + JSON schema estrito + parse pelo alvo; prompts `ingestao-{informacoes,horarios,espacos}-v1` (documento é dado; datas no formato ISO; turnos `HH:mm`; capacidades inteiras); "só preços" usa o prompt do cardápio (v1) e o parse reduz para nome+preço.
- Evals: `evals/ingestao` ganha `--alvo` e exemplos gerados (`gerar-exemplos.ts`) para informações, horários, espaços e várias fotos de cardápio, com gabarito e linha de injeção; métrica por alvo; testes com `fetch` falso.
- [x] Testes (falham) → implementar → `pnpm vitest run --project unit packages/ai` → commit "Adiciona a leitura por IA de informações, horários e espaços".

### Task 4: Worker — lotes, retomada e reenfileiramento
- `apps/worker/src/lotes.ts`: `planejarLotes(arquivos) → Lote[]` (PDF em blocos de 5 páginas via pdf-lib; imagens em grupos de 3) e `montarLote(lote, bytes)`; `ingest-document.ts`: processa `lote_atual`, reserva/liquida por lote, `ai_runs` por lote, junta com `juntar<Alvo>`, `salvarLote`, reenfileira o próximo; último lote ⇒ `concluirIngestao` (status `rascunho`); truncamento em lote de PDF ⇒ divide ao meio uma vez; magic bytes e sha256 por arquivo; erro amigável sem conteúdo.
- [x] Testes (falham): planejamento de lotes (PDF de 12 páginas = 3 lotes; 7 imagens = 3 lotes); retomada no lote do meio sem nova cobrança; reenfileiramento com `singletonKey`; truncamento dividido; sem modelo; sem saldo no lote 2 (para com erro e mantém o parcial); várias fotos de cardápio juntam num rascunho → implementar → `pnpm vitest run --project db apps/worker && pnpm typecheck && pnpm lint` → commit "Lê as importações em lotes no worker e retoma de onde parou".

### Task 5: Painel — Conteúdo → Importar e revisão por alvo
- Aba nova com seletor de alvo (e modo no cardápio), envio múltiplo (um arquivo por requisição; lista com remover), "Ler arquivos", progresso "Lendo n de m", histórico por alvo; revisão: cardápio (componente atual + conflitos de preço), só preços (antes → depois), informações (lista editável novo/atualizar), horários (por unidade: grade da semana + exceções; seletor de unidade para não reconhecida), espaços (lista por unidade); Cardápio → Importar leva à nova aba.
- [x] Testes (actions: papéis, limites, Zod por alvo; componentes por alvo; 360 px) → implementar → **`pnpm check`** → commit "Adiciona a aba Importar com revisão por alvo".

### Task 6: E2E, homologação e registros
- [x] E2E (IA falsa devolvendo rascunhos por alvo; PDF de exemplo de várias páginas para os lotes): informações ⇒ revisar ⇒ confirmar ⇒ aparecem em Informações; horários com unidade não reconhecida ⇒ escolher ⇒ confirmar ⇒ grade atualizada; várias fotos de cardápio ⇒ um rascunho; só preços ⇒ antes→depois ⇒ preço atualizado; espaços ⇒ confirmados; PDF em lotes mostra progresso.
- [x] Docs: `docs/homologacao/etapa-07.md`, PRD (adendo, pdf-lib), PLAN (Etapa 07 com evidência), CLAUDE "Onde paramos", `cp CLAUDE.md AGENTS.md`; `pnpm check` + e2e verdes; banco pronto. Commit "Adiciona o e2e e o roteiro de homologação da Etapa 07".

**Fim → revisão final → onda única de correções → re-revisão.**
