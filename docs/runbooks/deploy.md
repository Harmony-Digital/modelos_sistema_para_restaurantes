# Runbook de deploy em produção

Ordem recomendada: 1 → 6, 8 → 10, e só então 7 (Meta): o webhook só deve ser assinado depois que o worker estiver no ar. Para **staging**, siga a seção [Staging](#staging) (mesmos passos, recursos separados).

## 1. Supabase produção

1. Criar o projeto na região **South America (São Paulo) `sa-east-1`**.
2. Project Settings → Add-ons → ativar **PITR** (Point in Time Recovery).
3. Authentication:
   - Sign In / Providers → "Allow new users to sign up" = **off** (cadastro público desativado; espelha `enable_signup = false` do `supabase/config.toml`). **Mantenha o provedor Email habilitado**: desativá-lo quebra o login.
   - Multi-Factor → ativar **TOTP**.
   - Password: tamanho mínimo **12** caracteres.
   - URL Configuration → Site URL = domínio da Vercel (`https://<domínio>`).
4. Project Settings → **Data API** → Exposed schemas: **remover `public` e `graphql_public`** (deixar a lista vazia; se o painel permitir, desligar a Data API). O app não usa PostgREST/GraphQL: todo acesso a dados é via Postgres com os roles `web_app`/`worker_app`. Auth e Storage não dependem dessa lista. Localmente, o `supabase/config.toml` já tem `[api] enabled = false` e `schemas = []`.
5. Repetir tudo para o projeto de **staging**.

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

O worker usa o pooler de sessão (IPv4) porque é um processo de longa duração que usa prepared statements, que o modo transaction não suporta. Não é por causa de `LISTEN`: o pg-boss 12 vem com `useListenNotify: false` (usa polling e advisory locks de transação). Conexão direta também funciona, se a VPS tiver IPv6. Pools do worker: drizzle `max 6` + pg-boss `max 3` = até 9 conexões; confira o limite do pooler do plano.

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
   - `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (a web só valida e recebe; **não** cadastre `WHATSAPP_ACCESS_TOKEN` na Vercel: o token de envio fica só no worker)
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SENTRY_DSN` (opcional)
   - `RESTAURANT_ID` = id impresso pelo bootstrap
4. Cadastre cada variável **só no ambiente certo**: valores de produção apenas em *Production*; os de staging em *Preview* (ou no ambiente/branch de staging, ver [Staging](#staging)). Nunca marque "All Environments" para segredos.

## 7. Meta

**Só depois que o worker estiver no ar** (seção 9: container `running` e log `worker iniciado`, o que garante que `ensureQueues` já criou as filas). Se o webhook for assinado antes, o enqueue falha (fila inexistente), a Meta recebe 500 e fica reentregando.

App → WhatsApp → Configuration:

- Callback URL: `https://<domínio>/api/whatsapp/webhook`
- Verify Token: o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
- Assinar o campo **`messages`**.
- Gerar token **permanente** de System User (Business Settings → System Users → Generate token, permissões `whatsapp_business_messaging` e `whatsapp_business_management`). Não use o token temporário de 24 h.
- Conferir a versão da Graph API (padrão `v24.0`, variável `WHATSAPP_GRAPH_VERSION`).

## 8. OpenRouter (antes da seção 7)

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

`.env.staging` (`chmod 600`) tem as credenciais do Supabase de staging, chaves próprias e `DATABASE_URL` de staging. Detalhes na seção [Staging](#staging).

## 10. GitHub

- Settings → Environments → criar `production` com **Required reviewers** (aprovação obrigatória) e **Deployment branches = `main`** (somente).
- Os quatro secrets **`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` devem ser Environment secrets do `production`**, não secrets do repositório. Assim só um deploy aprovado a partir da `main` os lê.
- `VPS_KNOWN_HOSTS` = saída de `ssh-keyscan <host>`. **Compare a fingerprint** (`ssh-keygen -lf <(ssh-keyscan <host> 2>/dev/null)`) com a mostrada no console do provedor antes de salvar.
- O workflow `Worker deploy` dispara por `workflow_run` quando o **CI** termina com sucesso em um push na `main` (builda o SHA aprovado pelo CI); também pode ser disparado manualmente (`workflow_dispatch`). O job de deploy sempre espera a aprovação do environment `production`.
- O workflow não publica `:latest`; cada deploy usa a tag `<sha12>`. Após o deploy, ele verifica via SSH que o container está `running` e que os logs dos últimos 60 s contêm `worker iniciado`; senão o job falha.

## Staging

Ambiente completo e isolado da produção, usado na homologação e em todo release antes da produção.

- **Supabase**: projeto separado (também em `sa-east-1`), com as mesmas configurações da seção 1 (inclusive Data API sem schemas expostos), migrations (2), senhas próprias dos roles (3) e bootstrap (5) com um arquivo `.env.staging-bootstrap` próprio.
- **Chaves**: `PHONE_ENC_KEY`, `WA_ID_PEPPER` e senhas de `web_app`/`worker_app` **diferentes** das de produção.
- **Vercel** (mesmo projeto): as variáveis de produção ficam **só** no ambiente *Production*; as de staging (`DATABASE_URL` do Supabase de staging, `NEXT_PUBLIC_SUPABASE_*` de staging, chaves e segredos do app Meta de staging, `RESTAURANT_ID` de staging) ficam em *Preview* restrito à branch `staging` (Settings → Environment Variables → Preview → branch específica) ou em um Custom Environment `staging`. Assim um preview de PR qualquer nunca recebe segredos de produção.
- **Domínio estável**: associe um domínio fixo à branch `staging` (Settings → Domains → ex.: `staging.<domínio>` → Git Branch `staging`). A URL de callback da Meta precisa ser estável; URLs de preview mudam a cada deploy.
- **Deployment Protection**: a Vercel Authentication/Password Protection bloqueia a Meta (o webhook recebe 401/redirect e a verificação falha). Escolha uma: (a) deixar o domínio de staging fora da proteção (Settings → Deployment Protection → aplicar só a "Standard Protection" sem incluir o domínio customizado de staging, ou desligar para Preview), ou (b) usar **Protection Bypass for Automation** e acrescentar `?x-vercel-protection-bypass=<segredo>` à Callback URL configurada na Meta. Teste com `curl "https://staging.<domínio>/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=ok"` (deve responder `ok`).
- **Meta**: app e número de teste **de staging** (outro app ou o número de teste do app de desenvolvimento), com `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e token próprios. Callback URL = domínio de staging.
- **OpenRouter**: API key de staging separada, com `limit` mensal baixo e o mesmo Guardrail com ZDR.
- **Worker**: na VPS, projeto compose `atendimento-staging` com `.env.staging` e `.deploy.staging.env` (seção 9).

## Release regular

1. PR revisado e mergeado na `main`; o CI precisa estar verde (o workflow de deploy do worker só dispara depois do CI concluído com sucesso).
2. **Migrations em staging**: `DATABASE_URL=<admin de staging> pnpm db:migrate`.
3. **Deploy em staging**: web (push na branch `staging`, ou promover o build para o domínio de staging) e worker (`IMAGE_TAG=<sha12>` em `.deploy.staging.env`, `pull` + `up -d` do projeto `atendimento-staging`; a imagem já foi publicada pelo build do workflow).
4. **Verificar staging**: painel mostra IA Online; enviar uma mensagem do número de teste e receber resposta; Sentry sem erros novos.
5. **Migrations em produção**: `DATABASE_URL=<admin de produção> pnpm db:migrate` (migrations devem ser compatíveis com a versão anterior do código, pois web e worker sobem depois).
6. **Aprovar o deploy do worker** no GitHub (environment `production`) e acompanhar a verificação pós-deploy do workflow.
7. **Promover a web na Vercel** (deploy de produção da `main`, ou Promote to Production do deploy verificado).
8. Conferir em produção: IA Online, uma conversa de teste, Sentry.

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
