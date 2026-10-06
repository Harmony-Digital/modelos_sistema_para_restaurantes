# PRD — Atendimento por IA via WhatsApp (restaurante multiunidade)

> **Status:** v1.0 — aprovado em conversa de arquitetura em 05/10/2026 (seções 1–5).
> Este documento é a **spec técnica**: entidades, regras, invariantes, LGPD e integrações.
> O [PLAN.md](PLAN.md) diz *o que fazer e em que ordem*; este PRD diz *as regras que o resultado tem de respeitar*.
> Conflito entre os dois: **o invariante do PRD vence**.

---

## 1. Visão e objetivo

Atendimento ao cliente final de um restaurante com várias unidades, feito **do início ao fim por agentes de IA** pelo **WhatsApp oficial (Meta Cloud API)**, com transferência para um humano quando o cliente pedir ou quando a IA não conseguir resolver.

### 1.1 Escopo de atendimento (4 serviços)

| # | Serviço | O que a IA faz |
|---|---|---|
| S1 | Horários, funcionamento e unidades | Responde horários (incl. feriados/exceções), "está aberto agora?", endereços, como chegar, informações gerais aprovadas (estacionamento, pets, acessibilidade…) |
| S2 | Aviso de presença | Registra "hoje vou na unidade X com N pessoas". **Não é reserva** — é previsão de movimento para a unidade |
| S3 | Eventos | Informa espaços/condições e **coleta** pedido de reserva de espaço (data, unidade, convidados, tipo). Confirmação é sempre humana |
| S4 | Cardápio | Envia o cardápio (PDF/imagem) e responde perguntas ("tem carne de sol?") com base no cardápio cadastrado, por unidade |

### 1.2 Fora de escopo (MVP)
- Qualquer assunto não relacionado ao restaurante (clima, notícias, conhecimentos gerais, código etc.) — **bloqueado antes do modelo principal**.
- Reservas reais de mesa, pagamentos, pedidos/delivery.
- Mensagens ativas de marketing (só com opt-in, futuro).
- Outros canais (site/chat, Instagram) — o motor é desacoplado do canal para permitir no futuro.
- Multi-tenant/SaaS — um restaurante, mas todas as tabelas têm `restaurant_id` para não fechar a porta.

### 1.3 Critérios de sucesso
1. Cliente resolve qualquer um dos 4 serviços pelo WhatsApp **sem intervenção humana**.
2. Perguntas fora do escopo **não consomem tokens do modelo principal**.
3. Gasto de IA e WhatsApp **nunca ultrapassa** o teto configurado pelo dono.
4. Todo dado pessoal tem base legal, prazo de retenção e caminho de exclusão.
5. Nenhuma informação de preço, horário ou endereço é inventada: tudo vem de dado aprovado.

### 1.4 Usuários
| Papel | Quem | Pode |
|---|---|---|
| `dono` | Proprietário | Tudo, incl. limites de gasto, usuários, LGPD, DPO |
| `gerente` | Gerente de unidade/geral | Cadastros (unidades, horários, cardápio, eventos, documentos), inbox, relatórios das unidades permitidas |
| `atendente` | Equipe | Inbox (assumir/devolver conversas), fila de eventos e avisos das unidades permitidas |
| Cliente final | Pessoa no WhatsApp | Conversa com a IA; pede humano; exerce direitos LGPD |

---

## 2. Arquitetura

### 2.1 Decisões (com justificativa resumida)

| Tema | Decisão | Motivo |
|---|---|---|
| Linguagem | TypeScript strict em tudo (**TS 6.0.x** — o typescript-eslint ainda não suporta TS 7) | Uma linguagem, tipos do banco à tela |
| Monorepo | pnpm workspaces + Turborepo | Compartilhar domínio entre web e worker |
| Web/painel + webhook | **Next.js 16 (App Router)** na **Vercel Pro, região gru1** | HTTPS/CDN/deploy por PR; webhook altamente disponível mesmo com worker fora |
| Back-end | **Sem NestJS/tRPC.** Route Handler (webhook) + Server Actions com DAL (painel) + worker Node | Server Actions já dão RPC tipado; menos código e superfície |
| Worker | **Node 24 LTS** em Docker na **VPS Hostinger KVM 4** existente | Processo sempre ligado; **nenhuma porta de entrada exposta** (só conexões de saída) |
| Banco | **Supabase Postgres, região sa-east-1 (São Paulo)** | Empresa já usa; dados no Brasil |
| Acesso a dados | **Drizzle ORM** + driver `postgres`; tabelas no schema TS; **RLS, roles, grants e funções em migrations SQL custom** (`drizzle-kit generate --custom`) | Tipado, SQL previsível; policies restritivas (aal2), helpers e grants do `worker_app` ficam legíveis em SQL puro |
| Supabase no browser | `@supabase/ssr` **somente** Auth, upload ao Storage e Realtime | Dados do painel sempre via servidor (DAL) |
| Fila | **pg-boss 12** (no próprio Postgres) | Fila `conversation.process` com policy **`stately`** + `singletonKey = conversationId` + `startAfter: 4s` (agrupa rajadas e serializa por conversa), retry/backoff, DLQ, cron, enfileirar na mesma transação |
| Redis | **Não usar** no MVP | Volume não justifica; menos um serviço/fornecedor com dado pessoal. Upstash só se métricas exigirem |
| Storage | **Supabase Storage** (bucket privado, RLS em `storage.objects`, URL assinada) | Mesma região/auth; R2 não tem location hint na América do Sul (complica LGPD) e o egress aqui é irrisório |
| IA | **Produção: OpenAI direto** (`AI_PROVIDER=openai`); **desenvolvimento local: OpenRouter** (`AI_PROVIDER=openrouter`, padrão). Clientes finos próprios (`fetch` + Zod) sobre as APIs REST, em `packages/ai`, atrás da mesma interface `LlmClient` | OpenRouter: fallback de modelos (`models`), `provider: { data_collection: 'deny', zdr: true, require_parameters: true }`, `usage.cost` por chamada. OpenAI: `/chat/completions` com `store: false`, `json_schema` estrito, PDF como parte `file`, custo calculado por tabela de preços em código (modelo sem preço ⇒ worker não sobe). Sem dependência dos nomes de campo do SDK, testável com `fetch` injetado (decisões de 05/10/2026 e de 06/10/2026, ver Adendo) |
| WhatsApp | Cliente próprio fino (fetch + Zod) em `packages/whatsapp` | Superfície pequena; HMAC sob nosso controle; menos supply chain |
| Validação | Zod 4 | Env, webhook, Server Actions, saída do LLM |
| UI | Tailwind v4 + shadcn/ui; **design system definido na Etapa 02** | |
| Observabilidade | Sentry (web + worker), logs JSON com PII mascarada, heartbeat do worker | |
| Testes | Vitest, Playwright, evals de IA | |

### 2.2 Diagrama

```
Cliente (WhatsApp)
   │
Meta Cloud API ──webhook (X-Hub-Signature-256)──▶ apps/web — Next.js 16 @ Vercel gru1
                                                   │  1. valida HMAC sobre corpo bruto
                                                   │  2. INSERT messages (wamid único) + job pg-boss (mesma transação)
                                                   │  3. responde 200
                                                   ▼
                              Supabase Postgres sa-east-1 (RLS · pg-boss · pg_trgm · unaccent · pg_cron · Vault)
                              Supabase Storage (privado) · Supabase Auth (MFA) · Realtime Broadcast (privado)
                                                   ▲
apps/worker — Node 24 @ VPS Hostinger (Docker, sem portas abertas)
   pré-filtro → (áudio→STT) → triagem → orçamento → contexto → resposta+tools → envio Meta → registro
   │                                   │
   └─ OpenAI (prod) / OpenRouter (dev) ◀┘          Meta Graph API (envio)
```

### 2.3 Estrutura do repositório

```
ia-atendimento/
├── CLAUDE.md · AGENTS.md (cópia idêntica) · PLAN.md · PRD.md
├── apps/
│   ├── web/        Next.js: painel, /api/whatsapp/webhook, página pública de privacidade
│   └── worker/     Node: consumidores pg-boss, crons, Dockerfile, docker-compose de produção
├── packages/
│   ├── core/       domínio puro (sem I/O direto): serviços S1–S4, pré-filtro, triagem, orçamento, redação de PII
│   ├── db/         schema Drizzle, migrations, policies RLS, seeds, cliente com contexto RLS
│   ├── whatsapp/   cliente Cloud API, verificação HMAC, schemas Zod do webhook
│   ├── ai/         clientes LLM (OpenAI e OpenRouter), prompts versionados, definição de tools, evals
│   └── config/     tsconfig, eslint, schema de env (Zod, validado no boot)
├── supabase/       config do Supabase CLI (dev local)
└── docs/           runbooks (deploy, incidente LGPD), RIPD, decisões
```

### 2.4 Conexões ao banco
- **Vercel (serverless)** → pooler Supavisor em modo *transaction*, `postgres(url, { prepare: false })`.
- **Worker** → conexão *session*/direta (processo de longa duração com prepared statements, que o modo transaction não suporta; o pg-boss 12 usa polling por padrão, `useListenNotify: false`).
- **Painel** → consultas dentro de transação com contexto RLS do usuário: `select set_config('request.jwt.claims', $1, true)` **parametrizado** + `set local role authenticated`. **Proibido** montar esse SQL com `sql.raw` (o exemplo oficial do Drizzle faz isso; é vetor de SQL injection).
- **Worker** → role Postgres próprio (`worker_app`), grants mínimos por tabela; **nunca** `service_role`/superuser.

---

## 3. Modelo de dados

Convenções:
- Toda tabela de negócio tem `restaurant_id uuid not null` e **RLS habilitada**.
- `timestamptz` sempre; "dia de negócio" calculado em `America/Sao_Paulo` (`restaurants.timezone`).
- Preços: `integer` em centavos. Custos: `numeric(12,6)` em USD (conversão BRL exibida no painel com cotação configurável). Nunca `float`.
- IDs `uuid` (`gen_random_uuid()`) nas entidades; **`bigint generated always as identity`** nas tabelas de alto volume (`messages`, `ai_runs`, `spend_ledger`, `audit_log`).
- `created_at`/`updated_at` em todas; `updated_at` via trigger.

### 3.1 Estrutura e informações (S1)

| Tabela | Campos principais | Índices / restrições |
|---|---|---|
| `restaurants` | id, nome, timezone, persona_ia (texto curto), mensagens_padrao jsonb, horario_atendimento_humano jsonb, dpo_nome, dpo_contato, politica_url | 1 linha |
| `units` | id, nome, slug, apelidos `text[]`, endereco, bairro, cidade, uf, cep, lat, lng, maps_url, telefone, ativo | único `(restaurant_id, slug)`; GIN trigram em `nome` e `apelidos` |
| `unit_hours` | unit_id, weekday (0–6), abre `time`, fecha `time` (fecha < abre ⇒ vira o dia) | `(unit_id, weekday)`; vários turnos por dia permitidos; check de não sobreposição na aplicação + teste |
| `unit_hour_exceptions` | unit_id, data, fechado bool, abre, fecha, motivo | único `(unit_id, data)` |
| `knowledge_facts` | id, tema, titulo, texto (aprovado), unit_id nullable, ativo, `search tsvector` gerado | GIN em `search` (config `portuguese` + `unaccent`) |

### 3.2 Avisos de presença (S2)

| Tabela | Campos | Índices / restrições |
|---|---|---|
| `attendance_notices` | id, unit_id, customer_id (nullable, `ON DELETE SET NULL`), nome (opcional: nome de perfil do WhatsApp ou digitado no painel), data, pessoas (1–60), horario_aprox (texto curto, ≤ 40), status (`ativo`/`cancelado`), origem (`ia`/`painel`), simulado bool, criado_por (nullable), anonimizado bool | **único parcial** `(customer_id, unit_id, data) WHERE status='ativo'` (novo aviso do mesmo cliente/unidade/dia **atualiza**); `(unit_id, data)` |

### 3.3 Eventos (S3)

| Tabela | Campos | Índices |
|---|---|---|
| `event_spaces` | id, unit_id (FK composta com restaurant_id), nome, capacidade_min, capacidade_max (1–1000, min ≤ max), descricao, condicoes, ativo (desativar em vez de apagar) | único `(unit_id, nome)`; `(restaurant_id, unit_id)` |
| `event_requests` | id, customer_id (nullable, `ON DELETE SET NULL` — sobrevive à exclusão do cliente anonimizado), unit_id, space_id nullable (FK composta `(space_id, unit_id)`: espaço da mesma unidade), nome (perfil do WhatsApp), data, convidados (1–1000), tipo (enum `aniversario`/`casamento`/`corporativo`/`confraternizacao`/`outro`), tipo_texto (≤ 60, como o cliente disse), observacoes (automáticas, ≤ 300), status (`novo`/`em_contato`/`confirmado`/`recusado`/`cancelado`), responsavel_id, notas_internas (≤ 2000), simulado, anonimizado — Etapa 04, ver adendo | `(restaurant_id, status, data)`; `(restaurant_id, unit_id, data)`; `(customer_id, data)` |

### 3.4 Cardápio (S4)

| Tabela | Campos | Índices |
|---|---|---|
| `menu_categories` | id, nome, ordem, ativo — Etapa 05: nome único por restaurante (normalizado) | `(restaurant_id, ordem)` |
| `menu_items` | id, category_id, nome, descricao, preco_centavos (**nullable** = "sob consulta" — Etapa 05), tags `text[]` (vegano, sem_gluten, …), outros_nomes `text[]` (Etapa 05), disponivel, ordem (Etapa 05), `search tsvector` gerado (nome peso A, descrição/outros nomes/tags peso B, `portuguese` + `unaccent`) | GIN em `search`; GIN trigram em `nome` e em outros nomes (erros de digitação); nome único por categoria (normalizado) |
| `menu_item_units` | item_id, unit_id, disponivel, preco_override_centavos nullable | PK `(item_id, unit_id)`. **Só exceções**: sem linha ⇒ item vale em todas as unidades com preço base |
| `menu_files` | id, unit_id nullable, titulo, storage_path, mime, tamanho, sha256, wa_media_id, wa_media_expires_at, ativo | `wa_media_id` reaproveitado até expirar |

### 3.5 Conversas

| Tabela | Campos | Índices / restrições |
|---|---|---|
| `customers` | id, wa_id_hash (HMAC-SHA256 do wa_id com pepper), telefone_cifrado (AES-256-GCM), nome_perfil, unidade_preferida_id, privacy_notice_sent_at, ultima_interacao_at, bloqueado_ate | único `(restaurant_id, wa_id_hash)`; `(ultima_interacao_at)` para retenção |
| `conversations` | id, customer_id, processed_up_to_id (último `messages.id` de entrada já processado), estado (`ia`/`aguardando_humano`/`humano`/`encerrada`), atendente_id, unidade_contexto_id (Etapa 06: última unidade resolvida; define quem vê a conversa), resumo, falhas_consecutivas, window_expires_at, last_message_at, handoff_motivo, aguardando_desde (Etapa 06; ver adendo) | parcial `(estado, last_message_at DESC) WHERE estado <> 'encerrada'`; no máx. 1 conversa aberta por cliente (único parcial) |
| `messages` | id bigint, conversation_id, direcao (`in`/`out`), autor (`cliente`/`ia`/`humano`/`sistema`), wamid, tipo (`texto`/`audio`/`imagem`/`documento`/`outro`), texto, transcrito bool, midia_ref, status_envio, ai_run_id, atendente_id (Etapa 06: quem respondeu) | **único `(wamid)`** (idempotência); `(conversation_id, created_at DESC)` |

### 3.6 IA, custos e limites

| Tabela | Campos | Índices / regras |
|---|---|---|
| `ai_runs` | id bigint, conversation_id, etapa (`triagem`/`resposta`/`stt`/`ingestao`), modelo, prompt_version, tokens_in, tokens_out, tokens_cache, audio_segundos, cost_usd, latencia_ms, intent, resultado, erro | BRIN em `created_at`; `(conversation_id)` |
| `budget_limits` | escopo (`ia`/`whatsapp`), periodo (`dia`/`mes`), limite_usd, alerta_pct (padrão 80), acao (`modo_economico`/`bloquear`) | único `(restaurant_id, escopo, periodo)` |
| `budget_counters` | escopo, periodo, inicio_periodo, reservado, gasto | único `(restaurant_id, escopo, periodo, inicio_periodo)` |
| `spend_ledger` | id bigint, escopo, tipo (`reserva`/`liquidacao`/`estorno`), valor_usd, ref (ai_run_id / wamid) | auditoria do gasto |

**Reserva atômica (invariante I6):**
```sql
UPDATE budget_counters
   SET reservado = reservado + $est
 WHERE restaurant_id = $r AND escopo = $e AND periodo = $p AND inicio_periodo = $i
   AND gasto + reservado + $est <= $limite
RETURNING id;   -- 0 linhas ⇒ sem saldo
```
Após a chamada: `reservado -= $est, gasto += $real` (custo real de `usage.cost`). Verificação feita para **dia e mês**; a chamada só ocorre se ambos reservarem.

### 3.7 Ingestão de documentos

| Tabela | Campos |
|---|---|
| `knowledge_documents` | id, storage_path, mime, tamanho, sha256 (dedup), alvo (`cardapio`/`horarios`/`unidades`/`eventos`/`geral`), status (`enviado`/`processando`/`rascunho`/`aprovado`/`rejeitado`/`erro`), draft jsonb, enviado_por, revisado_por, revisado_at — Etapa 05: criada só para `alvo = 'cardapio'`, com `origem` (`csv`/`arquivo`) e `erro` (mensagem amigável); ver adendo |

### 3.8 Administração e LGPD

| Tabela | Campos | Regras |
|---|---|---|
| `staff` | user_id (→ `auth.users`), papel (`dono`/`gerente`/`atendente`), unidades_permitidas `uuid[]` (vazio = todas), ativo | base das policies RLS |
| `audit_log` | id bigint, ator_id, ator_tipo (`staff`/`ia`/`sistema`), acao, entidade, entidade_id, diff jsonb, ip, created_at | **append-only**: `REVOKE UPDATE, DELETE` de todos os roles de app |
| `data_subject_requests` | id, customer_id, tipo (`acesso`/`exclusao`/`correcao`), status (`aberto`/`em_andamento`/`concluido`/`negado`), prazo (`created_at + 15 dias`), resolvido_por, resposta | alerta no painel ao se aproximar do prazo |
| `retention_settings` | dado, dias, acao (`apagar`/`anonimizar`) | lidos pelo cron diário |
| `worker_heartbeats` | worker_id, versao, last_seen_at | painel mostra "IA online" |

---

## 4. Pipeline da IA

### 4.1 Recebimento (web)
1. `GET /api/whatsapp/webhook`: verificação `hub.verify_token` (comparação em tempo constante).
2. `POST`: lê **corpo bruto**, valida `X-Hub-Signature-256` (HMAC-SHA256 com app secret, `timingSafeEqual`). Inválido ⇒ 401, nada gravado.
3. Valida o payload com Zod; ignora eventos não suportados (registra métrica).
4. Em **uma transação**: upsert de `customers`, obtém/abre `conversations`, `INSERT messages … ON CONFLICT (wamid) DO NOTHING`; se inseriu, `send('conversation.process', {conversationId}, { singletonKey: conversationId, startAfter: 4, db: tx })`. Com a policy `stately`, existe no máximo 1 job enfileirado e 1 ativo por conversa: mensagens da mesma rajada não criam job novo (o job pendente processa todas), e uma conversa nunca é processada em paralelo.
5. Status de entrega (`sent`/`delivered`/`read`/`failed`) atualizam `messages.status_envio`.
6. Responde 200 em < 500 ms. Nenhuma chamada de IA ou à Meta acontece na requisição.

### 4.2 Processamento (worker) — fila `conversation.process`, policy `stately` por `conversationId`

| Passo | O quê | Custo |
|---|---|---|
| 0. Gate de estado | Conversa em `humano`/`aguardando_humano` ⇒ só grava; IA não responde | 0 |
| 1. Pré-filtro | Regex/palavras-chave: pedido de humano ⇒ handoff; saudação/agradecimento/emoji ⇒ resposta pronta; tipo não suportado (vídeo, sticker…) ⇒ resposta pronta; flood (> 10 msgs/min) ⇒ silencia temporariamente e marca; pedido LGPD ("apagar meus dados") ⇒ cria `data_subject_requests` | 0 tokens |
| 1.5 Áudio (adiado na Etapa 06 para melhoria futura; hoje responde "ainda não consigo ouvir áudio") | Baixa a mídia da Meta imediatamente; > 2 min ⇒ pede versão menor; reserva orçamento; STT `/api/v1/audio/transcriptions` (`language: "pt"`, ZDR); **descarta o arquivo**; texto segue no fluxo | centavos |
| 2. Triagem | Modelo pequeno, saída `json_schema` ⇒ `intent ∈ {horario_unidades, aviso_presenca, evento, cardapio, humano, lgpd, fora_escopo, multiplo}`; `fora_escopo` ⇒ resposta fixa. Etapa 04: com pergunta pendente, recebe a pergunta (texto nosso) e o pedido em andamento fora do bloco do cliente (ver adendo) | ~150–300 tokens |
| 3. Orçamento | Reserva atômica dia+mês; sem saldo ⇒ **modo econômico** (respostas fixas + handoff) e alerta ao dono | 0 |
| 4. Contexto mínimo | Só o que a intenção precisa (horários da unidade X; top-k itens do cardápio por full-text) + últimas ~10 mensagens + resumo | — |
| 5. Resposta | Modelo principal com tools tipadas; máx. 3 iterações de tool; saída validada com Zod | principal |
| 6. Envio e registro | Envia pela Meta; grava `messages` (out), `ai_runs` (custo real), liquida reserva, `audit_log` para ações (registros S2/S3) | — |

### 4.3 Tools (únicas ações possíveis do LLM)

| Tool | Efeito | Validações no código |
|---|---|---|
| `listar_unidades` | Lista unidades ativas | — |
| `horarios_unidade(unidade, data?)` | Horários + exceções; calcula "aberto agora" no fuso | unidade existente |
| `buscar_info(tema)` | `knowledge_facts` aprovados | — |
| `buscar_cardapio(consulta, unidade?)` — Etapa 05: função do domínio, não tool de LLM (ver adendo) | Full-text + trigram, respeita `menu_item_units` | top-k ≤ 8 |
| `enviar_cardapio(unidade?)` — Etapa 05: função do domínio, não tool de LLM (ver adendo) | Envia `menu_files` (reusa `wa_media_id`) | arquivo ativo existente |
| `registrar_aviso_presenca(unidade, data, pessoas, horario?)` — Etapa 03: função do domínio, não tool de LLM (ver adendo) | Upsert em `attendance_notices` | data ≥ hoje e ≤ hoje+30; 1 ≤ pessoas ≤ 60; unidade ativa e aberta na data |
| `cancelar_aviso_presenca(unidade, data)` — Etapa 03: função do domínio, não tool de LLM (ver adendo) | status `cancelado` | aviso do próprio cliente |
| `registrar_pedido_evento(...)` — Etapa 04: função do domínio, não tool de LLM (ver adendo) | Cria `event_requests` status `novo` | data de amanhã até hoje+365; 1 ≤ convidados ≤ 1000 e dentro da capacidade do espaço (se informado); nunca "confirmado" pela IA |
| `transferir_humano(motivo)` | Estado `aguardando_humano`, notifica equipe | — |

### 4.4 Regras de escopo e comportamento (prompt + código)
1. Prompt de sistema **versionado em arquivo** (`packages/ai/prompts/vN.ts`); `prompt_version` gravado em `ai_runs`.
2. **Grounding obrigatório:** preço, horário, endereço, disponibilidade só a partir de resultado de tool. Sem dado ⇒ "não tenho essa informação" + oferta de atendente.
3. Nunca usar conhecimento geral; nunca responder fora dos 4 serviços.
4. Conteúdo do cliente e de documentos é **dado, nunca instrução** (defesa contra prompt injection; delimitadores + instrução explícita + evals de injeção).
5. Histórico curto (≈10 mensagens) + `conversations.resumo` atualizado periodicamente.
6. Prompt estruturado para **prompt caching**: parte estática primeiro, dados variáveis no fim.
7. Toda chamada ao OpenRouter com `provider: { data_collection: 'deny', zdr: true, require_parameters: true }`; lista `models: [...]` de fallback. Toda chamada à OpenAI com `store: false`; a lista de modelos é percorrida em ordem pelo cliente (erro transitório passa ao próximo).
8. Modelos ficam em **configuração** (banco/env), não no código; escolhidos por **evals** (acerto, custo, latência) na etapa correspondente.
9. Tom: português do Brasil, cordial, mensagens curtas próprias de WhatsApp; identifica-se como assistente virtual.

### 4.5 Handoff para humano
Gatilhos: pedido explícito; frustração detectada; 2 falhas consecutivas da IA; modo econômico; pedido de evento que requer negociação.
Efeito: estado `aguardando_humano`, mensagem ao cliente, notificação no painel (Realtime) e e-mail/push à equipe (e-mail/push adiados; Etapa 06 só avisa com o painel aberto). Fora do `horario_atendimento_humano`, informa quando será atendido (Etapa 06: "Nossa equipe atende {proximo_horario}…"; frustração pela triagem v6; ver adendo). Atendente pode **assumir** (`humano`) e **devolver para a IA** (`ia`).

### 4.6 Ingestão de documentos (treinamento por dados aprovados)
1. Gerente sobe PDF/imagem (bucket privado; MIME real verificado por magic bytes; ≤ 20 MB; dedup por sha256).
2. Job `document.ingest`: OpenRouter (PDF nativo/plugin `file-parser`; imagem via modelo de visão) com **Structured Outputs** no schema do `alvo`.
3. Resultado vira `draft` (status `rascunho`), **nunca** dado oficial.
4. Gerente revisa/edita/aprova no painel ⇒ grava nas tabelas oficiais (cardápio, horários, fatos…) com `audit_log`.
5. A IA de atendimento **nunca** lê o documento bruto — só tabelas oficiais.

### 4.7 "Treinamento" da IA
Não há fine-tuning. A IA é "treinada" por: (a) dados aprovados no banco; (b) prompt versionado; (c) **evals** — conjunto de conversas-gabarito por serviço, fora de escopo, injeção e áudio. Todo erro real vira caso de eval. Mudança de prompt/modelo só vai a produção se não regredir nos evals.

### 4.8 Erros
| Falha | Tratamento |
|---|---|
| OpenRouter indisponível / 5xx | Dentro do mesmo job: 1 nova tentativa com o próximo modelo da lista (fallback); se falhar de novo → resposta fixa + handoff (sem retry do pg-boss, para não gastar nem atrasar o cliente). O retry do pg-boss (backoff exponencial, até 3) cobre crash do worker, erro de banco e falha temporária de entrega na Meta |
| OpenRouter 402 (crédito/guardrail) | Modo econômico + alerta ao dono |
| Meta 5xx / rate limit | Retry com backoff |
| Meta erro permanente (bloqueio, janela expirada, número inválido) | Registra, não retenta |
| Saída do LLM inválida (Zod) | 1 nova tentativa com mensagem de correção; depois resposta fixa |
| Job esgotou tentativas | DLQ `conversation.process.dlq` + alerta Sentry |

---

## 5. Custos e limites

1. **Camada 1 — nosso banco:** reserva atômica antes de cada chamada (§3.6), liquidação pelo custo real. Limites diário e mensal por escopo (`ia`, `whatsapp`), alerta em `alerta_pct` (padrão 80%) e ação ao estourar.
2. **Camada 2 — provedor:** em produção (OpenAI), **projeto** na plataforma da OpenAI com **limite de gasto mensal** e só os modelos usados liberados; no OpenRouter (dev), API key com `limit` mensal + **Guardrail** com `limit_usd`, `reset_interval` e `enforce_zdr`. Protege contra bug na camada 1.
3. **WhatsApp:** respostas dentro da janela de atendimento de 24h aberta pelo cliente não são cobradas; mensagens de template (iniciadas pela empresa) são contabilizadas no escopo `whatsapp` e limitadas. Tabela de preços por categoria/país configurável no painel.
4. Custos exibidos em USD e BRL (cotação configurável).

---

## 6. LGPD e privacidade

> Implementação técnica que sustenta a conformidade. **Política de privacidade, LIA e RIPD exigem revisão jurídica** antes do go-live.

### 6.1 Papéis
- **Controlador:** o restaurante. **Encarregado (DPO):** indicado pelo dono no painel; publicado na política.
- **Suboperadores:** Supabase (sa-east-1), Vercel, Hostinger, Meta (WhatsApp), **OpenAI** (produção; retenção padrão de 30 dias e transferência internacional, ver §6.5), OpenRouter e provedores de modelo roteados (só desenvolvimento local), Sentry. Lista mantida em `docs/suboperadores.md`.

### 6.2 Base legal por finalidade (art. 7º)
| Finalidade | Base |
|---|---|
| Responder dúvidas, registrar aviso de presença, pedido de evento | V — procedimentos preliminares/execução de contrato a pedido do titular |
| Histórico para continuidade e métricas do atendimento | IX — legítimo interesse (LIA documentado em `docs/lgpd/lia.md`) |
| Marketing / mensagens ativas | Fora do MVP; se houver, consentimento (opt-in) |

### 6.3 Dado sensível (art. 11)
Alergias, restrições alimentares por saúde e similares são **dado de saúde**. A IA usa a informação **apenas na conversa**; **nunca** grava em campo estruturado/perfil. Fica só no histórico, sujeito à retenção.

### 6.4 Transparência
Primeira interação de cada cliente (e novamente após 12 meses — `privacy_notice_sent_at`): aviso de que é assistente virtual, link para a política (página pública em `apps/web`) e como falar com uma pessoa.

### 6.5 Minimização e segurança do dado
- Coleta: nome de perfil, telefone, conteúdo da conversa. Nada mais.
- Telefone cifrado (AES-256-GCM, chave fora do banco); busca por HMAC com pepper.
- **Redação de PII antes do LLM:** CPF, e-mail, cartão, telefone mascarados no texto enviado ao provedor de LLM. O LLM nunca recebe o número do cliente.
- Áudio descartado após transcrição.
- OpenRouter (desenvolvimento local) com `dataCollection: 'deny'` + ZDR. OpenAI (produção): `store: false`, retenção padrão de 30 dias para monitoramento de abuso, sem uso para treino (aceita pelo time em 06/10/2026), sem região de dados no Brasil; a transferência internacional (art. 33) é coberta na política de privacidade e no RIPD (Etapa 09), que também avaliam pedir ZDR à OpenAI.
- Logs e Sentry com scrub de PII.

### 6.6 Retenção (padrões; configuráveis em `retention_settings`; cron diário)
| Dado | Prazo | Ação |
|---|---|---|
| `messages` (conteúdo) | 90 dias | apagar |
| `attendance_notices` | 30 dias após a data | anonimizar (mantém unidade, dia, pessoas; limpa `nome` e `customer_id`) |
| `event_requests` | 2 anos | anonimizar |
| `ai_runs` | 13 meses | apagar (não contém conteúdo) |
| `customers` sem interação | 12 meses | apagar em cascata |
| `audit_log` | 2 anos | apagar |
| Áudio | 0 (após transcrição) | apagar |

**Pendente:** confirmar prazos com o restaurante/jurídico.

### 6.7 Direitos do titular (art. 18)
Detectados pela triagem/pré-filtro ⇒ `data_subject_requests`. Identidade = o próprio número do WhatsApp. **Acesso:** resumo gerado automaticamente e enviado. **Exclusão:** confirmada pela equipe no painel ⇒ função de exclusão/anonimização em cascata (inclui limpar `attendance_notices.nome` dos avisos do titular, além do `customer_id`). Prazo de 15 dias com alerta.

### 6.8 Incidentes
Runbook em `docs/runbooks/incidente-lgpd.md`: contenção, avaliação, comunicação à ANPD e aos titulares em **3 dias úteis** (Res. CD/ANPD nº 15/2024), registro.

---

## 7. Segurança

1. Webhook: HMAC sobre corpo bruto com `timingSafeEqual`; idempotência por `wamid`; rejeição de payload fora do schema.
2. **RLS em todas as tabelas**; testes automatizados de RLS por papel.
3. Server Actions tratadas como endpoints públicos: **toda** action verifica sessão + papel + unidade na DAL; nunca confiar só no `proxy.ts`.
4. Auth Supabase com **MFA obrigatório** para `dono` e `gerente`; sessão curta; convite de usuários só pelo dono.
5. Segredos (tokens Meta, OpenRouter, chaves de cifra, pepper) em env da Vercel / Docker secrets na VPS; nunca no banco em claro, nunca no cliente; `service_role` nunca no browser.
6. Upload: MIME por magic bytes, limite de tamanho, bucket privado, URLs assinadas de curta duração.
7. Saída do LLM validada por Zod; LLM só age via tools com regras de negócio.
8. Headers de segurança (CSP, HSTS, X-Frame-Options, Referrer-Policy) no Next.
9. Rate limit: painel (login via Supabase Auth) e flood de cliente no pré-filtro.
10. VPS: UFW só SSH por chave, fail2ban, atualizações automáticas de segurança, container não-root, filesystem read-only, sem portas publicadas.
11. Dependências: lockfile, `pnpm audit` no CI, Renovate/Dependabot.
12. `audit_log` append-only para toda mutação do painel e toda ação de tool.

---

## 8. Desempenho e banco

1. Índices casados com as consultas reais (listados no §3); toda consulta nova de caminho quente tem `EXPLAIN ANALYZE` revisado.
2. Busca de cardápio/fatos: `tsvector` gerado (`portuguese` + `unaccent`) + GIN; trigram para nomes.
3. BRIN para séries temporais (`ai_runs`), B-tree composta para `messages`.
4. Retenção via cron mantém tabelas pequenas; `VACUUM`/autovacuum padrão do Supabase.
5. Worker: cache em memória da configuração do restaurante (unidades, horários, prompt), invalidado por `NOTIFY` em mudança.
6. Realtime: **Broadcast em canal privado com RLS** (recomendação atual do Supabase sobre `postgres_changes`), disparado por trigger nas tabelas da inbox (Etapa 06: tópicos e payload no adendo).
7. Metas: webhook p95 < 500 ms; resposta ao cliente p95 < 8 s após o fim do debounce (texto); < 15 s (áudio).

---

## 9. Qualidade, deploy e operação

### 9.1 Testes
| Camada | Ferramenta | Cobre |
|---|---|---|
| Domínio | Vitest (TDD) | Regras S1–S4, "aberto agora" com fuso/feriado/virada de dia, pré-filtro, redação de PII, orçamento |
| Banco | Vitest + Postgres local | RLS por papel, grants do `worker_app`, reserva concorrente (100 paralelas sem estourar), `EXPLAIN` |
| Webhook | Vitest | HMAC válido/inválido, replay, `wamid` duplicado, payloads reais gravados |
| IA | Evals próprios + OpenAI/OpenRouter | Acerto por serviço, fora de escopo, injeção, áudio; custo e latência |
| Painel | Playwright | Login+MFA, CRUDs, inbox, limites |

### 9.2 Ambientes
- **local:** Supabase CLI (Docker) + número de teste Meta.
- **staging:** projeto Supabase separado, preview Vercel, worker de staging (container separado na VPS).
- **produção:** Supabase sa-east-1 com PITR, Vercel Pro gru1, worker na VPS.

### 9.3 CI/CD (GitHub Actions)
lint → typecheck → test → evals (quando `packages/ai` muda) → build. Migrations `drizzle-kit` em staging automáticas; em produção com aprovação manual (GitHub Environments). Worker: imagem no GHCR → VPS `docker compose pull && up -d` via usuário SSH de deploy restrito; SIGTERM drena jobs (`boss.stop()` gracioso).

### 9.4 Observabilidade
Sentry (web + worker) com scrub de PII; logs JSON; `worker_heartbeats` (alerta se fila parada > 2 min); alertas de orçamento (80%/100%) por e-mail; painel de métricas: % resolvido pela IA, custo por conversa, intenções, tempo de resposta.

---

## 10. Invariantes (nunca violar)

| # | Invariante |
|---|---|
| I1 | A IA nunca responde fora dos 4 serviços; fora de escopo não chama o modelo principal. |
| I2 | Preço, horário, endereço e disponibilidade só vêm de dado aprovado no banco (via tool). |
| I3 | O LLM só altera estado por tools tipadas com validação no código. |
| I4 | Documento enviado nunca vira dado oficial sem aprovação humana. |
| I5 | Conversa em `humano`/`aguardando_humano` não recebe resposta da IA. |
| I6 | Nenhuma chamada paga (LLM, STT, template) sem reserva de orçamento bem-sucedida. |
| I7 | Webhook sem HMAC válido não grava nada; mensagem com `wamid` repetido não é reprocessada. |
| I8 | Nenhum dado pessoal sai para o LLM sem redação de PII. No OpenRouter, sempre com `dataCollection: 'deny'` + ZDR; na OpenAI (produção), sempre com `store: false` e retenção padrão de 30 dias aceita pelo time em 06/10/2026 (revisão do invariante; ver Adendo). Produção só com `AI_PROVIDER=openai`. |
| I9 | Dado de saúde nunca é persistido em campo estruturado. |
| I10 | Toda tabela tem RLS; toda Server Action verifica sessão, papel e unidade. |
| I11 | `audit_log` é append-only. |
| I12 | `service_role` e segredos nunca chegam ao browser. |

---

## 11. Pendências abertas

| # | Pendência | Dono | Hipótese em vigor |
|---|---|---|---|
| P1 | Datacenter da VPS Hostinger (ideal: São Paulo) | Dono | Assumir São Paulo; se não for, avaliar migração |
| P2 | Prazos de retenção (§6.6) | Dono + jurídico | Padrões do §6.6 |
| P3 | Cardápio igual ou diferente por unidade | Dono | Modelo suporta ambos (`menu_item_units` só exceções) |
| P4 | Verificação Meta Business + número oficial | Dono | Iniciar já, em paralelo |
| P5 | Revisão jurídica: política, LIA, RIPD | Dono + jurídico | Antes do go-live (Etapa 09) |
| P6 | Modelos de IA (triagem, resposta, STT, ingestão) | Decidido por evals | Etapas 01/02/06/07 |
| P7 | Design system | Dono + Claude | Etapa 02 |

---

## Adendo — Etapa 02 (05/10/2026)

Aprovado em [docs/specs/2026-10-05-etapa-02-s1-design.md](docs/specs/2026-10-05-etapa-02-s1-design.md); prevalece sobre as seções citadas abaixo.
- **§4.2–4.4 (S1):** sem geração livre. A triagem extrai uma **lista de itens** (até 5 por mensagem); resolução e composição são **determinísticas** a partir do banco, com modelos de resposta editáveis; endereço também como mensagem de localização; unidade ambígua com > 3 unidades ⇒ lista interativa + pergunta pendente. Ferramentas com LLM permanecem previstas para S4 e para um modo híbrido futuro.
- **Lacunas:** item sem dado ⇒ resposta honesta + registro em `knowledge_gaps` (pergunta mascarada) ⇒ gerente responde no painel ⇒ vira fato. Indicador **% respondido pela IA**. Lacuna não transfere para humano.
- **§3.1:** `units` completa (endereço, lat/lng, maps_url, telefone, apelidos, ordem); `unit_hour_exceptions.turnos jsonb`; `restaurants.politica_feriado` (`normal`/`fechado`/`como_domingo`); `knowledge_facts.exemplos`; tabelas `reply_templates` e `knowledge_gaps`; colunas `conversations.pendente`, `simulada`/`simulado`, `messages.payload`. Feriados nacionais por função pura (sem tabela). Permissão por unidade via `app.can_access_unit`.
- **§2.1:** formulários com React Hook Form + Zod compartilhado; design system com tokens da Harmony Digital, **tema escuro padrão** e claro opcional, celular primeiro.
- **Simulador de WhatsApp** no painel: roda o pipeline real com adaptador de canal `simulador`, relógio injetável e isolamento (`simulada`), sujeito ao teto de gasto.

- **Painel — gastos (pedido do dono na homologação do 02-A, 05/10/2026):** a tela Início mostra a dono/gerente um quadro **Gastos** com **IA (OpenAI/OpenRouter)** e **WhatsApp (API oficial)** separados, **hoje** e **no mês**, e o total, lidos de `budget_counters` (escopos `ia` e `whatsapp`) no fuso do restaurante; atendente não vê custos. Valores em USD (4 casas abaixo de US$ 1). O gasto do WhatsApp só sobe com mensagens cobradas pela Meta (templates iniciados pela empresa); respostas dentro da janela de 24 h aberta pelo cliente são gratuitas. Telas de limites e relatórios continuam na Etapa 08.

- **Plano 02-B (implementado, 05/10/2026):** triagem `triage-v2` (lista de até 5 itens); resolução e composição determinísticas em `@atd/core/s1`; busca de unidade/fato em TypeScript sobre o contexto carregado (índices `pg_trgm`/GIN ficam para o painel); lista interativa até 10 unidades com pendente de 30 min; a escolha da lista é respondida sem chamar o LLM somente quando é uma única mensagem igual ao nome/apelido de uma unidade (`escolhaDeUnidade`) ou um toque na lista; lacunas com `NULLS NOT DISTINCT`; `knowledge_gaps.fact_id` amarrado ao mesmo restaurante (migrations 0013/0014; a 0014 revoga `MAINTAIN` de `authenticated` e exige Postgres 17); indicador "% respondido pela IA" conta só itens de S1 (`ai_runs.itens_validos/itens_respondidos`). Avaliação em duas camadas: camada 2 (composição exata, no CI) com 101 casos; camada 1 (extração com modelo real, job `evals-extracao`).
- **Modelo de triagem escolhido:** pendente da chave do OpenRouter (camada 1 pendente: falta `OPENROUTER_API_KEY`). Candidatos a avaliar: mistralai/mistral-nemo (US$ 0,019/M entrada, 0,03/M saída), google/gemini-2.5-flash-lite (0,10/0,40), openai/gpt-4.1-nano (0,10/0,40), qwen/qwen3.5-9b (0,10/0,15), openai/gpt-oss-120b (0,037/0,17); todos aceitam `response_format`/`structured_outputs` (lista de 05/10/2026 da API pública; ZDR por endpoint ainda não verificado). Critério: maior acerto (meta >= 95%), depois menor custo por mensagem, depois menor latência p95; o segundo colocado vira fallback.
- **Plano 02-C (implementado, 05/10/2026):** painel de S1 (Unidades com selo "aberta agora", Horários com turno de madrugada, Exceções com feriados do ano, Respostas com Sem resposta/Informações/Mensagens, Início com taxa de resposta e perguntas sem resposta, Restaurante em Mais) sob RLS e auditoria na mesma transação; permissão por unidade em forma de initplan (`app.minhas_unidades()`, migration 0016); simulador ligado ao pipeline real: conversa `simulada` por usuário (`sim:<userId>:<epoch>`), ingestão pelo papel `web_app`, canal "simulador" no worker (nunca chama a Meta; telefone não decifrável), relógio simulado por deslocamento em `conversations.relogio_offset_segundos` (só S1 e pendente; orçamento no relógio real), polling por Server Action; simulador só para dono/gerente; e2e com worker real, OpenRouter falso (`OPENROUTER_BASE_URL`, só teste) e MFA TOTP real. Horário do atendimento humano adiado para a Etapa 06.

## Adendo — Etapa 03 (05/10/2026)

Aprovado em [docs/specs/2026-10-05-etapa-03-s2-design.md](docs/specs/2026-10-05-etapa-03-s2-design.md) (§9); prevalece sobre as seções citadas abaixo.
- **§3.2 `attendance_notices`:** ganha `nome` (opcional: nome de perfil do WhatsApp, nos avisos da IA, ou digitado no painel; é dado pessoal — a exclusão por direito do titular e a anonimização da retenção devem limpá-lo), `simulado` (aviso de conversa simulada; nunca entra na previsão nem em contagens), `criado_por` (quem criou pelo painel) e `horario_aprox` como texto curto (≤ 40). Um aviso ativo por cliente/unidade/dia (índice único parcial); RLS por unidade, `mfa_required` restritiva, `update` só das colunas `status`/`updated_at` e sem reativar cancelado; `insert` de `authenticated` só nas colunas do formulário do painel (`restaurant_id`, `unit_id`, `data`, `pessoas`, `horario_aprox`, `nome`, `origem`, `criado_por`), com policy que exige `origem = 'painel'`, `customer_id` nulo, `simulado = false` e `criado_por` = o próprio usuário (migrations 0018–0022). Todo insert de `authenticated` em `attendance_notices` lista só as colunas concedidas (o insert do Drizzle, que lista todas com `DEFAULT`, é recusado).
- **§4.3 (S2):** resolvido como o S1 — a triagem (`triage-v3`, com `pessoas` e `horario` por item) extrai e o código resolve. `registrar_aviso_presenca`/`cancelar_aviso_presenca` viram **funções do domínio** chamadas pelo worker, não tools de LLM; o laço de tools do modelo principal fica para o primeiro serviço que precisar. Sem confirmação: registra direto e responde com resumo ("Anotado"/"Atualizei"). Data ausente = hoje; pessoas ausente ⇒ pergunta pendente ("Para quantas pessoas?", respondida sem nova chamada à IA); unidade ausente ⇒ lista do S1 (ou assume a única ativa). Acima de 60 pessoas ⇒ mensagem de grupo grande.
- **Painel:** tela **Previsão** (barra inferior) com avisos por unidade e dia (hoje até +30), "Novo aviso" e "Cancelar" para dono/gerente (com auditoria na mesma transação, sem PII no diff), leitura para atendente; cartão **Previstos hoje** no Início. Textos dos avisos editáveis em Mensagens.

## Adendo — Etapa 04 (06/10/2026)

Aprovado em [docs/specs/2026-10-05-etapa-04-s3-design.md](docs/specs/2026-10-05-etapa-04-s3-design.md) (§10); prevalece sobre as seções citadas abaixo.
- **§3.3:** `event_requests` ganha `nome` (perfil do WhatsApp; dado pessoal), `tipo_texto` (≤ 60, texto livre do cliente, só para a equipe — nunca repetido ao cliente), `observacoes` (automáticas, ≤ 300; ex.: "Unidade fechada nesse dia pelo horário cadastrado"), `simulado` (pedido de conversa simulada; nunca entra na fila nem em contagens) e `anonimizado`; tipos de evento como enum. `space_id` com FK composta `(space_id, unit_id)` → `event_spaces (id, unit_id)` (migration 0025, escrita à mão: ao apagar o espaço só `space_id` vira nulo). RLS por unidade (initplan), `mfa_required` restritiva, sem DELETE; `event_spaces` escrito só por dono/gerente; `event_requests` sem INSERT para `authenticated` (só worker/`web_app`) e UPDATE de `authenticated` só em `status`, `responsavel_id`, `notas_internas`, `updated_at` (dono, gerente e atendente com acesso à unidade); transições de status validadas na DAL (cancelado/recusado/confirmado não voltam a novo). Retenção: anonimizar 2 anos após a data (cron da Etapa 08). Migrations 0023–0025.
- **§4.3 (S3):** como o S2, resolvido pelo código — a triagem (`triage-v4`, com `convidados`, `tipoEvento` e `espaco` por item) extrai e `@atd/core/s3` resolve. `registrar_pedido_evento` e o cancelamento viram **funções do domínio** chamadas pelo worker, não tools de LLM. Coleta guiada um campo por vez (unidade → data → convidados → tipo; espaço só quando o citado não comporta o grupo), com pendente `pedido_evento` de 60 min. A IA **nunca** diz "reservado"/"confirmado": responde "Recebemos seu pedido… Nossa equipe vai entrar em contato para confirmar". Pedido confirmado pela equipe não é cancelado pela IA ⇒ handoff. Unidade fechada no dia não bloqueia (evento privado). Pergunta por espaços sem cadastro vira lacuna `eventos:espacos`.
- **§4.2 passo 2:** com pendente (S2 ou S3), a triagem v4 recebe `<pergunta_pendente>` (texto nosso) e `<pedido_em_andamento>` (só valores já validados: unidade do banco, data ISO, números, tipo normalizado), fora de `<mensagem_cliente>`; ambos são dado, nunca instrução. O caminho sem LLM continua só para "pessoas" (S2) e a escolha na lista; o worker completa o item com o que o pendente já sabia, sem depender de o modelo repetir.
- **Painel:** item "Previsão" da barra vira **Agenda** (abas Previsão | Eventos; `/previsao` redireciona). Fila de **Eventos** (padrão: novo + em contato; filtros por status e unidade), detalhe com status, responsável, notas internas e **Mostrar telefone** (decifrado no servidor só para quem vê a unidade; `audit_log` `evento.telefone_visualizado` sem o número). Aba **Espaços** na unidade (dono/gerente). Cartão **Pedidos de evento novos** no Início. Auditoria sem PII no `diff` (notas internas nunca entram).
- **Transversais:** `chamarAcao` repropaga redirect/notFound do Next (`unstable_rethrow`); as ações do simulador (abrir, novo cliente, relógio) gravam `audit_log`.

## Adendo — Etapa 05 (06/10/2026)

Aprovado em [docs/specs/2026-10-06-etapa-05-s4-design.md](docs/specs/2026-10-06-etapa-05-s4-design.md) (§9); prevalece sobre as seções citadas abaixo. Por decisão do dono, a importação de cardápio por PDF/foto (parte da Etapa 07, só para o alvo `cardapio`) entrou nesta etapa.
- **§3.4:** `menu_items` ganha `outros_nomes` e `ordem`, e `preco_centavos` passa a aceitar nulo ("preço sob consulta"); `menu_item_units` guarda só exceções (`disponivel` nulo = segue o item; `preco_override_centavos` nulo = preço do item; linha com os dois nulos = sem exceção, sem DELETE). Nome único normalizado por restaurante (categoria) e por categoria (item); FKs compostas com o restaurante. RLS: leitura pela equipe; categorias/itens escritos por dono ou gerente com acesso a todas as unidades; exceções e arquivos por unidade respeitam a permissão por unidade; grants por coluna, `mfa_required` restritiva, sem DELETE (desativar). Migrations 0026–0028.
- **§3.7 e §4.6 (trazidos para esta etapa, só `alvo = 'cardapio'`):** `knowledge_documents` com `origem` (`csv`/`arquivo`), `erro` e dedup por sha256 (importação com erro libera o reenvio). CSV (`categoria, nome, descricao, preco, tags, outros_nomes, unidade`) lido **pelo código**, sem IA, com erros por linha; PDF/imagem pelo job `document.ingest` (reserva de orçamento antes da chamada, PDF pelo motor **nativo** do modelo, Structured Outputs no schema do rascunho validado por Zod, `ai_runs` com `etapa 'ingestao'` e prompt `ingestao-cardapio-v1`; documento é dado, nunca instrução). Os dois caminhos geram o mesmo `RascunhoCardapio`; a revisão mostra novo × já existente e só grava ao **Confirmar** (dono ou gerente com acesso a todas as unidades), numa transação com auditoria (PRD I10). Modelo de leitura em `AI_INGEST_MODELS` (opcional; sem ele, "Importação por IA não configurada"), a escolher pelo `eval:ingestao` (meta ≥ 90% dos itens com nome e preço corretos). Importação parada em `processando` é retomada pelo worker e marcada com erro, devolvendo a reserva. **Atualizar item existente** (revisão final da Etapa 05): o Confirmar só sobrescreve o campo que o rascunho traz — descrição, etiquetas e outros nomes vazios e preço em branco mantêm o valor atual (limpar um campo é pela edição do item); a revisão mostra o que muda e permite editar a categoria. Leitura sem nenhum item vira erro; saída cortada pelo `max_tokens` (16 mil) não repete a chamada paga e pede o cardápio em partes (lotes por página na Etapa 07); o worker confere o sha256 do arquivo baixado antes da IA e da Meta. Arquivo importado usado para envio é copiado para o bucket `cardapio`.
- **§4.3 (S4):** como S1–S3, resolvido pelo código — a triagem (`triage-v5`: `servico = 'cardapio'`, `tipo ∈ {enviar, buscar, preco, filtro}`, `consulta`, `tag`) extrai, o banco busca (full-text `portuguese` + `unaccent` e trigram, até 8 itens com preço efetivo e disponibilidade por unidade) e `@atd/core/s4` compõe. `buscar_cardapio`/`enviar_cardapio` viram **funções do domínio**, não tools de LLM. Preço só de `preco_centavos`/override, formatado `R$ 1.234,56`; nome em negrito do WhatsApp (`*Nome*`); preço que varia por unidade sem unidade citada ⇒ preço de cada unidade (até 3) ou lista "Ver unidades"; sem resultado ⇒ "Não encontrei…" + oferta do cardápio e lacuna `cardapio:<consulta>`; "manda o cardápio" ⇒ arquivo ativo da unidade (senão o geral) como documento/imagem, ou, sem arquivo, resumo em texto com as categorias. Evals S1–S3 medem a v5 por padrão.
- **Mídia e Storage:** buckets privados `cardapio` (arquivos de envio) e `importacoes` (documentos importados), com policies de Storage por papel (upload por dono/gerente com o cliente do próprio usuário; validação de magic bytes, tamanho ≤ 20 MB e sha256 no servidor). O worker lê o Storage por REST com `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (validados por Zod, **só no servidor**), sobe o arquivo para a Meta (`uploadMedia`, `sendDocument`/`sendImage`) e reaproveita `wa_media_id` por 29 dias. Conversa simulada nunca sai pela Meta: o simulador mostra a bolha de documento/imagem com link assinado curto.
- **Painel:** "Respostas" vira **Conteúdo** (abas Cardápio | Sem resposta | Informações | Mensagens; `/respostas` redireciona preservando a aba). Cardápio com sub-abas **Itens**, **Por unidade**, **Arquivos** e **Importar** (dono/gerente; atendente só consulta). Upload por Server Action com limite de 21 MB (`serverActions.bodySizeLimit` e `proxyClientMaxBodySize`) — **na Vercel o corpo é ~4,5 MB: antes do deploy, o upload passa a URL assinada direta ao Storage com validação depois do envio**.
- **Correções do S3 (homologação da Etapa 04):** pedido de mudança com evento em andamento ⇒ handoff para a equipe, com a mudança registrada nas observações (texto nosso + campos validados); pedido novo para unidade/data de um pedido confirmado ⇒ handoff, sem criar pedido.

## Adendo — Etapa 06 (06/10/2026)

Aprovado em [docs/specs/2026-10-06-etapa-06-inbox-audio-design.md](docs/specs/2026-10-06-etapa-06-inbox-audio-design.md) (§10) e no plano [docs/plans/etapa-06-inbox-audio.md](docs/plans/etapa-06-inbox-audio.md); prevalece sobre as seções citadas abaixo.
- **Áudio adiado (decisão do dono, 06/10/2026):** a transcrição de áudio (§4.2 passo 1.5: download da Meta, limite de 2 min, duração pelo Ogg, reserva, `/api/v1/audio/transcriptions` com deny/ZDR, descarte, bucket `audios-simulados` no simulador, `eval:stt`) **saiu da Etapa 06** e virou melhoria futura no PLAN; o desenho continua na spec §4. Até lá, áudio recebe a resposta fixa "ainda não consigo ouvir áudio, pode escrever?", sem custo. Os invariantes de áudio (I6, retenção zero) valem quando for feito.
- **§3.2:** `conversations` ganha `handoff_motivo` (enum `pedido | frustracao | falhas | economico | servico`, sem texto livre) e `aguardando_desde` (ordenação da fila e métrica "Tempo até assumir"); `messages` ganha `atendente_id` (resposta humana); tabela `quick_replies` (título ≤ 40, texto ≤ 1000, até 30 ativas; leitura pela equipe, escrita por dono/gerente, sem DELETE); `restaurants.horario_atendimento_humano` no formato `{ dias: { seg: [{ inicio, fim }], … } }` validado por Zod (`horarioHumanoSchema`, mesmo esquema de turnos do S1, madrugada inclusa; vazio = sem promessa de horário). Migrations 0029–0031.
- **Unidade da conversa = `conversations.unidade_contexto_id`:** o worker grava a última unidade resolvida (S1–S4, lista de unidades ou pendente). Visibilidade da inbox: dono/quem acessa todas as unidades vê tudo (inclusive conversa sem unidade); gerente e atendente restritos só veem `unidade_contexto_id ∈ app.minhas_unidades()` (RLS initplan e checagem explícita na DAL, inclusive por URL).
- **Escrita do painel:** assumir, responder, reenviar, devolver e encerrar passam pela DAL na conexão `web_app` (como o simulador), com checagem de visibilidade e transições válidas do core (`TRANSICOES_CONVERSA`): assumir de `ia | aguardando_humano` ou de `humano` sem atendente (usuário removido) (de `humano` de outra pessoa só dono/gerente, com "Assumir mesmo assim"); responder só em `humano` pela própria pessoa e dentro da janela de 24 h; devolver de `aguardando_humano | humano`; encerrar de qualquer estado aberto. Assumir concorrente: um só vence. Auditoria na mesma transação, **sem o texto da mensagem nem PII no `diff`**; `authenticated` não ganha INSERT em `messages`.
- **Entrega da resposta humana:** a Server Action grava `messages` (`autor 'humano'`, `atendente_id`, `status_envio 'pendente'`) e enfileira `conversation.deliver` (`singletonKey` por conversa); o worker entrega pelo `deliver()` (token da Meta só no worker; pendentes da IA cancelados — I5). Conversa simulada vira `status_envio 'simulado'` e aparece só no simulador. "Tentar de novo" volta `falhou:*` → `pendente` e reenfileira. Fora da janela de 24 h o envio é recusado (templates no go-live).
- **Revisão final (06/10/2026):** `failed` do webhook de status vira `falhou:<código>` (mesmo formato do worker; linhas antigas `failed:*` também aceitam "Tentar de novo"); job de entrega que esgota as tentativas marca as respostas humanas pendentes como `falhou:temporaria`; encerrar cancela só as pendentes de autor `ia` (a despedida do atendente sai); triagem sem item, sem `fora_escopo` e sem frustração (cortesia) responde com agradecimento e não conta falha, e respostas prontas zeram o contador; restaurante com uma só unidade ativa grava `unidade_contexto_id` já na primeira resposta; cancelamento de evento recusado pelo banco responde `evento_ja_confirmado_humano` só se o pedido estiver confirmado, senão `evento_atualizado_humano` (texto neutro); "Tempo até assumir" (0032) respeita as unidades de quem vê.
- **Encerrar abre conversa nova:** "Encerrar" leva a `encerrada`; a próxima mensagem do cliente abre **conversa nova** com a IA (índice único de conversa aberta), em vez de reabrir a antiga. Conversa encerrada não é reassumida; a aba **Encerradas** lista os últimos 30 dias.
- **§4.5:** gatilhos implementados — pedido explícito (pré-filtro, sem IA), frustração (`triage-v6`, campo `frustracao`; v1–v5 intactas; medida pelo `eval:frustracao` com crédito), falhas seguidas (2 respostas inválidas ou fora do escopo seguidas; erro do modelo na triagem passa direto para a equipe), modo econômico e pedidos de evento que pedem a equipe. Mensagens por modelo editável: `handoff_dentro`, `handoff_fora` (com `{proximo_horario}`, ex.: "na segunda a partir das 9h") e `handoff_frustracao`. Evals S1–S4 medem a v6 por padrão.
- **Realtime (§8 item 6):** Broadcast **privado** disparado por triggers (`security definer`, `search_path` fixo) em `conversations` (mudança de `estado`, `atendente_id`, `last_message_at` ou `unidade_contexto_id`; a unidade antiga também é avisada) e em `messages` (INSERT; mudança de `status_envio` só para a conversa aberta), nos tópicos `inbox:u:<unit_id>`, `inbox:r:<restaurant_id>` (quem vê tudo e conversas sem unidade) e `conversa:<id>`; policies em `realtime.messages` por unidade/visibilidade com MFA restritiva. **Payload só `{ conversation_id, evento }`**, sem conteúdo nem PII; o painel recarrega pela DAL (RLS vale). Sem conexão, recarga a cada 60 s.
- **Painel:** barra inferior **Início · Conversas · Agenda · Conteúdo · Mais**; "Unidades" vai para **Mais** (rota `/unidades` mantida). **Conversas** com abas **Aguardando** · **Em atendimento** (todas as conversas em `humano`, as minhas primeiro com o selo "Você"; substitui a "Comigo" da spec) · **Com a IA** · **Encerradas**, filtro de unidade e "Mostrar simulações" (padrão desligado). Conversa aberta com Assumir, Responder, respostas rápidas, Devolver à IA, Encerrar e Mostrar telefone (auditado). Avisos com o painel aberto: contador no ícone e no título da aba, som opcional e notificação do navegador com texto fixo sem PII ("Nova conversa aguardando atendente"). **Mais → Atendimento humano** (só dono) e **Conteúdo → Mensagens → Respostas rápidas**. Início com "Tempo até assumir (hoje)" (mediana, só conversas reais).

## Adendo de 06/10/2026 — IA de produção pela OpenAI direto

Spec: `docs/specs/2026-10-06-openai-producao-design.md`; plano: `docs/plans/openai-producao.md`. Motivos do time: conta/contrato da empresa com a OpenAI e qualidade dos modelos GPT.

- **Provedor por ambiente:** `AI_PROVIDER=openrouter` (padrão, desenvolvimento local, modelos grátis) | `openai` (produção). `OPENAI_API_KEY` obrigatória com `openai`; `OPENROUTER_API_KEY` obrigatória só com `openrouter`; `OPENAI_BASE_URL` opcional (e2e aponta para o servidor falso). Com `NODE_ENV=production` o worker recusa subir com outro provedor, com `OPENROUTER_DEV_SEM_ZDR` ou com modelo fora da tabela de preços. Modelos de partida: triagem `gpt-4.1-mini`; cardápio `gpt-4.1-mini,gpt-4.1`.
- **Invariante de ZDR revisto (I8, §4.3 item 7, §6.5):** o OpenRouter segue sempre com `deny` + `zdr` + `require_parameters`. A OpenAI não oferece região de dados no Brasil nem ZDR por padrão: o time **aceitou, em 06/10/2026, a retenção padrão de 30 dias para monitoramento de abuso, sem uso para treino**. Mitigações mantidas: `store: false` em toda chamada, PII redigida antes, o LLM nunca recebe o telefone, dado de saúde nunca persistido, nada de conteúdo em log.
- **Orçamento:** inalterado (reserva atômica antes de toda chamada). O custo da OpenAI é calculado por tabela de preços em código (`packages/ai/src/precos-openai.ts`, com a data da consulta).
- **Verificação:** `pnpm --filter @atd/worker smoke:ia:prod` (exige `{"ok":true}` por modelo) e `pnpm --filter @atd/ai eval:prod` (S1–S4 e frustração contra a OpenAI; custa centavos) antes de apresentar ou publicar.
- **Pendências de conformidade (Etapa 09):** política de privacidade e RIPD citam a OpenAI como suboperadora, a retenção de 30 dias e a transferência internacional; avaliar pedido de ZDR à OpenAI.
