# Homologação — plano 02-B (resolução de S1)

Roteiro curto para o dono. Tudo roda no banco local; nada é gravado nem enviado ao WhatsApp.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1
```
Cadastra 4 unidades (Asa Sul, Asa Norte, Lago Sul, Águas Claras), horários, exceções e 6 informações de demonstração.

## 2. Perguntar com IA (se houver `OPENROUTER_API_KEY` no `.env`)
```bash
pnpm --filter @atd/worker perguntar "a asa sul abre domingo?"
pnpm --filter @atd/worker perguntar "onde fica a asa norte?"
pnpm --filter @atd/worker perguntar "vocês estão abertos agora?"        # lista de unidades
pnpm --filter @atd/worker perguntar "tem área kids?"                     # lacuna
pnpm --filter @atd/worker perguntar "abre no feriado e aceita pix?"      # composta
pnpm --filter @atd/worker perguntar "qual a previsão do tempo?"          # fora de escopo
```
Use `--agora 2026-10-11T10:00:00-03:00` para simular outro momento.

## 3. Sem chave
Os mesmos casos com `--itens`, copiando os itens do gabarito `packages/ai/evals/s1/casos.ts`. Exemplo:
```bash
pnpm --filter @atd/worker perguntar --agora 2026-10-05T14:00:00-03:00 --itens '[{"servico":"horario_unidades","tipo":"horario_dia","unidade":"asa sul","data":"domingo","tema":null}]'
```
Esperado: `Domingo (11/10), a unidade Asa Sul abre das 11h30 às 16h.`

## 4. Conferir
- Relatório de evals em `packages/ai/evals/s1/resultados/` (quando houver chave) e o snapshot da camada 2 (101 casos) em `packages/ai/evals/s1/__snapshots__`.

## 5. Escolha do modelo de triagem (pendente: falta `OPENROUTER_API_KEY`)
Candidatos a avaliar (lista pública do OpenRouter, 05/10/2026): mistralai/mistral-nemo (US$ 0,019/M entrada, 0,03/M saída), google/gemini-2.5-flash-lite (0,10/0,40), openai/gpt-4.1-nano (0,10/0,40), qwen/qwen3.5-9b (0,10/0,15), openai/gpt-oss-120b (0,037/0,17); todos aceitam `response_format`/`structured_outputs` (lista de 05/10/2026 da API pública; ZDR por endpoint ainda não verificado).
Depois de obter a chave: `pnpm --filter @atd/ai eval:s1 --modelos <a>,<b>,<c>,<d> --teto 1.00`; critério: maior acerto (>= 95%), menor custo, menor latência p95; o segundo colocado vira fallback. Confirmar ZDR do endpoint antes de adotar.

## 6. Ainda não dá para ver
Telas de Unidades/Respostas e o simulador ligado ao pipeline real: ver docs/homologacao/etapa-02c.md.

## Se a triagem falhar (erro do OpenRouter)

O erro agora mostra a causa real, por exemplo:
- `No endpoints found matching your data policy (Zero data retention) … [etapa: Filter by Data Policy]` — o modelo não tem provedor que garanta não guardar os dados. Toda chamada exige essa garantia (LGPD), então esse modelo não pode ser usado.
- `Provider returned error [Novita: … does not support 'json_schema' …]` — o provedor não aceita o formato estruturado que a triagem usa.

Em 05/10/2026, nenhum modelo **grátis** (`:free`) passou nas duas exigências (o Nemotron grátis não é ZDR; o Apodex grátis não aceita `json_schema`). Para testar com IA real é preciso crédito no OpenRouter e um modelo pago barato, por exemplo `AI_TRIAGE_MODELS=mistralai/mistral-nemo,google/gemini-2.5-flash-lite` (confirmar ZDR do endpoint antes de adotar).
