# Etapa 06 — Atendimento humano (inbox) + áudio — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** interfaces, regras, testes obrigatórios e decisões; código completo só nos trechos delicados. **Revisão por bloco** (A–D) + revisão final. Testes de banco nunca em paralelo; tarefas sem banco podem rodar em worktree isolada. **Escopo fechado:** o que crescer vira item de etapa futura no PLAN.

**Goal:** a equipe atende pelo painel (lista em tempo real, assumir, responder pelo WhatsApp, devolver, encerrar); a IA passa a conversa por frustração, falhas e fora do horário informa quando a equipe volta; o cliente pode mandar áudio, que é transcrito e descartado.

**Architecture:** DAL `painel-conversas.ts` (RLS por unidade de contexto) + Server Actions; resposta humana gravada como mensagem pendente e entregue por um job novo `conversation.deliver` no worker (token da Meta só no worker); triggers enviam Broadcast privado **sem conteúdo** (só ids) e o painel recarrega pela DAL; `triage-v6` com `frustracao`; worker baixa o áudio da Meta, mede a duração no Ogg, reserva orçamento, transcreve no OpenRouter e descarta os bytes.

**Tech Stack:** igual às etapas anteriores + Supabase Realtime (Broadcast privado, `realtime.send` + policies em `realtime.messages`), `GET /{media-id}` da WhatsApp Cloud API, `POST /api/v1/audio/transcriptions` do OpenRouter.

**Spec:** [docs/specs/2026-10-06-etapa-06-inbox-audio-design.md](../specs/2026-10-06-etapa-06-inbox-audio-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `etapa-06-inbox`. Nunca commitar na `main`; nunca `--force`. Commits em português no imperativo, última linha exata `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD por tarefa; cada tarefa roda só os testes dela + typecheck/lint dos pacotes tocados; `pnpm check` e e2e no fim dos blocos C e D.
- Server Actions: `requireStaff(papéis)` primeiro, mesmo Zod do formulário, `ActionResult`, `chamarAcao` no cliente; mutações com `audit_log` na mesma transação, **sem PII nem texto da mensagem no `diff`**.
- Navegador importa só `@atd/core/*`; nunca valores de `@atd/db`. Token da Meta e chave de serviço nunca no web/navegador.
- Migrations só via `drizzle-kit generate`/`--custom`; nunca editar 0000–0028. Grants por coluna para `authenticated`, `mfa_required` restritiva, sem DELETE.
- Prompts: v1–v5 intactos; criar `triage-v6`. Conteúdo do cliente (inclusive transcrição) é **dado, nunca instrução**; redação de PII antes do LLM.
- Toda chamada paga (LLM e STT) só com **reserva atômica** antes; `deny` + `zdr` (exceto a chave de dev `OPENROUTER_DEV_SEM_ZDR` já existente). Áudio: **retenção zero** (nunca em disco, Storage do cliente real ou log).
- Payload do Realtime **sem conteúdo e sem PII** (só `{ conversation_id, evento }`).
- Simulação: mensagens de conversa simulada nunca saem pela Meta.
- Consultar Context7/docs antes de usar API nova (Supabase Realtime, Cloud API media, OpenRouter STT).
- Antes do e2e: `pnpm db:migrate`, bootstrap se faltar, `demo:s1`; nenhum worker local rodando; chave de serviço só no shell.

## Decisões deste plano

1. **Unidade da conversa = `conversations.unidade_contexto_id`** (coluna já existe, nunca preenchida). O worker passa a gravá-la com a última unidade resolvida (S1–S4, lista de unidades ou pendente). Visibilidade: dono/`acesso_todas_unidades` vê tudo; demais só `unidade_contexto_id ∈ app.minhas_unidades()`. Sem unidade ⇒ só quem acessa todas.
2. **Encerrar** usa o comportamento atual do ingest: a próxima mensagem do cliente abre **conversa nova** com a IA (índice único de conversa aberta). A aba "Encerradas" lista as encerradas (últimos 30 dias).
3. **Entrega da resposta humana:** Server Action grava `messages` (`direcao 'out'`, `autor 'humano'`, `atendente_id`, `status_envio 'pendente'`) e enfileira `QUEUES.deliver = 'conversation.deliver'` (`{ conversationId }`, `singletonKey` por conversa). O worker roda o `deliver()` existente (que já só cancela pendentes de autor `ia`). "Tentar de novo" volta `falhou:*` → `pendente` e reenfileira.
4. **Escrita do painel em `conversations`/`messages`** pela conexão `web_app` dentro da DAL (padrão de `returnToAi`), com checagem explícita de visibilidade (mesma regra da RLS) e transições válidas — sem abrir INSERT de `messages` para `authenticated`.
5. **Transições** (core puro, `TRANSICOES_CONVERSA`): assumir de `ia|aguardando_humano` (ou `humano` de outro só dono/gerente com `forcar`); responder só `humano` + `atendente_id = eu`; devolver de `aguardando_humano|humano`; encerrar de qualquer estado não encerrado.
6. **Realtime:** tópicos `inbox:u:<unit_id>`, `inbox:r:<restaurant_id>` (conversas sem unidade e para quem vê tudo) e `conversa:<conversation_id>`. Trigger `after insert or update` em `conversations` (só se `estado`, `atendente_id`, `last_message_at` ou `unidade_contexto_id` mudarem) e `after insert` em `messages`. Simuladas também emitem (o painel filtra).
7. **Áudio:** `AI_STT_MODELS` (csv, opcional; vazio = desligado) e `AI_STT_USD_POR_MIN` (padrão `0.01`). Limite 2 min, 16 MB. Duração pelo Ogg (granule ÷ 48 000); sem Ogg legível ⇒ `bytes / 2000` segundos (≈ 16 kbps, conservador).
8. **Simulador de áudio:** bucket privado `audios-simulados` (upload pela equipe com o próprio cliente Supabase; worker baixa e **apaga** com a chave de serviço). Mensagem simulada `tipo 'audio'` com `midia_ref { bucket, path }`.
9. **Navegação:** barra **Início · Conversas · Agenda · Conteúdo · Mais**; "Unidades" vai para Mais (rota `/unidades` mantida).

## Review Focus

1. **Dois atendentes clicam "Assumir" ao mesmo tempo** — um vence, o outro vê "Fulano já está atendendo"; teste Task 1 (`Promise.all`).
2. **Resposta enviada com a janela de 24 h vencida / conversa devolvida no meio** — recusada com mensagem clara, nada enfileirado; teste Task 1.
3. **Atendente de outra unidade escuta o tópico ou abre a conversa por URL** — sem acesso (policy do Realtime e DAL); teste Task 1.
4. **Áudio corrompido, sem Ogg, > 2 min ou sem saldo** — mensagem amigável, nenhuma chamada paga, reserva estornada; teste Task 4.
5. **Cliente responde enquanto a IA ainda tinha resposta pendente e o atendente assume** — resposta da IA cancelada (I5), a humana sai; teste Task 4.

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `packages/db/src/schema/{conversation,ops}.ts`, migrations `0029` (gerada) + `0030` (custom: grants, índices, realtime, bucket), `packages/db/src/painel-conversas.ts`, `packages/db/src/queue.ts`, `packages/db/src/restaurant.ts` | 1 |
| `packages/core/src/conversa/{transicoes,janela,horario-humano,index}.ts` (+ export `./conversa`), `packages/core/src/audio/{ogg,custo}.ts` (+ `./audio`), `s1/modelos.ts`, pendências 2–4 e 6 (`s2/`, `s3/`, `apps/web/lib/eventos.ts`) | 2 |
| `packages/ai/src/prompts/triage-v6.ts`, `triage.ts`, `stt.ts`, `openrouter.ts`, `evals/frustracao/*`, `evals/stt/*`, `package.json` scripts | 3 |
| `packages/whatsapp/src/client.ts` (`downloadMedia`), `packages/config/src/env.ts`, `apps/worker/src/{main.ts,jobs/process-conversation.ts,jobs/deliver.ts,audio.ts}` | 4 |
| `apps/web/app/(painel)/conversas/**`, `components/conversas/*`, `lib/realtime/use-inbox.ts`, `components/shell/bottom-nav.tsx`, Início | 5 |
| `apps/web/app/(painel)/mais/atendimento-humano/**`, Conteúdo → Mensagens (respostas rápidas), simulador (áudio), seletor de responsável (pendência 5) | 6 |
| e2e, docs | 7 |

Blocos: **A** = Task 1 · **B** = Tasks 2–4 · **C** = Tasks 5–6 · **D** = Task 7 (+ revisão final).

---

## Bloco A — Banco, Realtime e DAL

### Task 1: Esquema da inbox, Realtime privado e DAL do painel

**Files:** Modify `packages/db/src/schema/conversation.ts` (`handoffMotivo`, `aguardandoDesde`, `messages.atendenteId`), `schema/ops.ts` ou novo `schema/inbox.ts` (`quick_replies`), `queue.ts`, `restaurant.ts`; Create `packages/db/src/painel-conversas.ts` + testes `painel-conversas.db.test.ts`, `inbox-rls.db.test.ts`, `realtime.db.test.ts`; migrations 0029/0030.

**Interfaces (Produces):**
```ts
// queue.ts
QUEUES.deliver = 'conversation.deliver'; QUEUES.deliverDlq = 'conversation.deliver.dlq'
export type DeliverJob = { conversationId: string }
export function enqueueDeliver(boss: PgBoss): (conversationId: string) => Promise<unknown>
// painel-conversas.ts
export type AbaInbox = 'aguardando' | 'comigo' | 'ia' | 'encerradas'
export type ItemInbox = { id: string; nome: string | null; unidade: string | null; trecho: string | null; estado: ConversationState; atendente: string | null; aguardandoDesde: Date | null; lastMessageAt: Date; simulada: boolean; handoffMotivo: HandoffMotivo | null }
export function listarInbox(db: Db, claims: JwtClaims, p: { aba: AbaInbox; unitId?: string; simulacoes?: boolean; cursor?: string }): Promise<{ itens: ItemInbox[]; proximo: string | null }> // 50 por página
export function contarAguardando(db: Db, claims: JwtClaims): Promise<number> // só reais
export type MensagemInbox = { id: number; direcao: 'in' | 'out'; autor: Autor; atendente: string | null; tipo: TipoMensagem; texto: string | null; transcrito: boolean; payload: unknown; statusEnvio: string | null; createdAt: Date }
export function lerConversa(db: Db, claims: JwtClaims, id: string, p?: { antesDe?: number }): Promise<{ conversa: ItemInbox & { janelaAte: Date | null; atendenteId: string | null }; mensagens: MensagemInbox[] } | null> // 50 por página, ordem cronológica
export type ErroInbox = 'nao_encontrada' | 'ja_atendida' | 'transicao_invalida' | 'fora_da_janela' | 'nao_e_seu'
export function assumirConversa(db: Db, claims: JwtClaims, id: string, p: { forcar?: boolean }): Promise<{ ok: true } | { ok: false; erro: ErroInbox; atendente?: string }>
export function responderConversa(db: Db, claims: JwtClaims, id: string, texto: string): Promise<{ ok: true; messageId: number } | { ok: false; erro: ErroInbox }> // não enfileira: a action enfileira depois do commit
export function reenviarMensagem(db: Db, claims: JwtClaims, messageId: number): Promise<{ ok: true; conversationId: string } | { ok: false; erro: ErroInbox }>
export function devolverConversa(...) // substitui returnToAi (manter returnToAi como alias até a Task 5 trocar o Início)
export function encerrarConversa(db: Db, claims: JwtClaims, id: string): Promise<{ ok: true } | { ok: false; erro: ErroInbox }>
export function tempoAteAssumirHoje(db: Db, claims: JwtClaims): Promise<number | null> // mediana em segundos, só reais
// respostas rápidas e horário humano
export function listarRespostasRapidas(db, claims): Promise<RespostaRapida[]>; export function salvarRespostaRapida(db, claims, id: string | null, v: { titulo: string; texto: string; ordem: number; ativo: boolean }): Promise<ResultadoPainel<{ id: string }>> // ≤ 30 ativas ⇒ 'limite'
export function salvarHorarioHumano(db, claims, v: HorarioHumano): Promise<ResultadoPainel> // só dono; HorarioHumano vem de @atd/core/conversa (Task 2 — nesta task, declare o schema Zod em packages/core/src/conversa/horario-humano.ts já com o tipo, a Task 2 completa as funções)
```
`assumirConversa` é um **UPDATE condicional** único (`where id = $1 and estado in (...) [and (atendente_id is null or $forcar)]` `returning`) — nunca ler-e-depois-gravar. Ao assumir, grave `audit_log` `conversa.assumida` com `diff { aguardandoDesde }` (sem PII) e zere `aguardando_desde`; a métrica "tempo até assumir" é a mediana de `audit.created_at − diff.aguardandoDesde` das auditorias de hoje (conversas reais).

**Migration custom 0030 (trecho delicado — escrever assim):**
```sql
-- Broadcast sem conteúdo
create or replace function app.inbox_broadcast() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; payload jsonb;
begin
  if tg_table_name = 'messages' then
    select id, restaurant_id, unidade_contexto_id into c from public.conversations where id = new.conversation_id;
  else
    if tg_op = 'UPDATE' and new.estado is not distinct from old.estado and new.atendente_id is not distinct from old.atendente_id
       and new.last_message_at is not distinct from old.last_message_at and new.unidade_contexto_id is not distinct from old.unidade_contexto_id then
      return null;
    end if;
    c := new;
  end if;
  payload := jsonb_build_object('conversation_id', c.id, 'evento', lower(tg_table_name || '_' || tg_op));
  perform realtime.send(payload, 'mudou', 'inbox:r:' || c.restaurant_id, true);
  if c.unidade_contexto_id is not null then
    perform realtime.send(payload, 'mudou', 'inbox:u:' || c.unidade_contexto_id, true);
  end if;
  perform realtime.send(payload, 'mudou', 'conversa:' || c.id, true);
  return null;
end $$;
create trigger conversations_inbox_broadcast after insert or update on public.conversations for each row execute function app.inbox_broadcast();
create trigger messages_inbox_broadcast after insert on public.messages for each row execute function app.inbox_broadcast();

-- Autorização: só escuta (SELECT); ninguém do navegador publica
create policy inbox_listen on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and app.mfa_ok() and (
    ((select realtime.topic()) = 'inbox:r:' || (select app.my_restaurant_id())::text and (select app.acesso_todas_unidades()))
    or ((select realtime.topic()) like 'inbox:u:%' and substr((select realtime.topic()), 9)::uuid = any((select app.minhas_unidades())::uuid[]))
    or ((select realtime.topic()) like 'conversa:%' and exists (
      select 1 from public.conversations cv where cv.id = substr((select realtime.topic()), 10)::uuid
        and cv.restaurant_id = (select app.my_restaurant_id())
        and ((select app.acesso_todas_unidades()) or cv.unidade_contexto_id = any((select app.minhas_unidades())::uuid[]))))
  )
);
```
Confirme no Context7 a assinatura de `realtime.send(payload jsonb, event text, topic text, private boolean)` e se `app.acesso_todas_unidades()`/`app.mfa_ok()` têm essa assinatura (ajuste ao que existe). Cast de tópico malformado não pode derrubar a policy: valide com regex antes do `::uuid`. Também: índices `(restaurant_id, estado, aguardando_desde)` e `(restaurant_id, unidade_contexto_id, last_message_at desc)`; `quick_replies` com RLS (leitura equipe, escrita dono/gerente), grants por coluna, MFA; grant de UPDATE em `restaurants.horario_atendimento_humano` só para dono (via DAL); bucket `audios-simulados` (privado, 16 MB, mimes de áudio; insert/select pela equipe no prefixo do `restaurant_id`); `worker_app` ganha o que precisar para `deliver`.

- [ ] **Step 1: Testes (falham):** listar por aba/unidade/simulações e paginação; gerente restrito não vê conversa de outra unidade nem sem unidade; assumir (livre, já atendida ⇒ `ja_atendida` com nome, `forcar` só dono/gerente, concorrência `Promise.all` ⇒ um vence); responder (não é seu, estado errado, janela vencida, texto vazio/> 4096 ⇒ erro; ok grava `autor 'humano'` + `atendente_id`); reenviar só `falhou:*`; devolver/encerrar e transições inválidas; auditoria sem texto; métrica tempo até assumir; respostas rápidas (limite 30, atendente só lê); horário humano só dono; **Realtime:** insert em `messages` gera linhas em `realtime.messages` com payload só de ids (consultar a tabela no teste) e a policy deixa/nega `select` por tópico conforme papel/unidade (simular `realtime.topic()` com `set_config('realtime.topic', …)` — confira no Context7 como o teste deve definir o tópico).
- [ ] **Step 2: Schema e migrations** (`pnpm --filter @atd/db exec drizzle-kit generate` e `--custom`); `pnpm db:migrate`; `EXPLAIN` das consultas de `listarInbox` no relatório.
- [ ] **Step 3: Implementar** a DAL e `enqueueDeliver` (+ `ensureQueues`).
- [ ] **Step 4: Verde:** `pnpm vitest run --project db packages/db/src/painel-conversas.db.test.ts packages/db/src/inbox-rls.db.test.ts packages/db/src/realtime.db.test.ts packages/db/src/conversations-panel.db.test.ts packages/db/src/rls.db.test.ts && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — "Cria a inbox no banco com Realtime privado e a DAL do atendimento".

**Fim do Bloco A → revisão.**

---

## Bloco B — Domínio, IA e worker

### Task 2: Domínio da conversa e do áudio + pendências da Etapa 04 (`@atd/core`)

**Files:** Create `packages/core/src/conversa/{transicoes,janela,horario-humano,index}.ts`, `packages/core/src/audio/{ogg,custo,index}.ts` + testes; Modify `package.json` (`./conversa`, `./audio`), `s1/modelos.ts`, `s2/*`, `s3/*`, `apps/web/lib/eventos.ts` (importar `TRANSICOES` do core).

**Interfaces:**
```ts
export const HANDOFF_MOTIVOS = ['pedido', 'frustracao', 'falhas', 'economico', 'servico'] as const
export const TRANSICOES_CONVERSA: Record<ConversationState, readonly ConversationState[]>
export function dentroDaJanela(janelaAte: Date | null, agora: Date): boolean
export const horarioHumanoSchema // z.object({ dias: z.partialRecord(z.enum(['dom','seg','ter','qua','qui','sex','sab']), z.array(z.object({ inicio: hhmm, fim: hhmm })).max(4)) })
export type HorarioHumano = z.infer<typeof horarioHumanoSchema>
export function proximoHorarioHumano(h: HorarioHumano, agora: Date, tz: string): { aberto: true } | { aberto: false; proximo: { dia: Date; inicio: string } | null } // null = sem horário cadastrado; madrugada (fim < inicio) como no S1
export function textoProximoHorario(p: { dia: Date; inicio: string }, agora: Date, tz: string): string // "hoje a partir das 14h", "amanhã a partir das 9h", "na segunda a partir das 9h"
export function duracaoOggSegundos(bytes: Uint8Array): number | null // último granule position da página Ogg final ÷ 48000; null se não for Ogg/Opus válido
export function duracaoEstimada(bytes: Uint8Array): number // duracaoOggSegundos ?? Math.ceil(bytes.length / 2000)
export function custoSttUsd(segundos: number, usdPorMin: number): number // proporcional à duração, mínimo 1 s
```
Modelos novos (texto exato):
```ts
handoff_dentro: { texto: 'Vou passar você para alguém da nossa equipe. Já já te respondem por aqui.', variaveis: [] },
handoff_fora: { texto: 'Vou passar você para alguém da nossa equipe. Nossa equipe atende {proximo_horario} e te responde assim que voltar.', variaveis: ['proximo_horario'] },
handoff_frustracao: { texto: 'Desculpe pelo transtorno. Vou chamar alguém da nossa equipe para continuar com você.', variaveis: [] },
audio_longo: { texto: 'Seu áudio passou de 2 minutos. Pode mandar um mais curto ou escrever?', variaveis: [] },
audio_falhou: { texto: 'Não consegui ouvir seu áudio. Pode mandar de novo ou escrever?', variaveis: [] },
```
(`handoff_fora` é usado em todo handoff fora do horário; `handoff_frustracao` dentro do horário.) **Pendências 2–4 e 6:** "pessoas" + evento na mesma mensagem mantém o evento (pergunta o que falta do evento depois de resolver pessoas, sem perder o item); lista de unidades antiga com pendente `pedido_evento` usa a escolha em vez de "lista expirada" enquanto o pendente vale; pedido confirmado pela equipe durante a coleta ⇒ `evento_ja_confirmado_humano` (handoff) em vez de "não encontrei"; `TRANSICOES` de status do evento em `@atd/core/s3` e importada pelo web.

- [ ] **Step 1: Testes (falham):** transições; janela (limite exato); horário humano (aberto, fechado hoje mais tarde, amanhã, pula dias sem turno, madrugada, vazio ⇒ `proximo null`, fuso America/Sao_Paulo); textos ("hoje a partir das 14h", "amanhã…", "na segunda…"); Ogg (arquivo fixture real pequeno — gerar com `ffmpeg` se disponível ou um Ogg mínimo montado no teste — e bytes corrompidos ⇒ null); custo; as quatro pendências com casos que reproduzem o bug.
- [ ] **Step 2–4:** implementar; `pnpm vitest run packages/core && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — "Adiciona o domínio da conversa e do áudio e corrige pendências de eventos".

### Task 3: Triagem v6 (frustração) e cliente de transcrição (`@atd/ai`)

**Files:** Create `packages/ai/src/prompts/triage-v6.ts`, `packages/ai/src/stt.ts` + testes, `evals/frustracao/{casos,extracao}.ts`, `evals/stt/{gabarito,rodar}.ts`; Modify `triage.ts` (v6 padrão no worker), `index.ts`, `package.json` (`eval:frustracao`, `eval:stt`), evals S1–S4 passam a medir a v6 por padrão.

**Interfaces:**
```ts
// triage-v6: saída = v5 + { frustracao: boolean } no nível da mensagem (não do item)
export type ResultadoTriagem = { itens: ItemExtraido[]; frustracao: boolean; ... } // mantenha o que a v5 já devolve
export type ResultadoStt = { ok: true; texto: string; segundos: number; custoUsd: number | null; modelo: string; latenciaMs: number } | { ok: false; erro: 'timeout' | 'http' | 'vazio' | 'saida_invalida'; status?: number }
export function transcrever(cfg: OpenRouterConfig, p: { bytes: Uint8Array; mime: string; modelos: string[]; timeoutMs?: number }): Promise<ResultadoStt>
```
`transcrever`: confirme na doc do OpenRouter (`/api/v1/audio/transcriptions`) o formato (multipart `file`/`model`/`language` **ou** JSON base64 `input_audio`) e onde vêm `usage`/custo; `language: 'pt'`; mesmo `provider` deny/zdr do cliente (respeitando `semZdrDev`); 1 retentativa em 5xx/timeout; tenta o próximo modelo da lista em erro; texto vazio ⇒ `vazio`. Nada de áudio ou texto em log.

**Prompt v6:** igual à v5 + regra: `frustracao = true` só quando o cliente demonstra irritação **com o atendimento** (reclama da demora/da IA, "ninguém responde", "já perguntei isso", xingamentos, caixa alta raivosa); **não** quando reclama de coisa externa ou faz pergunta normal ("que demora pra abrir, hein?" ⇒ false).

- [ ] **Step 1: Testes (falham):** v6 valida `frustracao` (Zod; ausente ⇒ saída inválida); v1–v5 intactos (snapshot); `transcrever` com `fetch` falso: sucesso, 5xx com retentativa, timeout, troca de modelo, vazio, `provider` presente/ausente com `semZdrDev`; nenhum `console`/log com conteúdo.
- [ ] **Step 2:** evals: `evals/frustracao/casos.ts` com ≥ 10 frustração e ≥ 10 parecidas não-frustração (camada 1, roda com crédito); `evals/stt` com gabarito de 10–15 frases (os áudios ficam em `evals/stt/audios/`, gerados depois com crédito; o script pula com aviso se a pasta estiver vazia) e métrica de erro por palavra + acerto de números/datas/unidades; camada 2 S1–S4 com a v6 sem regressão.
- [ ] **Step 3–4:** `pnpm vitest run packages/ai && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — "Adiciona a triagem v6 com frustração e o cliente de transcrição de áudio".

### Task 4: Worker — handoff automático, entrega humana e áudio

**Files:** Modify `packages/whatsapp/src/client.ts` (+ teste), `packages/config/src/env.ts`, `apps/worker/src/main.ts`, `apps/worker/src/jobs/process-conversation.ts`; Create `apps/worker/src/jobs/deliver.ts`, `apps/worker/src/audio.ts` + testes `deliver.db.test.ts`, `process-conversation-handoff.db.test.ts`, `process-conversation-audio.db.test.ts`.

**Interfaces:**
```ts
// whatsapp
export function downloadMedia(cfg, mediaId: string, p: { maxBytes: number }): Promise<{ ok: true; bytes: Uint8Array; mime: string } | { ok: false; code: string }> // GET /{media-id} ⇒ { url, mime_type, file_size }; recusa file_size > maxBytes antes de baixar; GET url com Bearer
// env do worker: AI_STT_MODELS (csv opcional), AI_STT_USD_POR_MIN (número, padrão 0.01)
// worker/audio.ts
export function prepararAudio(deps, msg): Promise<{ tipo: 'texto'; texto: string; segundos: number; run: AiRunInput } | { tipo: 'resposta'; reply: 'midiaNaoSuportada' | 'audio_longo' | 'audio_falhou' | 'modoEconomico' }>
```
**Regras:**
- **Handoff:** todo handoff grava `estado 'aguardando_humano'`, `aguardando_desde = now()` (se nulo), `handoff_motivo`; a resposta usa `handoff_fora` (com `textoProximoHorario`) quando `proximoHorarioHumano(...).aberto === false && proximo != null`, senão `handoff_dentro` (ou `handoff_frustracao` para frustração dentro do horário). Gatilhos novos: `falhas_consecutivas` chegando a 2 ⇒ motivo `falhas`; `frustracao` ⇒ responde os itens respondíveis e acrescenta a mensagem de handoff (motivo `frustracao`). Pendência 1: as bolhas de handoff continuam autor `sistema` (a inbox mostra "Sistema")— decisão: nessa mensagem, as respostas dos itens também são gravadas com autor `sistema`, para o `deliver` não cancelá-las depois da mudança de estado (teste).
- **Unidade de contexto:** gravar `unidade_contexto_id` com a unidade resolvida (S1–S4, escolha na lista, pendente) na mesma transação do commit.
- **Entrega humana:** job `conversation.deliver` chama o `deliver()` existente (extraído para `deliver.ts` e reutilizado pelo process); `autor 'humano'` nunca é cancelado; conversa simulada ⇒ `simulado`.
- **Áudio** (antes do pré-filtro de mídia): sem `AI_STT_MODELS` ⇒ `midiaNaoSuportada` (comportamento atual); baixa (`maxBytes` 16 MB; simulada ⇒ baixa do bucket `audios-simulados` pelo `storage.ts` e **apaga** o objeto em qualquer desfecho); `duracaoEstimada > 120` ⇒ `audio_longo`; reserva `custoSttUsd` (escopo `ia`) — sem saldo ⇒ caminho de modo econômico existente; `transcrever`; liquida pelo custo real (ou estimado se o provedor não informar) e estorna em falha; `ai_runs` `etapa 'stt'` com `audio_segundos`; grava `messages.texto` (redigido como texto comum na triagem), `transcrito = true`, `midia_ref = { mediaId, duracao_s }`; segue o fluxo normal. Bytes nunca vão para log/Sentry.
- Mensagem de áudio da conversa que está com humano: transcreve mesmo assim (o atendente lê a transcrição) — reserva igual; sem STT ⇒ fica "🎤 Áudio não transcrito".

- [ ] **Step 1: Testes (falham):** `downloadMedia` (sucesso, `file_size` grande recusado sem baixar, 401/404); handoff por 2 falhas, por frustração (itens respondidos + handoff), fora do horário (texto com próximo horário), `aguardando_desde`/`handoff_motivo` gravados; `unidade_contexto_id` gravada; `deliver` entrega humana (sucesso, falha ⇒ `falhou:*`, simulada ⇒ `simulado`, IA pendente cancelada com humano); áudio: sem STT, longo, download falhou, sem saldo (nenhuma chamada paga), sucesso (texto, `transcrito`, run `stt`, reserva liquidada, objeto do simulador apagado), conversa com humano transcreve sem responder.
- [ ] **Step 2–4:** implementar; `pnpm vitest run --project db apps/worker && pnpm vitest run packages/whatsapp && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — "Liga o handoff automático, a entrega da resposta humana e a transcrição de áudio no worker".

**Fim do Bloco B → revisão.**

---

## Bloco C — Painel

### Task 5: Conversas (lista, conversa, ações, tempo real e avisos)

**Files:** Create `apps/web/app/(painel)/conversas/{page.tsx,[id]/page.tsx,actions.ts,actions.test.ts}`, `apps/web/components/conversas/{lista,conversa,bolha,compositor,avisos}.tsx` + testes, `apps/web/lib/realtime/use-inbox.ts`, `lib/schemas/conversas.ts`; Modify `components/shell/bottom-nav.tsx` (+ teste), `app/(painel)/page.tsx` (cartão linka a inbox; "Tempo até assumir (hoje)"), `app/(painel)/mais/page.tsx` (link Unidades), `components/conversations/awaiting-human.tsx`.

**Regras:**
- Actions: `assumirAction`, `responderAction` (depois do commit chama `enqueueDeliver`), `reenviarAction`, `devolverAction`, `encerrarAction`, `mostrarTelefoneConversaAction` (padrão da Etapa 04, auditado) — papéis dono/gerente/atendente; `forcar` só dono/gerente (confirmação no diálogo).
- Lista e conversa como Server Components (`force-dynamic`); o hook `useInbox(topicos)` assina canais **privados** (`supabase.realtime.setAuth()` antes; `channel(topico, { config: { private: true } })`, evento `mudou`) e chama `router.refresh()` com *debounce* de 500 ms; reconexão; sem conexão ⇒ refresh a cada 60 s. Confirme a API no Context7 (supabase-js atual).
- Tópicos: dono/acesso a todas ⇒ `inbox:r:<restaurant_id>`; demais ⇒ `inbox:u:<unit>` de cada unidade permitida; na conversa aberta ⇒ `conversa:<id>`.
- Avisos (componente no layout do painel): contador de Aguardando no ícone de Conversas e no `document.title`; som curto (arquivo em `public/`, liga/desliga com `localStorage` em try/catch); "Ativar avisos" ⇒ `Notification.requestPermission()`; notificação "Nova conversa aguardando atendente" só quando o contador **sobe** e a aba não está em foco. Sem PII.
- Compositor: desabilitado fora da janela com o texto da spec; respostas rápidas num menu; 1–4096; Enter envia no desktop, botão no celular; estado enviando/enviado/falhou + "Tentar de novo".
- Bolhas: autor (cliente, IA, nome do atendente, sistema), áudio "🎤 *texto*" ou "🎤 Áudio não transcrito", mídia como no simulador; carregar anteriores.
- Celular primeiro (360 px), alvos 44 px, estado vazio que ensina ("Nenhuma conversa aguardando. Quando a IA passar alguém para a equipe, aparece aqui.").

- [ ] **Step 1: Testes (falham):** actions (sem sessão, papel, erros da DAL mapeados para mensagens, `forcar` de atendente recusado, enfileira só após sucesso); componentes (compositor fora da janela, menu de respostas rápidas, bolhas por autor, contador e título); hook com cliente Realtime falso (assina tópicos certos, refresh com debounce, fallback de 60 s); bottom-nav com Conversas e sem Unidades.
- [ ] **Step 2–4:** implementar; `pnpm vitest run apps/web && pnpm typecheck && pnpm lint`.
- [ ] **Step 5: Commit** — "Adiciona a inbox de conversas com tempo real e avisos no painel".

### Task 6: Atendimento humano, respostas rápidas, áudio no simulador e responsável do evento

**Files:** Create `apps/web/app/(painel)/mais/atendimento-humano/{page.tsx,actions.ts,actions.test.ts}`, `components/painel/horario-humano.tsx`, `components/painel/respostas-rapidas.tsx`; Modify Conteúdo → Mensagens (seção "Respostas rápidas"), simulador (anexar áudio: upload para `audios-simulados` com o cliente do usuário, magic bytes de ogg/mp3/m4a/wav, ≤ 16 MB, cria mensagem simulada `tipo 'audio'`), seletor e DAL do responsável do pedido de evento (pendência 5: só quem acessa a unidade do pedido; DAL recusa `responsavel_sem_acesso`).

- [ ] **Step 1: Testes (falham):** horário humano (só dono salva; validação de turnos; vazio permitido); respostas rápidas (CRUD, limite 30, atendente só lê); upload de áudio no simulador (tipo falso recusado, tamanho, cria mensagem e enfileira o processo); responsável sem acesso recusado.
- [ ] **Step 2–4:** implementar; `pnpm vitest run apps/web && pnpm vitest run --project db packages/db/src/painel-eventos.db.test.ts && pnpm typecheck && pnpm lint`; **`pnpm check`** no fim do bloco.
- [ ] **Step 5: Commit** — "Adiciona o horário de atendimento humano, as respostas rápidas e o áudio no simulador".

**Fim do Bloco C → revisão.**

---

## Bloco D — E2E e registros

### Task 7: E2E, homologação e registros

- [ ] **E2E `apps/web/e2e/inbox.spec.ts`** (IA e STT falsos; o OpenRouter falso ganha `/audio/transcriptions` com texto fixo; worker do e2e com `AI_STT_MODELS=e2e/falso`): simulador "quero falar com um atendente" ⇒ em outra aba/contexto, Conversas → Aguardando mostra a conversa **sem recarregar** (com "Mostrar simulações") ⇒ assumir ⇒ responder ⇒ resposta aparece no simulador ⇒ devolver à IA ⇒ IA responde; gerente restrito não vê conversa de outra unidade; resposta rápida; horário humano salvo e handoff fora do horário com o texto do próximo horário (relógio simulado); áudio no simulador ⇒ "🎤 …" com a transcrição falsa e resposta da IA; 360 px.
- [ ] **E2E completo verde; docs:** `docs/homologacao/etapa-06.md` (inbox, avisos — permitir notificação no navegador —, horário humano, respostas rápidas, áudio no simulador; observação: STT real precisa de `AI_STT_MODELS` e crédito, escolher pelo `eval:stt`; frustração medida pelo `eval:frustracao` com crédito; como iniciar painel e worker com a chave de serviço só no shell); PRD (spec §10 + adendo Etapa 06); PLAN (itens da Etapa 06 com data e evidência; pendências novas); CLAUDE "Onde paramos"; `cp CLAUDE.md AGENTS.md`.
- [ ] **Verificação final:** `pnpm check` + e2e; banco pronto (`db:migrate`, bootstrap se faltar, `demo:s1` com horário humano de demonstração seg–sex 9h–18h e 2 respostas rápidas).
- [ ] **Commit** — "Adiciona o e2e e o roteiro de homologação da Etapa 06".

**Fim do Bloco D → revisão final da branch → onda única de correções → re-revisão.**
