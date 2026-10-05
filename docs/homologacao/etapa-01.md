# Homologação da Etapa 01 — Fundação

Roteiro para o dono executar em **staging**, com o número de teste da Meta. Preencha "Resultado" (OK / falhou + observação) e "Evidência" (print ou ID da linha no banco). A etapa só é encerrada com a sua aprovação explícita.

## Pré-requisitos

- Staging implantado conforme [docs/runbooks/deploy.md](../runbooks/deploy.md) (web na Vercel, worker na VPS, projeto Supabase de staging).
- Número de teste da Meta configurado e webhook apontando para o staging.
- Chave do OpenRouter configurada, com `AI_TRIAGE_MODELS` definido.
- Bootstrap feito (restaurante, dono e atendente de teste cadastrados).
- Para o e2e local: o banco precisa ter exatamente uma linha em `restaurants` (bootstrap ou `insert into restaurants (nome) values ('Dev')`).

## Roteiro

| # | Ação no WhatsApp/painel | Esperado | Resultado | Evidência |
|---|---|---|---|---|
| 1 | Enviar "oi" de um número novo | Aviso de privacidade (com link) + saudação; sem custo de IA | | |
| 2 | Enviar "como está o tempo hoje?" | Resposta "só consigo ajudar com assuntos do …"; 1 linha em `ai_runs` com intent `fora_escopo` | | |
| 3 | Enviar 3 mensagens seguidas em < 3 s ("oi" / "queria saber" / "abre domingo?") | **Uma** resposta | | |
| 4 | Enviar "quero falar com atendente" | Mensagem de transferência; painel mostra 1 aguardando atendente | | |
| 5 | Enviar nova mensagem com a conversa aguardando atendente | Nenhuma resposta da IA | | |
| 6 | Enviar um áudio | "Por enquanto só consigo ler mensagens de texto" | | |
| 7 | Enviar "quero apagar meus dados" | Resposta de 15 dias; linha em `data_subject_requests` | | |
| 8 | Zerar o limite diário de IA (SQL) e perguntar algo | Resposta de modo econômico; nenhuma chamada ao OpenRouter | | |
| 9 | Painel: entrar como dono | Exige cadastro do autenticador; depois mostra IA Online e gasto do dia | | |
| 10 | Painel: entrar como atendente | Entra sem MFA; não vê gasto | | |
| 11 | Parar o worker (`docker compose stop`) | Painel mostra IA Offline em até 1 min; mensagens enviadas nesse intervalo são respondidas quando o worker volta | | |
| 12 | Conferir Sentry e logs | Nenhum telefone ou texto de mensagem em claro | | |

## Pendências manuais

- Confirmar a versão da Graph API no painel da Meta (padrão `v24.0`).
- Rodar o smoke test real do OpenRouter (Task 12, Step 6) e confirmar que o roteamento com `zdr: true` funciona para os modelos de triagem escolhidos (`AI_TRIAGE_MODELS`).
- Confirmar que o datacenter da VPS fica em São Paulo.

## Aprovação

Aprovado por: ____________________ Data: ___/___/______
