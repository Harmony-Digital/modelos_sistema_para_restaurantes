# Homologação da Etapa 01 — Fundação

Roteiro para o dono executar em **staging**, com o número de teste da Meta. Preencha "Resultado" (OK / falhou + observação) e "Evidência" (print ou ID da linha no banco). A etapa só é encerrada com a sua aprovação explícita.

## Pré-requisitos

- Staging implantado conforme [docs/runbooks/deploy.md](../runbooks/deploy.md) (web na Vercel, worker na VPS, projeto Supabase de staging).
- Número de teste da Meta configurado e webhook apontando para o staging.
- Chave do OpenRouter configurada, com `AI_TRIAGE_MODELS` definido.
- Bootstrap feito (restaurante e dono) e usuários de teste criados conforme **SQL/Script C** abaixo (dono com senha, um atendente e, opcionalmente, um gerente).
- Acesso ao SQL Editor do projeto Supabase de **staging** (os SQLs abaixo nunca devem rodar em produção).
- Para o e2e local: o banco precisa ter exatamente uma linha em `restaurants` (bootstrap ou `insert into restaurants (nome) values ('Dev')`).

## Roteiro

| # | Ação no WhatsApp/painel | Esperado | Resultado | Evidência |
|---|---|---|---|---|
| 1 | Enviar "oi" de um número novo | Aviso de privacidade (com link) + saudação; sem custo de IA | | |
| 2 | Enviar "como está o tempo hoje?" | Resposta "só consigo ajudar com assuntos do …"; 1 linha em `ai_runs` com intent `fora_escopo` | | |
| 3 | Enviar 3 mensagens seguidas em < 3 s ("oi" / "queria saber" / "abre domingo?") | **Uma** resposta | | |
| 4 | Enviar "quero falar com atendente" | Mensagem de transferência; painel mostra 1 aguardando atendente | | |
| 5 | Enviar nova mensagem com a conversa aguardando atendente. **Depois: rodar o SQL A** (devolve a conversa à IA; a Etapa 01 não tem botão para isso) | Nenhuma resposta da IA | | |
| 6 | Enviar um áudio | "Por enquanto só consigo ler mensagens de texto" | | |
| 7 | Enviar "quero apagar meus dados" | Resposta de 15 dias; linha em `data_subject_requests` | | |
| 8 | Baixar o limite diário de IA (**SQL B**) e perguntar algo. **Depois: restaurar o limite (SQL B) e rodar o SQL A** de novo (o modo econômico também transfere para atendente) | Resposta de modo econômico; nenhuma chamada ao OpenRouter | | |
| 9 | Painel: entrar como dono (usuário do **C**) | Exige cadastro do autenticador; depois mostra IA Online e gasto do dia | | |
| 10 | Painel: entrar como atendente (usuário do **C**) | Entra sem MFA; não vê gasto | | |
| 11 | Parar o worker (`docker compose stop`) | Painel mostra IA Offline em até 1 min; mensagens enviadas nesse intervalo são respondidas quando o worker volta | | |
| 12 | Conferir Sentry e logs | Nenhum telefone ou texto de mensagem em claro | | |

Alternativa aos SQLs A: usar um **segundo número** de WhatsApp para os passos 6 a 8 e 11 (cada número novo começa em uma conversa no estado `ia`; o passo 1 vale para o primeiro contato de cada número).

## SQL e scripts de apoio (staging)

**A. Devolver a conversa à IA** (após os passos 5 e 8). Acha a conversa pela última mensagem de transferência recebida:

```sql
-- conferir antes: deve retornar 1 linha com estado = 'aguardando_humano'
select c.id, c.estado, c.last_message_at
  from conversations c
 where c.id = (select conversation_id from messages
                where direcao = 'in' and texto = 'quero falar com atendente'
                order by id desc limit 1);

update conversations set estado = 'ia', falhas_consecutivas = 0
 where estado = 'aguardando_humano'
   and id = (select conversation_id from messages
              where direcao = 'in' and texto = 'quero falar com atendente'
              order by id desc limit 1);
```

Após o passo 8, troque o texto do filtro pela pergunta enviada no passo 8 (ou use `where estado = 'aguardando_humano' order by last_message_at desc limit 1` se for o único teste em andamento). Mensagens recebidas enquanto a conversa estava com atendente não são respondidas depois; envie uma nova.

**B. Limite diário de IA** (passo 8). O `CHECK` não aceita `0`; use um valor mínimo e anote o original para restaurar:

```sql
select limite_usd from budget_limits where escopo = 'ia' and periodo = 'dia';  -- anotar
update budget_limits set limite_usd = 0.000001 where escopo = 'ia' and periodo = 'dia';
-- depois do passo 8, restaurar com o valor anotado:
update budget_limits set limite_usd = <valor anotado> where escopo = 'ia' and periodo = 'dia';
```

**C. Usuários de teste** (passos 9 e 10). A Etapa 01 não tem tela para definir senha a partir do convite, então crie o usuário já com senha (mínimo 12 caracteres) pelo Admin API, com o env de staging (`.env.staging-bootstrap`: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do projeto de staging):

```bash
cd packages/db
node --env-file=../../.env.staging-bootstrap --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
const [email, password] = process.argv.slice(1)
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) throw error
console.log(data.user.id)
" atendente.teste@<domínio> '<senha com 12+ caracteres>'
```

O comando imprime o `user_id`. Para o **dono** já convidado pelo bootstrap, troque `createUser({ email, password, email_confirm: true })` por `updateUserById('<id de auth.users do dono>', { password })` para definir a senha. Em seguida, no SQL Editor de staging, vincule o usuário ao restaurante (`papel`: `atendente` ou `gerente`; o dono já foi vinculado pelo bootstrap):

```sql
insert into staff (user_id, restaurant_id, nome, papel)
values ('<user_id impresso>', (select id from restaurants limit 1), 'Atendente Teste', 'atendente');
```

## Pendências manuais

- Confirmar a versão da Graph API no painel da Meta (padrão `v24.0`).
- Rodar o smoke test real do OpenRouter (Task 12, Step 6) e confirmar que o roteamento com `zdr: true` funciona para os modelos de triagem escolhidos (`AI_TRIAGE_MODELS`).
- Confirmar que o datacenter da VPS fica em São Paulo.

## Aprovação

Aprovado por: ____________________ Data: ___/___/______
