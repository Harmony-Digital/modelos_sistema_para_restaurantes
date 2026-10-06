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

**Resultado esperado:** painel em `https://<domínio>` com o dono logando por TOTP; Início com "IA: Online";
simulador respondendo S1–S4; handoff aparecendo em Conversas em tempo real; importação de CSV funcionando;
gerente restrito vendo só a sua unidade; `scripts/producao/verificar.sh` com `Resultado: 0 falha(s)`;
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
| `OPENROUTER_API_KEY` | ❌ | ✅ | — | 🔑 passo 6 | `sk-or-v1-…` |
| `AI_TRIAGE_MODELS` | — | ✅ | — | fixo (seção Modelos) | `mistralai/mistral-nemo,mistralai/mistral-small-3.2-24b-instruct` |
| `AI_INGEST_MODELS` | — | ✅ | — | fixo (seção Modelos) | `google/gemini-3.1-flash-lite,openai/gpt-4.1-mini` |
| `OPENROUTER_DEV_SEM_ZDR` | ❌ | ❌ **nunca** (o worker recusa subir) | — | — | — |
| `OPENROUTER_BASE_URL` | ❌ | ❌ (só e2e local) | — | — | — |
| `LOG_LEVEL` | opcional | opcional | — | padrão `info` | `info` |
| `SENTRY_DSN` | opcional | opcional | — | 🔑 se houver projeto Sentry | `https://…@….ingest.sentry.io/…` |

`NODE_ENV=production` e `APP_VERSION` do worker vêm do `docker-compose.prod.yml`; não vão no `.env`.

## Modelos de IA (escolhidos em 06/10/2026)

Consulta à API pública do OpenRouter (`/api/v1/models` e `/api/v1/endpoints/zdr`): só entram modelos com
endpoint **ZDR** que aceita **`structured_outputs`**, sem data de expiração anunciada. O cliente manda em toda
chamada `provider: { data_collection: 'deny', zdr: true }` e `response_format: json_schema` estrito.

- **Triagem** — `AI_TRIAGE_MODELS=mistralai/mistral-nemo,mistralai/mistral-small-3.2-24b-instruct`
  - `mistral-nemo` (principal): ZDR em DekaLLM, DeepInfra, Parasail, Novita e Mistral (UE), todos com saída
    estruturada; US$ 0,018–0,04/M entrada e 0,03–0,17/M saída. Sem raciocínio (não gasta `max_tokens` pensando).
  - `mistral-small-3.2-24b-instruct` (reserva): ZDR em Mistral (UE), Parasail e DeepInfra; US$ 0,075–0,10/M
    entrada e 0,20–0,30/M saída; sem raciocínio.
  - Fora: `google/gemini-2.5-flash-lite` (o reserva anterior) **expira em 20/10/2026** no OpenRouter.
  - Custo estimado: uma conversa de ~5 mensagens ≈ 10 chamadas, ~30 mil tokens de entrada e ~3 mil de saída
    ⇒ **≈ US$ 0,001** no principal, **≈ US$ 0,004** se tudo cair no reserva.
- **Leitura de cardápio (PDF/foto)** — `AI_INGEST_MODELS=google/gemini-3.1-flash-lite,openai/gpt-4.1-mini`
  - `gemini-3.1-flash-lite` (principal): entrada texto/imagem/**arquivo (PDF nativo)**; ZDR no Google Vertex
    (global/UE/EUA); US$ 0,25/M entrada e 1,50/M saída.
  - `gpt-4.1-mini` (reserva): imagem + arquivo; ZDR no Azure; US$ 0,40/M entrada e 1,60/M saída; sem raciocínio.
  - Fora: `google/gemini-2.5-flash` (expira em 20/10/2026).
  - Custo estimado por importação (PDF/foto de 1–3 páginas, ~5 mil tokens de entrada e até 8 mil de saída;
    teto do código 16 mil) ⇒ **≈ US$ 0,01–0,03**. A reserva de orçamento por importação é de US$ 0,10.
- Com **US$ 10** de crédito: milhares de conversas simuladas ou centenas de importações.
- **Confirmar com o smoke test após pôr crédito** (passo 6): ZDR + saída estruturada respondem nos quatro
  modelos. O Gemini 3.1 é modelo com raciocínio; se o smoke test mostrar saída vazia/cortada, troque a ordem
  (`openai/gpt-4.1-mini` primeiro) e registre.

## Passo 0 — Preparar a máquina e o repositório

**Pré-condição:** acesso ao repositório (branch `main` já com este runbook mesclado), Node 24, pnpm,
Docker, `psql` (cliente PostgreSQL 15+; sem ele o script usa Docker), `openssl`, `curl`, CLI da Vercel (`pnpm dlx vercel`).

```bash
git fetch origin && git switch main && git pull --ff-only
test -f docs/runbooks/producao-amostra.md && echo runbook-ok
node -v; pnpm -v; docker version --format '{{.Server.Version}}'; psql --version; openssl version
pnpm install --frozen-lockfile
```

**Saída esperada:** `runbook-ok`; Node `v24.*`; demais comandos com versão. **Se falhar:** o runbook ainda não
está na `main` → 🔑 peça ao humano para mesclar o PR da branch `producao-amostra`; ferramenta ausente → instale-a.

🔑 **Peça ao humano:** (a) o **domínio** do painel (ex.: `https://<projeto>.vercel.app` ou domínio próprio);
(b) o **e-mail do dono** e o nome dele; (c) o **nome do restaurante**; (d) um segundo e-mail para o
**gerente restrito** (checklist). **Observação para o humano:** o SMTP padrão do Supabase só entrega e-mail para
membros da equipe da organização no Supabase e com poucos envios por hora; use e-mails de membros da equipe
ou configure SMTP próprio (Authentication → Emails → SMTP Settings).

Crie os três arquivos vazios protegidos (o humano e você vão preenchendo):

```bash
( umask 077; touch .env.production-bootstrap .env.vercel-producao .env.worker-producao )
ls -l .env.production-bootstrap .env.vercel-producao .env.worker-producao   # esperado: -rw-------
git check-ignore -q .env.production-bootstrap .env.vercel-producao .env.worker-producao && echo ignorados
```

**Saída esperada:** `-rw-------` nos três e `ignorados`. **Se falhar:** não continue até os três estarem ignorados pelo git.

## Passo 1 — Supabase de produção 🔑

**Pré-condição:** domínio definido (passo 0).

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
`OK migrations aplicadas: 33 de 33 (até 0032_…)`, `OK bucket cardapio existe e é privado`,
`OK bucket importacoes existe e é privado`, `OK role web_app existe com login`, `OK role worker_app existe com login`.
**Se falhar:** erro de `MAINTAIN` → o banco não é PG 17 (passo 1); falha no meio → rode o mesmo comando de novo
(o drizzle aplica só as que faltam) e, se repetir, pare e relate a mensagem do drizzle-kit. Nunca edite uma migration.

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

```bash
pnpm --filter @atd/db bootstrap:prod --restaurante "<Nome do restaurante>" --dono <email-do-dono> --nome-dono "<Nome do dono>" --politica https://<domínio>/privacidade
pnpm --filter @atd/db demo:s1:prod
```

**Saída esperada:** `Restaurante <uuid> pronto; convite enviado para o dono.` (anote o uuid: é o `RESTAURANT_ID`)
e `Demonstração de S1 pronta: 4 unidades, 6 informações e cardápio com 7 itens, …`. Os dois são idempotentes.
**Se falhar:** `.env.production-bootstrap: not found` → rode da raiz e confira o arquivo; erro de convite
(SMTP/limite) → 🔑 o humano reenvia em Authentication → Users → Invite ou configura SMTP; "Mais de um restaurante" → pare e relate.

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

## Passo 5 — Vercel

**Pré-condição:** passos 1–4; você tem a Publishable key.

Complete o `.env.vercel-producao` (só valores públicos aqui):

```bash
SUPA=$( . ./.env.production-bootstrap; printf '%s' "$SUPABASE_URL" )
printf 'NEXT_PUBLIC_SUPABASE_URL=%s\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=%s\nNEXT_PUBLIC_LIMITE_UPLOAD_MB=4\n' \
  "$SUPA" '<publishable key>' >> .env.vercel-producao
```

🔑 **Peça ao humano** (painel da Vercel, time da empresa), se o projeto ainda não existir: **Add New → Project**
→ importar o repositório → **Root Directory `apps/web`** (framework Next.js; deixar ligado "Include files outside
the root directory") → **não fazer deploy ainda** (ou deixar o primeiro falhar; ele será refeito). Depois:
**Settings → Functions → Function Region = `gru1` (São Paulo)**. Peça também que ele rode `vercel login` na
sua máquina, se a CLI ainda não estiver autenticada.

Ligue o diretório e cadastre as variáveis **só em Production**, lendo do arquivo (nada no histórico do shell):

```bash
cd apps/web && pnpm dlx vercel link && cd ../..
(
  set -euo pipefail
  cd apps/web
  # IFS= + cortes manuais: base64 termina em "=" e um read com IFS='=' perderia esse caractere
  while IFS= read -r linha; do
    case "$linha" in ''|\#*) continue ;; esac
    nome="${linha%%=*}"; valor="${linha#*=}"
    printf '%s' "$valor" | pnpm dlx vercel env add "$nome" production --force --yes >/dev/null
    echo "cadastrada: $nome"
  done < ../../.env.vercel-producao
)
cd apps/web && pnpm dlx vercel env ls production && cd ../..
```

**Saída esperada:** `cadastrada:` para as 11 variáveis (`DATABASE_URL`, `PHONE_ENC_KEY`, `WA_ID_PEPPER`,
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `RESTAURANT_ID`, `LOG_LEVEL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_LIMITE_UPLOAD_MB`), todas em
Production. **Nunca** cadastre `SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_ACCESS_TOKEN` ou `OPENROUTER_*` na Vercel.
Se a sua versão da CLI não aceitar `--force`, remova antes com `vercel env rm <NOME> production --yes`.

Deploy de produção (as `NEXT_PUBLIC_*` são embutidas **no build** — por isso vêm antes):

```bash
cd apps/web && pnpm dlx vercel deploy --prod && cd ../..
```

**Saída esperada:** URL de produção e status Ready. Se o domínio é próprio, 🔑 o humano o associa em
Settings → Domains. Mudou uma `NEXT_PUBLIC_*` depois? Faça **novo deploy** (o valor antigo fica no build).
**Se falhar:** build quebrou → `vercel inspect --logs <url>`; erro "Variáveis de ambiente inválidas" nos logs de
função → rode o passo 7 e corrija a variável apontada.

## Passo 6 — OpenRouter 🔑

🔑 **Peça ao humano** (openrouter.ai, conta da empresa):

1. **Settings → Privacy:** ZDR (Zero Data Retention) obrigatório e sem treinar com os dados; ou um **Guardrail**
   com ZDR obrigatório, `limit_usd` mensal e `reset_interval: monthly`, aplicado à chave abaixo.
2. **Credits:** pôr **~US$ 10**.
3. **Keys → Create key** de produção com **limite mensal** (ex.: US$ 10); colar **direto** no `.env.worker-producao`
   como `OPENROUTER_API_KEY=sk-or-v1-…`.

Complete o worker e rode o **smoke test** (uma chamada mínima por modelo, com ZDR e saída estruturada):

```bash
printf 'AI_TRIAGE_MODELS=mistralai/mistral-nemo,mistralai/mistral-small-3.2-24b-instruct\nAI_INGEST_MODELS=google/gemini-3.1-flash-lite,openai/gpt-4.1-mini\n' >> .env.worker-producao
(
  set -a; . ./.env.worker-producao; set +a
  for m in mistralai/mistral-nemo mistralai/mistral-small-3.2-24b-instruct google/gemini-3.1-flash-lite openai/gpt-4.1-mini; do
    curl -s https://openrouter.ai/api/v1/chat/completions \
      -H @<(printf 'Authorization: Bearer %s\n' "$OPENROUTER_API_KEY") -H 'content-type: application/json' \
      -d "{\"model\":\"$m\",\"messages\":[{\"role\":\"user\",\"content\":\"Responda ok=true.\"}],\"max_tokens\":50,\"reasoning\":{\"enabled\":false},
           \"provider\":{\"data_collection\":\"deny\",\"zdr\":true},
           \"response_format\":{\"type\":\"json_schema\",\"json_schema\":{\"name\":\"t\",\"strict\":true,\"schema\":{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}},\"required\":[\"ok\"],\"additionalProperties\":false}}}}" \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sys.argv[1], d.get("provider"), (d.get("choices") or [{}])[0].get("message",{}).get("content"), d.get("error",{}).get("message",""))' "$m"
  done
)
```

**Saída esperada:** para cada modelo, o provedor e `{"ok":true}` (ou `{"ok": true}`). **Se falhar:** "No endpoints
found matching your data policy" → a conta/Guardrail ou o modelo não tem ZDR: troque o modelo por outro da lista
(seção Modelos) e registre; conteúdo vazio/cortado no Gemini → inverta a ordem em `AI_INGEST_MODELS`; 401/402 →
🔑 chave ou crédito.

## Passo 7 — Conferência antes do worker

Complete o worker com as variáveis do Storage (copiadas do bootstrap, sem imprimir) e rode o script completo:

```bash
( umask 077; . ./.env.production-bootstrap; printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_URL" "$SUPABASE_SERVICE_ROLE_KEY" >> .env.worker-producao )
scripts/producao/verificar.sh --bootstrap .env.production-bootstrap --vercel .env.vercel-producao \
  --worker .env.worker-producao --dominio https://<domínio>
```

**Saída esperada:** só `OK` (e `AVISO` apenas se você usou outra porta de propósito) e `Resultado: 0 falha(s)`;
código de saída 0. O script confere: arquivos `600` e fora do git; variáveis obrigatórias e proibidas por destino;
chaves de 32 bytes iguais nos dois destinos; `NEXT_PUBLIC_LIMITE_UPLOAD_MB=4`; ausência de `OPENROUTER_DEV_SEM_ZDR`;
login real como `web_app`/`worker_app`; Postgres 17; 33 migrations; buckets privados; roles com login; restaurante,
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
  Basta Docker + Compose v2 e o diretório `/opt/atendimento` do usuário de deploy (🔑 se precisar de `sudo`).

Copie os arquivos (o `.env` vai com permissão 600):

```bash
ssh <usuario>@<host> 'install -d -m 750 /opt/atendimento'
scp apps/worker/docker-compose.prod.yml <usuario>@<host>:/opt/atendimento/docker-compose.prod.yml
scp .env.worker-producao <usuario>@<host>:/opt/atendimento/.env
ssh <usuario>@<host> 'chmod 600 /opt/atendimento/.env && ls -l /opt/atendimento'
```

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
  && docker compose --env-file .deploy.env -f docker-compose.prod.yml logs --since 2m worker | grep -c "worker iniciado"'
```

**Saída esperada:** serviço `worker` `running` e contagem ≥ 1. **Se falhar:** `Variáveis de ambiente inválidas ou
ausentes: X` → corrija `X` no `.env` do VPS (e no `.env.worker-producao`), `up -d` de novo; `OPENROUTER_DEV_SEM_ZDR`
na mensagem → apague a linha; erro de conexão ao banco → confira a porta 5432 (pooler session) e se o VPS sai para a internet.
O worker **não** abre porta.

## Passo 9 — Checklist final (com evidência)

Rode e anote cada item. 🔑 O humano faz os itens de navegador (ou acompanha você, se você tiver navegador).

| # | Item | Como | Evidência a anotar |
|---|---|---|---|
| 1 | Script verde | `scripts/producao/verificar.sh --bootstrap .env.production-bootstrap --vercel .env.vercel-producao --worker .env.worker-producao --dominio https://<domínio>` | última linha `Resultado: 0 falha(s)` |
| 2 | Login com TOTP | 🔑 dono abre o convite, define senha (≥ 12), cadastra o autenticador e entra | "dono entrou com TOTP" |
| 3 | IA Online | Início mostra **IA: Online** (heartbeat do worker) | print ou texto do cartão |
| 4 | Simulador S1–S4 | botão "Abrir simulador de WhatsApp" do painel: "que horas abre a Asa Sul hoje?" (S1), "vou chegar às 20h com 4 pessoas" (S2), "quero fazer um aniversário para 30 pessoas" (S3), "quanto custa a picanha?" (S4) | uma linha por serviço: pergunta → resumo da resposta |
| 5 | Handoff em tempo real | no simulador: "quero falar com um atendente"; com Conversas aberta em outra aba, a conversa aparece **sem recarregar** | "apareceu em N s sem recarregar" |
| 6 | Importar CSV | Conteúdo → Cardápio → sub-aba Importar → CSV pequeno (2 itens) → revisar → aprovar | itens novos visíveis no cardápio |
| 7 | Gerente restrito | ver abaixo | gerente vê só a unidade dele em Unidades/Agenda/Conversas |
| 8 | Gastos | Início → Gastos mostra o gasto de IA do dia (> US$ 0 após o item 4) | valor exibido |

Gerente restrito (o painel ainda não convida equipe; isso vem na Etapa 08): 🔑 o humano convida o e-mail em
Authentication → Users → **Invite user**; depois você vincula, com a conexão de administrador:

```bash
( set -a; . ./.env.production-bootstrap; set +a
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v email='<email-do-gerente>' -v nome='Gerente Asa Sul' <<'SQL'
insert into staff (user_id, restaurant_id, nome, papel, unidades_permitidas)
select u.id, r.id, :'nome', 'gerente', array[(select id from units where slug = 'asa-sul')]
from auth.users u cross join restaurants r where lower(u.email) = lower(:'email')
on conflict (user_id) do nothing;
SQL
)
```

Saída esperada: `INSERT 0 1`. O gerente entra (convite + TOTP) e só enxerga a Asa Sul.

**Mensagem de "pronto" para devolver ao humano** (preencha; sem segredos):

```
Amostra publicada.
- Painel: https://<domínio> (Vercel, região gru1, deploy <id/URL do deploy>)
- Supabase: projeto <ref> em sa-east-1, Postgres <versão>, 33 migrations, buckets privados
- Worker: VPS <host>, imagem <tag>, status running, "worker iniciado" às <hora>
- Modelos: triagem mistral-nemo → mistral-small-3.2; cardápio gemini-3.1-flash-lite → gpt-4.1-mini (smoke test: <resultado>)
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
  da Vercel, rollback, upload acima de ~4,5 MB por URL assinada, `secure_password_change`, Sentry, domínio definitivo,
  convite de equipe pelo painel (Etapa 08).
- Upload: na amostra o limite é **4 MB** por arquivo (corpo da Vercel); acima disso o painel recusa com mensagem.
