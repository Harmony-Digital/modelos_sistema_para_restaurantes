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

Da máquina do dono, use um arquivo de env **dedicado à produção** (`.env.production-bootstrap`, fora do git, `chmod 600`) contendo exatamente:

- `SUPABASE_URL` (URL do projeto de produção)
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (conexão direta de **administrador**)

Não use `pnpm --filter @atd/db bootstrap` em produção: o script do pacote carrega o `.env` local de desenvolvimento. Rode o script diretamente com o env de produção (variáveis já exportadas no shell têm precedência sobre o arquivo, então abra um shell limpo, sem variáveis do `.env` local):

```bash
cd packages/db
node --env-file=../../.env.production-bootstrap scripts/bootstrap.ts --restaurante "<Nome>" --dono <email> --nome-dono "<Nome>" --politica https://<domínio>/privacidade
```

Confira que a saída aponta para o projeto de produção. O comando imprime o id do restaurante (usado em `RESTAURANT_ID`). É idempotente: rodar de novo é seguro e reaproveita o dono existente.

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
bash infra/vps/bootstrap.sh deploy "<chave pública do deploy (CI)>" "<chave pública do admin (humano)>"
```

Há duas chaves distintas: a **chave de admin** (sua, humana; vai para o `root` e garante que você não fique trancado) e a **chave de deploy** (par usado só pelo GitHub Actions; a privada vai no secret `VPS_SSH_KEY`). O script aborta antes de alterar o sshd se o root não tiver chave autorizada, e grava `/etc/ssh/sshd_config.d/00-hardening.conf` validado com `sshd -t`. Antes de fechar a sessão, abra outra e confirme o acesso por chave (root e deploy).

Copie para `/opt/atendimento`:

- `apps/worker/docker-compose.prod.yml` como `docker-compose.prod.yml`
- `.env` (produção) com `chmod 600`, com as variáveis de `workerEnvSchema`: `DATABASE_URL` (role `worker_app`, **pooler session, porta 5432**), `OPENROUTER_API_KEY`, `AI_TRIAGE_MODELS`, `WHATSAPP_*`, `PHONE_ENC_KEY`, `WA_ID_PEPPER`, `LOG_LEVEL`, `SENTRY_DSN`.

O compose exige `WORKER_IMAGE`, `IMAGE_TAG` e `ENV_FILE` (sem defaults, para nunca subir imagem ou segredos errados). O deploy de produção grava `/opt/atendimento/.deploy.env` (`WORKER_IMAGE`, `IMAGE_TAG`, `ENV_FILE=.env`) e usa `--env-file .deploy.env`.

Login no registry com PAT **somente leitura** (`read:packages`):

```bash
docker login ghcr.io -u <usuário-github>
```

**Staging** (isolamento obrigatório: projeto compose, arquivo de env e arquivo de deploy próprios; nunca o `.env` de produção):

```bash
cd /opt/atendimento
printf 'WORKER_IMAGE=ghcr.io/<owner>/ia-atendimento-worker\nIMAGE_TAG=<sha12>\nENV_FILE=.env.staging\n' > .deploy.staging.env
docker compose -p atendimento-staging --env-file .deploy.staging.env -f docker-compose.prod.yml pull
docker compose -p atendimento-staging --env-file .deploy.staging.env -f docker-compose.prod.yml up -d
```

`.env.staging` (`chmod 600`) tem as credenciais do Supabase de staging, chaves próprias e `DATABASE_URL` de staging.

## 10. GitHub

- Settings → Environments → criar `production` com **Required reviewers** (aprovação obrigatória) e **Deployment branches = `main`** (somente).
- Os quatro secrets **`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` devem ser Environment secrets do `production`**, não secrets do repositório. Assim só um deploy aprovado a partir da `main` os lê.
- `VPS_KNOWN_HOSTS` = saída de `ssh-keyscan <host>`. **Compare a fingerprint** (`ssh-keygen -lf <(ssh-keyscan <host> 2>/dev/null)`) com a mostrada no console do provedor antes de salvar.
- O workflow não publica `:latest`; cada deploy usa a tag `<sha12>`. Após o deploy, ele verifica via SSH que o container está `running` e que os logs dos últimos 60 s contêm `worker iniciado`; senão o job falha.

## 11. Rollback

Na VPS, em `/opt/atendimento` (a tag antiga precisa ainda existir no GHCR):

```bash
printf 'WORKER_IMAGE=ghcr.io/<owner>/ia-atendimento-worker\nIMAGE_TAG=<sha anterior>\nENV_FILE=.env\n' > .deploy.env
docker compose --env-file .deploy.env -f docker-compose.prod.yml pull
docker compose --env-file .deploy.env -f docker-compose.prod.yml up -d
```

O próximo deploy normal sobrescreve `.deploy.env` com a nova tag.

## 12. Chaves de cifra

`PHONE_ENC_KEY` e `WA_ID_PEPPER` (32 bytes base64, `openssl rand -base64 32`) devem ser **diferentes por ambiente** e guardadas também no cofre de senhas do dono. **Perder a chave = perder os telefones cifrados.**

## Pendências manuais

- Confirmar a versão da Graph API no painel da Meta (padrão `v24.0`).
- Rodar o smoke test real do OpenRouter (Task 12, Step 6) e confirmar que o roteamento com `zdr: true` funciona para os modelos de triagem escolhidos (`AI_TRIAGE_MODELS`).
- Confirmar que o datacenter da VPS fica em São Paulo.
