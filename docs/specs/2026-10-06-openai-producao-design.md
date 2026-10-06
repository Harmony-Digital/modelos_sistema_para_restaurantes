# IA de produção pela OpenAI direto (local continua no OpenRouter)

> Spec aprovada em conversa em 06/10/2026. Motivos do time: conta/contrato da empresa com a OpenAI e qualidade dos modelos GPT. **Decisão do time:** aceitar a retenção padrão da OpenAI (30 dias para monitoramento de abuso, sem uso para treino) — muda o invariante de ZDR do PRD só para o provedor OpenAI. A chave da OpenAI **não é usada** no desenvolvimento desta mudança (nenhuma chamada real; testes com `fetch` falso).

## 1. Critério de sucesso
- Local: `AI_PROVIDER=openrouter` (padrão) com os modelos grátis, como hoje.
- Produção: `AI_PROVIDER=openai`; o worker recusa subir em `NODE_ENV=production` com outro provedor ou com modelo sem preço cadastrado.
- Triagem (v1–v6), leitura de cardápio (imagem/PDF), evals, smoke test e simulador funcionam nos dois provedores pelo mesmo `LlmClient`; nenhum código de chamada muda.
- Orçamento intacto: toda chamada paga com reserva antes e liquidação pelo custo calculado.
- Evals rodáveis contra a OpenAI (`pnpm eval:prod`) como portão antes de apresentar/publicar.

## 2. Provedor por ambiente
- `AI_PROVIDER`: `openrouter` (padrão) | `openai`.
- `OPENAI_API_KEY` obrigatória com `openai`; `OPENROUTER_API_KEY` obrigatória só com `openrouter`. `OPENAI_BASE_URL` opcional (padrão `https://api.openai.com/v1`; e2e aponta para o falso).
- `AI_TRIAGE_MODELS`/`AI_INGEST_MODELS` inalterados (nomes do provedor escolhido: `gpt-4.1-mini` vs `nvidia/...:free`).
- `NODE_ENV=production` ⇒ `AI_PROVIDER` deve ser `openai`; `OPENROUTER_DEV_SEM_ZDR` continua proibida em produção.

## 3. Cliente OpenAI (`createOpenAiClient`, mesma interface `LlmClient`)
- `POST {base}/chat/completions`, `Authorization: Bearer`, `store: false`, `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }`, `max_completion_tokens`.
- Conteúdo: texto; imagem como `image_url` (data URL base64); PDF como parte `file` (`{ file: { filename, file_data: 'data:application/pdf;base64,…' } }`) — confirmar formato na doc atual.
- Raciocínio: modelos de raciocínio (família `gpt-5*`, `o*`) recebem `reasoning_effort` mínimo quando `reasoning !== true`; demais não recebem nada.
- Reserva entre modelos: tenta os modelos da lista em ordem; passa ao próximo em erro transitório (429, 5xx, timeout) ou recusa do modelo/parâmetro; erro 4xx de requisição inválida não insiste.
- Resultado igual ao do OpenRouter: `saida_invalida` (JSON fora do esquema/recusa `refusal`), `saida_truncada` (`finish_reason: length`, não repete), `usage` com tokens de entrada/cache/saída.
- **Custo:** tabela de preços em código (`packages/ai/src/precos-openai.ts`: USD por 1M tokens de entrada, entrada em cache e saída, por modelo, com data da consulta) ⇒ `costUsd`; modelo fora da tabela ⇒ erro de configuração no boot do worker.
- Nada de conteúdo em log.

## 4. LGPD (PRD)
- Invariante revisto: OpenRouter sempre com `data_collection: 'deny'` + `zdr: true` (+ `require_parameters`); OpenAI com retenção padrão aceita pelo time em 06/10/2026 (30 dias para abuso, sem treino), `store: false`, PII redigida antes da chamada; sem região de dados no Brasil (transferência internacional).
- PLAN Etapa 09: política de privacidade e RIPD citam a OpenAI como suboperadora, retenção de 30 dias e transferência internacional; avaliar pedido de ZDR à OpenAI.

## 5. Evals e smoke
- Evals de extração (S1–S4, frustração, ingestão) aceitam o provedor por `AI_PROVIDER` (e `--provider`); `pnpm eval:prod` roda triagem S1–S4 + frustração contra a OpenAI com o env de produção.
- `smoke:openrouter:prod` vira `smoke:ia:prod` (os dois provedores; exige `{"ok":true}` por modelo).

## 6. Runbook da amostra
- Passo do OpenRouter vira OpenAI: projeto na plataforma da OpenAI com limite de gasto, modelos liberados, chave do projeto; `smoke:ia:prod` e `eval:prod` antes de apresentar; tabela de variáveis e `verificar.sh` atualizados.

## 7. Fora
Pedido de ZDR à OpenAI, Azure OpenAI, áudio, Responses API.
