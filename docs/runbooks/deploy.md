# Runbook de deploy em produção

Ordem recomendada: 1 → 12. Repita as seções 1 a 5 para **staging** (projeto Supabase separado, chaves separadas).

## 1. Supabase produção

1. Criar o projeto na região **South America (São Paulo) `sa-east-1`**.
2. Project Settings → Add-ons → ativar **PITR** (Point in Time Recovery).
3. Authentication:
   - Sign In / Providers → "Allow new users to sign up" = **off** (cadastro público desativado; espelha `enable_signup = false` do `supabase/config.toml`). **Mantenha o provedor Email habilitado**: desativá-lo quebra o login.
   - Multi-Factor → ativar **TOTP**.
   - Password: tamanho mínimo **12** caracteres.
   - URL Configuration → Site URL = domínio da Vercel (`https://<domínio>`).
4. Repetir tudo para o projeto de **staging**.

## 2. Migrations

Da máquina do dono, com a conexão direta de administrador (usuário `postgres`):

```bash
DATABASE_URL=<conexão direta de administrador> pnpm db:migrate
```

As migrations (0000–0009) criam as tabelas, RLS, os roles `web_app` e `worker_app` e o schema `pgboss` (migration 0004). **As migrations devem rodar antes da primeira subida do worker em cada ambiente**: o pg-boss usa `createSchema: false` e apenas cria suas tabelas dentro do schema `pgboss`, que pertence a `worker_app`.

## 3. Senhas dos roles

As migrations nunca definem senhas. No SQL Editor do Supabase (cada ambiente):

```sql
alter role web_app with password '<openssl rand -base64 32>';
alter role worker_app with password '<openssl rand -base64 32>';
```

Gere cada senha com `openssl rand -base64 32` e guarde no cofre de senhas. Produção e staging **devem usar senhas aleatórias fortes e distintas**. As senhas `worker_dev` / `web_dev` existem apenas no Supabase LOCAL (configuradas pelo setup de testes) e jamais podem ser usadas fora dele.

## 4. Strings de conexão

Dashboard → Connect → Connection pooling. Se a senha tiver caracteres especiais, aplique URL-encode.

| Consumidor | Pooler | Porta | Usuário |
| --- | --- | --- | --- |
| Web (Vercel) | **transaction** | `6543` | `web_app.<project_ref>` |
| Worker (VPS) | **session** | `5432` | `worker_app.<project_ref>` |

O worker usa o pooler de sessão (IPv4) porque o `LISTEN` do pg-boss exige sessão.

## 5. Bootstrap

Da máquina do dono, com o env de produção carregado (`DATABASE_URL` com credencial que consiga inserir; chaves `PHONE_ENC_KEY`/`WA_ID_PEPPER` de produção). No pnpm 11 **não há `--`**:

```bash
pnpm --filter @atd/db bootstrap --restaurante "<Nome>" --dono <email> --nome-dono "<Nome>" --politica https://<domínio>/privacidade
```

O comando imprime o id do restaurante (usado em `RESTAURANT_ID`). É idempotente: rodar de novo é seguro e reaproveita o dono existente.

## 6. Vercel

1. Importar o repositório; **Root Directory** `apps/web`; plano **Pro**.
2. Settings → Functions → Function Region **`gru1`** (São Paulo).
3. Variáveis de ambiente (`webEnvSchema`):
   - `DATABASE_URL` (role `web_app`, pooler transaction, porta 6543)
   - `PHONE_ENC_KEY`, `WA_ID_PEPPER`
   - `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SENTRY_DSN` (opcional)
   - `RESTAURANT_ID` = id impresso pelo bootstrap

## 7. Meta

App → WhatsApp → Configuration:

- Callback URL: `https://<domínio>/api/whatsapp/webhook`
- Verify Token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
- Assinar o campo **`messages`**.
- Gerar token **permanente** de System User (Business Settings → System Users → Generate token, permissões `whatsapp_business_messaging` e `whatsapp_business_management`). Não use o token temporário de 24 h.
- Conferir a versão da Graph API (padrão `v24.0`, variável `WHATSAPP_GRAPH_VERSION`).

## 8. OpenRouter

- Criar API key de produção com `limit` mensal.
- Criar Guardrail com `limit_usd`, `reset_interval: monthly` e **ZDR (Zero Data Retention) obrigatório**.

## 9. VPS

Como root na VPS nova (Ubuntu), a partir de uma cópia do repositório:

```bash
bash infra/vps/bootstrap.sh deploy "<chave pública>"
```

Antes de fechar a sessão, abra outra e confirme o acesso por chave. Depois, copie para `/opt/atendimento`:

- `apps/worker/docker-compose.prod.yml` como `docker-compose.prod.yml`
- `.env` com `chmod 600`, com as variáveis de `workerEnvSchema`: `DATABASE_URL` (role `worker_app`, **pooler session, porta 5432**), `OPENROUTER_API_KEY`, `AI_TRIAGE_MODELS`, `WHATSAPP_*`, `PHONE_ENC_KEY`, `WA_ID_PEPPER`, `LOG_LEVEL`, `SENTRY_DSN`.

Login no registry com PAT **somente leitura** (`read:packages`):

```bash
docker login ghcr.io -u <usuário-github>
```

Staging: mesmo diretório, com projeto e env próprios:

```bash
docker compose -p atendimento-staging --env-file .env.staging -f docker-compose.prod.yml up -d
```

(Ajuste `env_file` se quiser isolar totalmente o arquivo de env do staging.)

## 10. GitHub

- Secrets do repositório: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` (saída de `ssh-keyscan <host>`).
- Settings → Environments → criar `production` com **Required reviewers** (aprovação obrigatória). O job `deploy` só roda após a aprovação.

## 11. Rollback

Na VPS, em `/opt/atendimento`:

```bash
export WORKER_IMAGE=ghcr.io/<owner>/ia-atendimento-worker
export IMAGE_TAG=<sha anterior>
docker compose -f docker-compose.prod.yml up -d
```

## 12. Chaves de cifra

`PHONE_ENC_KEY` e `WA_ID_PEPPER` (32 bytes base64, `openssl rand -base64 32`) devem ser **diferentes por ambiente** e guardadas também no cofre de senhas do dono. **Perder a chave = perder os telefones cifrados.**

## Pendências manuais

- Confirmar a versão da Graph API no painel da Meta (padrão `v24.0`).
- Rodar o smoke test real do OpenRouter (Task 12, Step 6) e confirmar que o roteamento com `zdr: true` funciona para os modelos de triagem escolhidos (`AI_TRIAGE_MODELS`).
- Confirmar que o datacenter da VPS fica em São Paulo.
