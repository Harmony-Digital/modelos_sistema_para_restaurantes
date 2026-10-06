# Runbook — amostra em produção (só simulador, um ambiente)

Publica o painel (Vercel) e o worker (VPS) contra um Supabase de produção para o dono mostrar o produto:
login com TOTP, simulador respondendo S1–S4, Conversas em tempo real e importação de cardápio.
**Nada sai pela Meta**: as variáveis `WHATSAPP_*` recebem valores aleatórios; o webhook continua exigindo
HMAC válido, então nenhuma mensagem real entra. O go-live completo (Meta, staging, PITR, GitHub
environment, Ignored Build Step, rollback) está em [deploy.md](deploy.md) e na Etapa 09 do PLAN.

## Para o agente que vai publicar

Você (agente no Claude Code de quem publica) segue este arquivo sozinho, do passo 0 ao 9, na ordem.

**Ordem de leitura:** `CLAUDE.md` (regras do projeto) → este runbook inteiro → `packages/config/src/env.ts`
(o esquema que valida as variáveis; a tabela abaixo bate com ele).

**Regras:**

1. **Nunca** commitar, colar no chat, imprimir ou registrar segredo (chaves, senhas, tokens, URLs com senha).
   Segredos ficam só em três arquivos locais **fora do git**, todos `chmod 600`, na raiz do repositório:
   `.env.production-bootstrap`, `.env.vercel-producao`, `.env.worker-producao` (o `.gitignore` já ignora `.env.*`).
   Para mostrar que uma variável existe, use `scripts/producao/verificar.sh` (só imprime nomes e OK/FALHA).
2. **Nunca** `git push --force`, nunca editar migration, nunca rodar `pnpm db:migrate` contra outro banco que não o desta amostra.
3. Em cada passo marcado **🔑**, **pare e peça ao humano** exatamente o que está descrito; não invente valor,
   não pule. Quando ele precisar colar um segredo, peça que cole **direto no arquivo de env** (editor/terminal
   dele), não no chat.
4. Em cada passo: confira a **pré-condição**, rode o **comando**, compare com a **saída esperada**. Se falhar,
   siga "Se falhar"; se continuar falhando, pare e relate ao humano (comando + mensagem de erro **sem** segredos).
5. Comandos rodam na raiz do repositório, num shell **sem** as variáveis do `.env` local de desenvolvimento.
   Carregue arquivos de env só dentro de subshell `( … )`, para nada vazar para o shell seguinte.
6. **Nunca** rode `vercel deploy` (nem `vercel` sem subcomando) na sua máquina: a CLI envia a pasta local e
   **não** respeita o `.gitignore`, então os arquivos de segredo iriam junto. O build de produção da Vercel é
   sempre feito **a partir do Git** (branch `main`), como no passo 5. A CLI só serve para `link`, `env` e `inspect`.
7. Use uma máquina de **uso pessoal**: alguns comandos (`psql` nos passos 3 e 9) recebem a URL com senha na
   linha de comando, visível no `ps` de outros usuários da mesma máquina.

**Resultado esperado:** painel em `https://<domínio>` com o dono logando por TOTP; Início com "IA: Online";
simulador respondendo S1–S4; handoff aparecendo em Conversas em tempo real; importação de CSV funcionando;
gerente restrito (convidado pelo painel, Mais → Equipe) vendo só a sua unidade; limites de gasto conferidos em
Mais → Gastos e limites; `scripts/producao/verificar.sh` com `Resultado: 0 falha(s)`;
mensagem de "pronto" (passo 9) entregue ao humano.

## Variáveis por destino

Formato dos exemplos: só a forma, nunca o valor real. "Gerar" = o agente gera com o comando indicado.
`hex32` = `openssl rand -hex 32`; `b64` = `openssl rand -base64 32` (32 bytes em base64).

| Variável | Vercel | Worker (VPS) | Bootstrap | De onde vem | Exemplo de formato |
|---|---|---|---|---|---|
| `DATABASE_URL` | ✅ `web_app`, pooler **transaction** 6543 | ✅ `worker_app`, pooler **session** 5432 | ✅ `postgres` (admin) | 🔑 host do pooler (Supabase → Connect) + senhas do passo 3 | `postgresql://web_app.<ref>:<senha>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` |
| `SUPABASE_URL` | — | ✅ | ✅ | 🔑 Project Settings → API | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ **nunca** | ✅ | ✅ | 🔑 Project Settings → API Keys → **Secret key** (`sb_secret_…`) ou a legada `service_role` | `sb_secret_…` |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | — | — | igual a `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | — | — | 🔑 Project Settings → API Keys → **Publishable key** | `sb_publishable_…` |
| `NEXT_PUBLIC_LIMITE_UPLOAD_MB` | ✅ **`4`** (antes do build) | — | — | fixo | `4` |
| `PHONE_ENC_KEY` | ✅ | ✅ (mesmo valor) | — | gerar `b64` | `…=` (44 caracteres) |
| `WA_ID_PEPPER` | ✅ | ✅ (mesmo valor) | — | gerar `b64` | `…=` (44 caracteres) |
| `WHATSAPP_APP_SECRET` | ✅ | ✅ (mesmo valor) | — | gerar `hex32` (aleatório: sem Meta) | 64 hex |
| `WHATSAPP_VERIFY_TOKEN` | ✅ | ✅ (mesmo valor) | — | gerar `hex32` | 64 hex |
| `WHATSAPP_PHONE_NUMBER_ID` | ✅ | ✅ (mesmo valor) | — | fixo | `0` |
| `WHATSAPP_ACCESS_TOKEN` | ❌ **nunca** | ✅ | — | gerar `hex32` (token inválido de propósito) | 64 hex |
| `WHATSAPP_GRAPH_VERSION` | — | opcional | — | padrão `v24.0` | `v24.0` |
| `RESTAURANT_ID` | ✅ | ✅ (mesmo valor) | — | impresso pelo `bootstrap:prod` (passo 4) | uuid |
| `AI_PROVIDER` | ❌ | ✅ **`openai`** (o worker recusa outro valor em produção) | — | fixo | `openai` |
| `OPENAI_API_KEY` | ❌ **nunca** | ✅ | — | 🔑 passo 6 (chave do **projeto** da OpenAI) | `sk-proj-…` |
| `OPENAI_BASE_URL` | ❌ | ❌ (opcional; só e2e local aponta para o servidor falso) | — | — | — |
| `AI_TRIAGE_MODELS` | — | ✅ | — | fixo (seção Modelos) | `gpt-4.1-mini` |
| `AI_INGEST_MODELS` | — | ✅ | — | fixo (seção Modelos) | `gpt-4.1-mini,gpt-4.1` |
| `OPENROUTER_API_KEY` | ❌ | ❌ (só com `AI_PROVIDER=openrouter`, desenvolvimento local) | — | — | — |
| `OPENROUTER_DEV_SEM_ZDR` | ❌ | ❌ **nunca** (o worker recusa subir) | — | — | — |
| `OPENROUTER_BASE_URL` | ❌ | ❌ (só e2e local) | — | — | — |
| `LOG_LEVEL` | opcional | opcional | — | padrão `info` | `info` |
| `SENTRY_DSN` | opcional | opcional | — | 🔑 se houver projeto Sentry | `https://…@….ingest.sentry.io/…` |

`NODE_ENV=production` e `APP_VERSION` do worker vêm do `docker-compose.prod.yml`; não vão no `.env`.

## Modelos de IA (OpenAI direto em produção, definidos em 06/10/2026)

Produção usa **a OpenAI direto** (`AI_PROVIDER=openai`); o OpenRouter fica só no desenvolvimento local. O cliente
chama `/chat/completions` com **`store: false`**, `response_format: json_schema` estrito e `max_completion_tokens`;
o custo vem da tabela de preços em código (`packages/ai/src/precos-openai.ts`): **modelo fora da tabela ⇒ o worker
não sobe**. O PDF do cardápio vai como parte `file` e a foto como `image_url`.

**Privacidade (decisão do time, 06/10/2026):** a OpenAI não tem região de dados no Brasil nem ZDR por padrão. O time
aceitou a **retenção padrão de 30 dias para monitoramento de abuso, sem uso para treino**. Mitigações no código:
`store: false`, PII redigida antes da chamada, o modelo nunca recebe o telefone. Registre isso na mensagem de "pronto".

- **Triagem** — `AI_TRIAGE_MODELS=gpt-4.1-mini` (sem raciocínio, saída estruturada). Custo estimado: uma conversa
  de ~5 mensagens ≈ 10 chamadas, ~30 mil tokens de entrada (grande parte em cache) e ~3 mil de saída ⇒ **centavos**
  (confira o preço atual na tabela do código antes de prometer valor).
- **Leitura de cardápio (PDF/foto)** — `AI_INGEST_MODELS=gpt-4.1-mini,gpt-4.1` (o segundo entra se o primeiro der erro
  transitório ou recusar). Custo por importação de 1–3 páginas: **centavos**; a reserva de orçamento por importação é
  de **US$ 0,50** por lote (cobre a leitura e uma repetição no `gpt-4.1`). Desde a Etapa 07 os arquivos são lidos em
  lotes (5 páginas de PDF ou 3 fotos por lote, até 40 lotes), um lote por job: um PDF de 20 páginas = 4 lotes ≈ 4 leituras.
  Cada leitura tem prazo total de 120 s somando os dois modelos, e cada lote cabe nos 420 s do job.
- Outros modelos da tabela (`gpt-4.1-nano`, `gpt-5-mini`, `gpt-5-nano`) só entram depois de passar no `eval:prod`.
- Com **US$ 10** de limite mensal: milhares de conversas simuladas ou centenas de importações.
- **Confirmar com `smoke:ia:prod` e `eval:prod`** (passo 6) antes de apresentar.

## Passo 0 — Preparar a máquina e o repositório

**Pré-condição:** acesso ao repositório (branch `main` já com este runbook mesclado), Node 24, pnpm,
Docker, `psql` (cliente PostgreSQL 15+; sem ele o script usa Docker), `openssl`, `curl`, CLI da Vercel
(`pnpm dlx vercel@62`, sem instalar). Sempre chame a CLI como `pnpm dlx vercel@62 …`.

```bash
git fetch origin && git switch main && git pull --ff-only
test -f docs/runbooks/producao-amostra.md && echo runbook-ok
node -v; pnpm -v; docker version --format '{{.Server.Version}}'; psql --version; openssl version
pnpm install --frozen-lockfile
```

**Saída esperada:** `runbook-ok`; Node `v24.*`; demais comandos com versão. **Se falhar:** o runbook ainda não
está na `main` → 🔑 peça ao humano para mesclar o PR da branch `producao-amostra`; ferramenta ausente → instale-a.

🔑 **Peça ao humano:** (a) o **e-mail do dono** e o nome dele; (b) o **nome do restaurante**; (c) um segundo
e-mail para o **gerente restrito** (checklist). **Observação para o humano:** o SMTP padrão do Supabase só entrega
e-mail para membros da equipe da organização no Supabase e com poucos envios por hora; use e-mails de membros da
equipe ou configure SMTP próprio (Authentication → Emails → SMTP Settings).

🔑 **Peça ao humano que crie agora o projeto na Vercel** (o domínio `*.vercel.app` só existe depois disso, e a
Site URL do passo 1 e o `--politica` do passo 4 dependem dele). Painel da Vercel, time da empresa:

1. **Add New → Project** → importar o repositório do GitHub (production branch **`main`**).
2. Antes de confirmar: **Root Directory = `apps/web`** (Edit), framework **Next.js**; em Root Directory deixar
   ligado **"Include files outside the root directory in the Build Step"** (o build precisa de `packages/*`, do
   `pnpm-lock.yaml` e do `pnpm-workspace.yaml` da raiz). Não mexa em Build/Install Command (o padrão usa o pnpm do lockfile).
3. **Deploy**. Esse primeiro build **pode falhar** ou subir sem configuração (ainda não há variáveis): é esperado,
   ele é refeito no passo 5.
4. **Settings → Build and Deployment → Node.js Version = 24.x**; **Settings → Functions → Function Region = `gru1` (São Paulo)**.
5. Informar a você (não são segredos): o **slug do time**, o **nome do projeto** e o **domínio** de produção
   (`https://<projeto>.vercel.app` em Settings → Domains, ou o domínio próprio, se já for usar um).
6. Rodar `pnpm dlx vercel@62 login` na sua máquina, se a CLI ainda não estiver autenticada.

Ligue a **raiz do repositório** ao projeto (nunca `apps/web`: o Root Directory já é aplicado pela Vercel) e confira:

```bash
pnpm dlx vercel@62 link --yes --team <slug-do-time> --project <nome-do-projeto>
test -f .vercel/project.json && git check-ignore -q .vercel && echo link-ok
pnpm dlx vercel@62 project inspect <nome-do-projeto>
```

**Saída esperada:** `link-ok`; no `project inspect`, `Root Directory  apps/web` e `Node.js Version  24.x`.
**Se falhar:** `Root Directory .` ou outra versão do Node → 🔑 o humano corrige em Settings e você confere de novo;
`link` pedindo confirmação → faltou `--team`/`--project` (copie os valores exatos do painel); o `.vercel/` apareceu
em `git status` → **não** commite, confira o `.gitignore` da `main`.

Crie os três arquivos vazios protegidos (o humano e você vão preenchendo):

```bash
( umask 077; touch .env.production-bootstrap .env.vercel-producao .env.worker-producao )
ls -l .env.production-bootstrap .env.vercel-producao .env.worker-producao   # esperado: -rw-------
git check-ignore -q .env.production-bootstrap .env.vercel-producao .env.worker-producao && echo ignorados
```

**Saída esperada:** `-rw-------` nos três e `ignorados`. **Se falhar:** não continue até os três estarem ignorados pelo git.

## Passo 1 — Supabase de produção 🔑

**Pré-condição:** projeto da Vercel criado e domínio conhecido (passo 0).

🔑 **Peça ao humano** (painel `supabase.com/dashboard`) e confirme cada item com ele:

1. **New project** na organização da empresa: região **South America (São Paulo) `sa-east-1`**; senha do banco
   forte (ele guarda no cofre); **Postgres 17** (Project Settings → Infrastructure mostra a versão; a 0014 exige 17).
2. **Authentication → Sign In / Providers:** "Allow new users to sign up" = **off**; provedor **Email ligado**;
   "Email OTP Expiration" = **3600**.
3. **Authentication → Multi-Factor:** **TOTP** ligado.
4. **Authentication → Sign In / Providers → Email → Password:** tamanho mínimo **12**.
5. **Authentication → URL Configuration:** Site URL = `https://<domínio>`; Redirect URLs inclui `https://<domínio>/auth/confirm`.
6. **Authentication → Emails → Templates → Invite user:** colar o conteúdo de `supabase/templates/invite.html`
   (você pode abrir o arquivo e passar o conteúdo — não é segredo).
7. **Project Settings → Data API:** Exposed schemas **vazio** (remover `public` e `graphql_public`; desligar a Data API se o painel permitir).
8. **Realtime → Settings:** "Allow public access" = **off** (só canais privados, autorizados pela RLS de `realtime.messages` das migrations 0030–0031).
9. Storage: nada a fazer agora — os buckets privados `cardapio` e `importacoes` são criados pela migration 0027 (conferidos no passo 2).

Depois, 🔑 peça ao humano para colar **direto no `.env.production-bootstrap`** (não no chat):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<Secret key sb_secret_… (ou service_role legada)>
DATABASE_URL=postgresql://postgres.<ref>:<senha do banco>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

`DATABASE_URL` de administrador: **Connect → Session pooler** (porta 5432, IPv4). A conexão direta
`db.<ref>.supabase.co` também serve se a máquina tiver IPv6. Senha com caracteres especiais vai com URL-encode.
Peça também (não secretos; pode ser no chat): o **project ref**, o **host do pooler** (`aws-?-sa-east-1.pooler.supabase.com`)
e a **Publishable key**.

**Verificação:**

```bash
scripts/producao/verificar.sh --bootstrap .env.production-bootstrap
```

**Saída esperada:** `OK bootstrap: 3 variáveis obrigatórias presentes`, `OK Postgres 17` e, por enquanto,
FALHA em migrations/buckets/roles/restaurante (ainda não existem). **Se falhar:** "não conectou" → confira host,
porta 5432, usuário `postgres.<ref>` e URL-encode; "Postgres 15/16" → 🔑 o projeto precisa ser recriado em PG 17.

## Passo 2 — Migrations

**Pré-condição:** passo 1 com `OK Postgres 17`.

```bash
( set -a; . ./.env.production-bootstrap; set +a; pnpm db:migrate )
scripts/producao/verificar.sh --bootstrap .env.production-bootstrap
```

**Saída esperada:** o drizzle-kit aplica as migrations sem erro; o script mostra
`OK migrations aplicadas: 43 de 43 (até 0042_…)`, `OK bucket cardapio existe e é privado`,
`OK bucket importacoes existe e é privado`, `OK role web_app existe com login`, `OK role worker_app existe com login`.
**Se falhar:** erro de `MAINTAIN` → o banco não é PG 17 (passo 1); falha no meio → rode o mesmo comando de novo
(o drizzle aplica só as que faltam) e, se repetir, pare e relate a mensagem do drizzle-kit. Nunca edite uma migration.

**Atualizando uma amostra já publicada (worker já rodando no VPS):** pare o worker **antes** do `db:migrate` e suba a
imagem nova **logo depois**. Motivo: a 0033 recria o tipo `budget_scope` (`DROP TYPE`), e um worker antigo com
statements preparados passa a falhar nas reservas até reiniciar. Na ordem:

```bash
ssh <usuario>@<host> 'cd /opt/atendimento && docker compose --env-file .deploy.env -f docker-compose.prod.yml stop worker'
( set -a; . ./.env.production-bootstrap; set +a; pnpm db:migrate )
scripts/producao/verificar.sh --bootstrap .env.production-bootstrap
```

Depois suba a imagem nova pelo passo 8 (Caminho A ou B, que fazem `up -d`) e confira a linha `worker iniciado`.
Enquanto o worker está parado, as mensagens ficam na fila e são respondidas quando ele volta.

**Etapa 07 (importação por alvo, migrations 0040–0042):** a 0040 recria o tipo do alvo da importação
(`knowledge_document_target`) — mesmo motivo para parar o worker antes. No boot, o worker novo ajusta a fila
`document.ingest` já existente para o prazo de **420 s** por job (`boss.updateQueue`; o `createQueue` não muda fila que
já existe). Não há variável nova: a leitura de informações, horários e espaços usa os mesmos `AI_INGEST_MODELS`. Uma
importação que estava sendo lida durante a troca de versão continua do último lote salvo quando o worker volta.

## Passo 3 — Senhas dos roles e URLs de conexão

**Pré-condição:** passo 2 verde. Você tem o `<ref>` e o host do pooler.

Gere as senhas (hex: sem URL-encode), aplique no banco e escreva as `DATABASE_URL` nos arquivos, sem imprimir nada:

```bash
REF='<project ref>'; POOLER='<host do pooler, ex.: aws-0-sa-east-1.pooler.supabase.com>'
(
  set -euo pipefail; umask 077
  set -a; . ./.env.production-bootstrap; set +a
  WEB=$(openssl rand -hex 32); WRK=$(openssl rand -hex 32)
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -v web="$WEB" -v wrk="$WRK" <<'SQL'
alter role web_app with password :'web';
alter role worker_app with password :'wrk';
SQL
  printf 'DATABASE_URL=postgresql://web_app.%s:%s@%s:6543/postgres\n' "$REF" "$WEB" "$POOLER" >> .env.vercel-producao
  printf 'DATABASE_URL=postgresql://worker_app.%s:%s@%s:5432/postgres\n' "$REF" "$WRK" "$POOLER" >> .env.worker-producao
)
grep -c '^DATABASE_URL=' .env.vercel-producao .env.worker-producao   # esperado: 1 em cada
```

As senhas não ficam em lugar nenhum além desses arquivos (e do banco). Para trocar depois, rode o bloco de novo
**apagando antes** as linhas `DATABASE_URL` dos dois arquivos. **Se falhar:** `psql` ausente → instale `postgresql-client`.
A conexão com essas URLs é conferida pelo script no passo 7.

## Passo 4 — Restaurante, dono e dados de demonstração

**Pré-condição:** passos 1–3; Site URL e template de convite configurados (o convite sai agora).

⚠️ **O convite vale 1 hora** ("Email OTP Expiration" = 3600 no passo 1) e o painel só funciona depois do passo 5.
🔑 **Avise o humano já:** o dono **não** deve abrir o e-mail antes de você dizer que o passo 5 terminou (painel
Ready); combinem de fazer os passos 4 e 5 em sequência e o login do dono logo em seguida. Se o link expirar (ou
for aberto cedo demais), siga a **recuperação do convite** abaixo.

```bash
pnpm --filter @atd/db bootstrap:prod --restaurante "<Nome do restaurante>" --dono <email-do-dono> --nome-dono "<Nome do dono>" --politica https://<domínio>/privacidade
pnpm --filter @atd/db demo:s1:prod
```

**Saída esperada:** `Restaurante <uuid> pronto; convite enviado para o dono.` (anote o uuid: é o `RESTAURANT_ID`)
e `Demonstração de S1 pronta: 4 unidades, 6 informações e cardápio com 7 itens, …`. Os dois são idempotentes.
**Se falhar:** `.env.production-bootstrap: not found` → rode da raiz e confira o arquivo; erro de convite
(SMTP/limite) → 🔑 o humano configura SMTP e você segue a recuperação abaixo; "Mais de um restaurante" → pare e relate.

**Recuperação do convite** (link expirado, e-mail que não chegou ou aberto antes do painel no ar). Rodar o
`bootstrap:prod` de novo **sozinho não reenvia**: com o usuário já existente ele imprime
`dono já existia; convite não reenviado.`. Por isso:

1. 🔑 O humano apaga o usuário do dono em **Authentication → Users → (e-mail do dono) → Delete user**. É seguro
   antes do primeiro login: o vínculo em `staff` é apagado junto (`on delete cascade`) e restaurante, unidades e
   dados de demonstração ficam.
2. Você roda **o mesmo** `pnpm --filter @atd/db bootstrap:prod …` acima (idempotente: devolve o mesmo
   `RESTAURANT_ID`, recria o vínculo do dono e envia um convite novo).
3. **Saída esperada:** `convite enviado para o dono.` e o mesmo uuid de antes (se o uuid mudou, pare e relate).

Gere os valores compartilhados e grave **o mesmo valor** nos dois arquivos (Vercel e worker):

```bash
RID='<uuid impresso pelo bootstrap:prod>'
(
  set -euo pipefail; umask 077
  PK=$(openssl rand -base64 32); PP=$(openssl rand -base64 32); AS=$(openssl rand -hex 32); VT=$(openssl rand -hex 32)
  for f in .env.vercel-producao .env.worker-producao; do
    printf 'PHONE_ENC_KEY=%s\nWA_ID_PEPPER=%s\nWHATSAPP_APP_SECRET=%s\nWHATSAPP_VERIFY_TOKEN=%s\nWHATSAPP_PHONE_NUMBER_ID=0\nRESTAURANT_ID=%s\nLOG_LEVEL=info\n' \
      "$PK" "$PP" "$AS" "$VT" "$RID" >> "$f"
  done
  printf 'WHATSAPP_ACCESS_TOKEN=%s\n' "$(openssl rand -hex 32)" >> .env.worker-producao
)
```

🔑 **Avise o humano:** guardar `PHONE_ENC_KEY` e `WA_ID_PEPPER` no cofre da empresa (ele copia do arquivo).
Perder a chave = perder os telefones cifrados.

## Passo 5 — Vercel (variáveis e build de produção pelo Git)

**Pré-condição:** passos 0–4 (projeto criado e `link-ok` no passo 0); você tem a Publishable key.

Complete o `.env.vercel-producao` (só valores públicos aqui):

```bash
SUPA=$( . ./.env.production-bootstrap; printf '%s' "$SUPABASE_URL" )
printf 'NEXT_PUBLIC_SUPABASE_URL=%s\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\nNEXT_PUBLIC_LIMITE_UPLOAD_MB=4\n' \
  "$SUPA" '<publishable key>' >> .env.vercel-producao
```

Cadastre as variáveis **só em Production**, **na raiz do repositório**, lendo do arquivo (nada no histórico do shell):

```bash
pnpm dlx vercel@62 project inspect <nome-do-projeto> | grep -E 'Name|Root Directory'   # alvo certo antes de mudar algo
(
  set -euo pipefail
  # IFS= + cortes manuais: base64 termina em "=" e um read com IFS='=' perderia esse caractere
  while IFS= read -r linha; do
    case "$linha" in ''|\#*) continue ;; esac
    nome="${linha%%=*}"; valor="${linha#*=}"
    printf '%s' "$valor" | pnpm dlx vercel@62 env add "$nome" production --force --yes >/dev/null
    echo "cadastrada: $nome"
  done < .env.vercel-producao
)
pnpm dlx vercel@62 env ls production
```

**Saída esperada:** `Name <nome-do-projeto>` e `Root Directory apps/web`; `cadastrada:` para as 11 variáveis
(`DATABASE_URL`, `PHONE_ENC_KEY`, `WA_ID_PEPPER`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `RESTAURANT_ID`, `LOG_LEVEL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_LIMITE_UPLOAD_MB`) e as 11 no `env ls`, todas em Production.
**Nunca** cadastre `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_ACCESS_TOKEN`, `OPENAI_*` ou `OPENROUTER_*` na Vercel.
Se a CLI não aceitar `--force`, remova antes com `pnpm dlx vercel@62 env rm <NOME> production --yes`.

**Build de produção** (as `NEXT_PUBLIC_*` são embutidas **no build**, por isso vêm antes). O build é feito pela
Vercel a partir do Git, nunca enviado da sua máquina (regra 6). 🔑 **Peça ao humano**, no painel do projeto:
**Deployments** → o deploy de **Production** mais recente (o do passo 0) → **⋯ → Redeploy**, com **"Use existing
Build Cache" desmarcado** → Redeploy. Espere o status **Ready** e confira você:

```bash
pnpm dlx vercel@62 inspect https://<domínio>          # esperado: status Ready, target production, criado agora
curl -s -o /dev/null -w '%{http_code}\n' https://<domínio>/login   # esperado: 200
```

**Saída esperada:** `Ready` com horário posterior ao cadastro das variáveis e `200`. Se o domínio é próprio,
🔑 o humano o associa em Settings → Domains (e a Site URL do passo 1 precisa ser esse domínio). Mudou uma
`NEXT_PUBLIC_*` depois? Cadastre de novo e peça **novo Redeploy** (o valor antigo fica no build).
**Se falhar:**
- build quebrou → `pnpm dlx vercel@62 inspect --logs https://<domínio>` (ou o log no painel) e:
  - "Cannot find module '@atd/…'" ou lockfile não encontrado → Root Directory sem "Include files outside the root
    directory" (passo 0, item 2);
  - erro de versão do pnpm (o `packageManager` da raiz pede pnpm 11) → 🔑 o humano adiciona a variável
    `ENABLE_EXPERIMENTAL_COREPACK=1` em Production e faz Redeploy de novo;
  - erro de versão do Node → Settings → Node.js Version = 24.x;
- `inspect` mostra um deploy antigo → o Redeploy ainda não terminou ou foi feito em Preview: peça para refazer em Production;
- erro "Variáveis de ambiente inválidas" nos logs de função → rode o passo 7 e corrija a variável apontada.

## Passo 6 — OpenAI 🔑

**Pré-condição:** passos 0–5 feitos; `.env.worker-producao` existe (passo 4). 🔑 **Peça ao humano**
(platform.openai.com, conta da empresa):

1. **Criar um projeto** só para esta amostra (ex.: `atendimento-amostra`).
2. No projeto, **Limits → limite de gasto mensal** (ex.: US$ 10) e saldo/cartão suficiente. É a camada 2 do
   orçamento; a camada 1 é o nosso banco.
3. No projeto, **Limits → Model access (liberar modelos):** permitir só `gpt-4.1-mini` e `gpt-4.1` (e nenhum outro).
4. **API keys → Create** uma chave **do projeto** (não a da organização); colar **direto** no
   `.env.worker-producao` como `OPENAI_API_KEY=sk-proj-…`.
5. Ciente da privacidade (seção Modelos): retenção padrão de 30 dias da OpenAI, sem treino, aceita pelo time.

Complete o worker e rode o **smoke test**. Ele usa **o mesmo cliente e a mesma validação do worker** (`store: false`,
`json_schema` estrito, preço de cada modelo na tabela) e chama cada modelo sozinho e depois cada lista (triagem e
cardápio), exigindo `{"ok":true}` em todas:

```bash
printf 'AI_PROVIDER=openai\nAI_TRIAGE_MODELS=gpt-4.1-mini\nAI_INGEST_MODELS=gpt-4.1-mini,gpt-4.1\n' >> .env.worker-producao
pnpm --filter @atd/worker smoke:ia:prod; echo "saida=$?"
```

**Como o env é carregado (smoke e eval):** os dois scripts leem o `.env.worker-producao` da **raiz do repositório**
(qualquer que seja a pasta de onde você rodou) e os valores do arquivo **vencem** os do shell — um `.env` local
carregado antes (`set -a; source .env`) não troca provedor, chave nem modelos. Os dois ignoram `OPENAI_BASE_URL` e
`OPENROUTER_BASE_URL` (só e2e local); o smoke também ignora `OPENROUTER_DEV_SEM_ZDR`.

**Saída esperada:** a linha `Provedor: openai` (se aparecer `AVISO: provedor openrouter`, falta `AI_PROVIDER=openai` no
`.env.worker-producao`: corrija antes de seguir), uma linha `OK <modelo> → <modelo usado> (US$ …, … ms)` por modelo
sozinho e por lista (o modelo usado pode vir com data, ex.: `gpt-4.1-mini-2025-04-14`), `Resultado: OK` e `saida=0`.
O custo total fica abaixo de US$ 0,01. **Se falhar** (`saida=1`; cada `FALHA` traz o erro da OpenAI, com qualquer
pedaço de chave trocado por `sk-…`):
- `FALHA .env.worker-producao: not found` → o arquivo não existe na raiz do repositório (passo 4);
- `FALHA Variáveis de ambiente inválidas ou ausentes: OPENAI_API_KEY` (ou `AI_PROVIDER`, `AI_TRIAGE_MODELS`) → falta a
  linha no `.env.worker-producao` ou o valor está errado; `AI_PROVIDER` aparece se o arquivo tiver
  `NODE_ENV=production` sem `AI_PROVIDER=openai`;
- `FALHA Modelo(s) sem preço cadastrado em packages/ai/src/precos-openai.ts: <modelos> (cadastrados: …)` → o nome não
  está na tabela de preços: use um nome da seção Modelos (o worker também não sobe com ele; nenhuma chamada foi feita);
- `… Incorrect API key provided: sk-… (HTTP 401)` → 🔑 chave errada, revogada ou de outro projeto;
- `… does not have access to model … (HTTP 403)` (ou `HTTP 404` com "does not exist") → 🔑 o modelo não está liberado
  no projeto (passo 3);
- `sem_cota: … You exceeded your current quota … (HTTP 429)` → 🔑 sem saldo ou limite mensal do projeto atingido;
  `… Rate limit reached … (HTTP 429)` → espere um minuto e rode de novo;
- `saida_invalida`/`saida_truncada` → troque o modelo pelo próximo da lista e registre.

Depois do smoke test, rode o **portão de qualidade** (triagem S1–S4 e frustração contra a OpenAI, com o env de
produção carregado como acima e `AI_PROVIDER=openai` forçado; custa centavos) e **só apresente se passar**:

```bash
pnpm --filter @atd/ai eval:prod; echo "saida=$?"
```

**Saída esperada:** cada eval imprime seu relatório (acerto por modelo contra a meta; também gravado em
`packages/ai/evals/<serviço>/resultados/`), e no fim `OK s1`, `OK s2`, `OK s3`, `OK s4`, `OK frustracao`,
`Resultado: OK` e `saida=0`. Todos rodam mesmo se um reprovar. **Se falhar:** relate ao humano as linhas `FALHA` e a
seção "Erros por modelo" de cada relatório reprovado (sem segredos); não publique a amostra para apresentação até ele
decidir (trocar de modelo ou ajustar prompt é trabalho de desenvolvimento, não deste runbook). Erro de configuração
(`Defina OPENAI_API_KEY`, "sem preço cadastrado") tem a mesma correção do smoke test.

## Passo 7 — Conferência antes do worker

Complete o worker com as variáveis do Storage (copiadas do bootstrap, sem imprimir) e rode o script completo:

```bash
( umask 077; . ./.env.production-bootstrap; printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" >> .env.worker-producao )
scripts/producao/verificar.sh --bootstrap .env.production-bootstrap --vercel .env.vercel-producao \
  --worker .env.worker-producao --dominio https://<domínio>
```

**Saída esperada:** só `OK` (e `AVISO` apenas se você usou outra porta de propósito) e `Resultado: 0 falha(s)`;
código de saída 0. O script confere: arquivos `600` e fora do git; variáveis obrigatórias e proibidas por destino;
chaves de 32 bytes iguais nos dois destinos; `NEXT_PUBLIC_LIMITE_UPLOAD_MB=4`; `AI_PROVIDER=openai` e `OPENAI_API_KEY` no worker (sem `OPENROUTER_API_KEY`) e ausência de `OPENROUTER_DEV_SEM_ZDR`;
login real como `web_app`/`worker_app`; Postgres 17; 43 migrations; buckets privados; roles com login; restaurante,
dono, limites de gasto e demo; `RESTAURANT_ID` igual ao do banco; cadastro público desligado; Data API sem `public`;
chave de serviço lendo o Storage; `/login` 200 e webhook recusando POST sem assinatura.
**Se falhar:** cada `FALHA` traz a correção depois do `—`. Corrigiu variável da Vercel → cadastre de novo (passo 5) e redeploy.

## Passo 8 — VPS e worker

**Pré-condição:** passo 7 verde. 🔑 **Peça ao humano:** host e usuário SSH do VPS da empresa (Hostinger,
idealmente datacenter em São Paulo) e se o VPS é **dedicado** a este worker ou **compartilhado**.

Confira o VPS (saída esperada: versão do Docker e do Compose v2):

```bash
ssh <usuario>@<host> 'docker version --format "{{.Server.Version}}" && docker compose version && uname -m'
```

- **VPS novo e dedicado:** 🔑 o humano roda como root `bash infra/vps/bootstrap.sh deploy "<chave pública do deploy>" "<chave pública do admin>"`
  (endurece SSH, firewall só SSH, Docker). Ele confirma o acesso por chave numa segunda sessão antes de fechar a primeira.
- **VPS compartilhado** (já tem outros serviços): **não** rode `bootstrap.sh` (ele muda sshd e firewall).
  Basta Docker + Compose v2 e o diretório `/opt/atendimento` do usuário de deploy. Se o `install -d` abaixo der
  "Permission denied", 🔑 peça ao humano para rodar no VPS (com o usuário SSH no lugar de `<usuario>`):
  `sudo install -d -m 750 -o <usuario> -g <usuario> /opt/atendimento`.

Copie os arquivos (o `.env` vai com permissão 600):

```bash
ssh <usuario>@<host> 'install -d -m 750 /opt/atendimento'
scp apps/worker/docker-compose.prod.yml <usuario>@<host>:/opt/atendimento/docker-compose.prod.yml
scp .env.worker-producao <usuario>@<host>:/opt/atendimento/.env
ssh <usuario>@<host> 'chmod 600 /opt/atendimento/.env && ls -l /opt/atendimento'
```

**O que o worker faz além das conversas (Etapa 08; nenhuma variável nova):** envia os **convites de equipe** do
painel (fila `equipe.convite`, com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` que já estão no `.env` do worker) e
agenda a **limpeza diária de retenção** às 03:00 (horário de Brasília; fila `retencao.diaria`, agendada no boot pelo
pg-boss, sem `pg_cron`). **Conexões:** o worker abre até **14** conexões no pooler de sessão (drizzle 11 + pg-boss 3).
Nos planos menores do Supabase (Nano/Micro) o pool do pooler é de cerca de 15 por usuário e banco: confira em
Database → Settings → Connection pooling (Pool Size). Se o log mostrar `max clients reached` ou `too many connections`,
🔑 peça ao humano para aumentar o Pool Size ou o tamanho da instância.

**Caminho A — workflow `Worker deploy` (preferido se o GitHub já estiver configurado):** precisa do environment
`production` com os secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` e aprovação obrigatória
([deploy.md §10](deploy.md#10-github)); 🔑 o humano configura. O workflow dispara sozinho depois do CI verde num push na
`main`, ou manualmente: `gh workflow run "Worker deploy" --ref main`. 🔑 O humano **aprova** o deploy em Actions.
O próprio workflow confere `running` + log `worker iniciado`. No VPS: `docker login ghcr.io` com PAT só `read:packages` (🔑).

**Caminho B — imagem construída na sua máquina e enviada por SSH (sem GHCR, sem secrets no GitHub):**

```bash
TAG=$(git rev-parse --short=12 HEAD)
docker build --platform linux/amd64 -f apps/worker/Dockerfile -t atd-worker:$TAG .
docker save atd-worker:$TAG | gzip | ssh <usuario>@<host> 'gunzip | docker load'
ssh <usuario>@<host> "cd /opt/atendimento && printf 'WORKER_IMAGE=atd-worker\nIMAGE_TAG=$TAG\nENV_FILE=.env\n' > .deploy.env \
  && docker compose --env-file .deploy.env -f docker-compose.prod.yml up -d"
```

(`uname -m` = `aarch64` no VPS → troque `--platform linux/amd64` por `linux/arm64`.)

**Verificação (os dois caminhos):**

```bash
sleep 20
ssh <usuario>@<host> 'cd /opt/atendimento && docker compose --env-file .deploy.env -f docker-compose.prod.yml ps \
  && docker compose --env-file .deploy.env -f docker-compose.prod.yml logs --since 2m worker | grep "worker iniciado" | grep -c "\"provedorIa\":\"openai\""'
```

**Saída esperada:** serviço `worker` `running` e contagem ≥ 1 (a linha `worker iniciado` traz `"provedorIa":"openai"` e os
modelos, nunca a chave). **Se falhar:** `Variáveis de ambiente inválidas ou
ausentes: X` → corrija `X` no `.env` do VPS (e no `.env.worker-producao`), `up -d` de novo; `OPENROUTER_DEV_SEM_ZDR`
na mensagem → apague a linha; `AI_PROVIDER` na mensagem → deve ser `openai` em produção; `Modelo(s) sem preço cadastrado` → use os nomes da seção Modelos; erro de conexão ao banco → confira a porta 5432 (pooler session) e se o VPS sai para a internet.
O worker **não** abre porta.

## Passo 9 — Checklist final (com evidência)

Rode e anote cada item. 🔑 O humano faz os itens de navegador (ou acompanha você, se você tiver navegador).

| # | Item | Como | Evidência a anotar |
|---|---|---|---|
| 1 | Script verde | `scripts/producao/verificar.sh --bootstrap .env.production-bootstrap --vercel .env.vercel-producao --worker .env.worker-producao --dominio https://<domínio>` | última linha `Resultado: 0 falha(s)` |
| 2 | Login com TOTP | 🔑 dono abre o convite (vale 1 h; expirado → recuperação do convite, passo 4), define senha (≥ 12), cadastra o autenticador e entra | "dono entrou com TOTP" |
| 3 | IA Online | Início mostra **IA: Online** (heartbeat do worker) | print ou texto do cartão |
| 4 | Simulador S1–S4 | botão "Abrir simulador de WhatsApp" do painel: "que horas abre a Asa Sul hoje?" (S1), "vou chegar às 20h com 4 pessoas" (S2), "quero fazer um aniversário para 30 pessoas" (S3), "quanto custa a picanha?" (S4) | uma linha por serviço: pergunta → resumo da resposta |
| 5 | Handoff em tempo real | no simulador: "quero falar com um atendente"; com Conversas aberta em outra aba, a conversa aparece **sem recarregar** | "apareceu em N s sem recarregar" |
| 6 | Importar CSV | Conteúdo → Cardápio → sub-aba Importar → CSV pequeno (2 itens) → revisar → aprovar | itens novos visíveis no cardápio |
| 7 | Gerente restrito | ver abaixo (convite pelo painel) | gerente vê só a unidade dele em Unidades/Agenda/Conversas |
| 8 | Gastos | Início → Gastos mostra o gasto do dia (> US$ 0 após o item 4; o simulador conta na linha **Simulação**, fora do total dos clientes); Mais → **Gastos e limites** mostra os limites padrão (IA 2/dia e 40/mês; Simulação 1/dia e 10/mês; WhatsApp 1/dia e 20/mês) — o dono ajusta ali, pelo painel, se quiser | valor exibido e limites conferidos |

Gerente restrito (pelo painel, Etapa 08): 🔑 o **dono**, logado, vai em **Mais → Equipe → Convidar**: nome
"Gerente Asa Sul", o e-mail do gerente (passo 0), papel **Gerente**, desliga **Todas as unidades** e marca só
**Asa Sul** ⇒ **Enviar convite** ⇒ "Convite enviado". Em segundos o worker envia o e-mail e a pessoa aparece como
"Convite enviado, aguardando o primeiro acesso". O gerente abre o convite (vale 1 h), define a senha, cadastra o
TOTP e só enxerga a Asa Sul. Confira também no banco (só leitura):

```bash
( set -a; . ./.env.production-bootstrap; set +a
  psql "$DATABASE_URL" -X -At -c "select status, coalesce(erro, '-') from staff_invites order by created_at desc limit 1" )
```

Saída esperada: `enviado|-`. **Se falhar:** "Falha ao enviar o convite" na tela (no banco, `erro|limite_envio` ou
`erro|falha_convite`) → o SMTP padrão do Supabase só entrega para membros da organização e com poucos e-mails por
hora: 🔑 o humano usa um e-mail de membro da organização ou configura SMTP próprio (passo 0) e o dono toca em
**Reenviar convite**; `erro|indisponivel` → o worker não alcançou o Supabase Auth: confira `SUPABASE_URL` no `.env`
do worker e reenvie; `erro|outro_restaurante` → o e-mail já é de outro restaurante: pare e relate; convite parado em
"Enviando o convite…" por mais de 1 minuto → o worker não está rodando (passo 8). Link expirado → **Reenviar
convite** no painel.

**Mensagem de "pronto" para devolver ao humano** (preencha; sem segredos):

```
Amostra publicada.
- Painel: https://<domínio> (Vercel, região gru1, deploy <id/URL do deploy>)
- Supabase: projeto <ref> em sa-east-1, Postgres <versão>, 43 migrations, buckets privados
- Worker: VPS <host>, imagem <tag>, status running, "worker iniciado" às <hora>
- IA: OpenAI direto (`AI_PROVIDER=openai`, `store: false`, retenção padrão de 30 dias aceita pelo time); triagem gpt-4.1-mini; cardápio gpt-4.1-mini → gpt-4.1 (smoke:ia:prod: <resultado>; eval:prod: <resultado>)
- verificar.sh: 0 falha(s) em <data/hora>
- Checklist: TOTP ok · IA Online · S1/S2/S3/S4 ok · handoff em tempo real em <N> s · CSV ok · gerente restrito ok · Gastos US$ <x>
- Segredos: só em .env.production-bootstrap, .env.vercel-producao, .env.worker-producao (chmod 600, fora do git)
  e no /opt/atendimento/.env do VPS. Guardar PHONE_ENC_KEY e WA_ID_PEPPER no cofre.
- Pendências: <nenhuma | lista>
```

## O que não está na amostra

- **WhatsApp/Meta** (webhook assinado, número, templates, token permanente): [deploy.md §7](deploy.md#7-meta) — Etapa 09.
- **Staging** e release regular: [deploy.md](deploy.md#staging).
- **Go-live** (Etapa 09): PITR, environment `production` com aprovação (se usar o caminho B aqui), Ignored Build Step
  da Vercel, rollback, upload acima de ~4,5 MB por URL assinada, `secure_password_change`, Sentry, domínio definitivo.
- Upload: na amostra o limite é **4 MB** por arquivo (corpo da Vercel); acima disso o painel recusa com mensagem.
