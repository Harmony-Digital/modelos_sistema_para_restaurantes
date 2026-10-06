#!/usr/bin/env bash
# Verificação da amostra em produção (docs/runbooks/producao-amostra.md). SÓ LEITURA.
# Nunca imprime valores de variáveis: só nomes, OK/FALHA/AVISO e contagens.
#
# Uso (da raiz do repositório):
#   scripts/producao/verificar.sh --bootstrap .env.production-bootstrap \
#     [--vercel <arquivo com as variáveis da Vercel>] [--worker <cópia do .env do worker>] \
#     [--dominio https://<domínio>]
#
# Código de saída: 0 se nenhum item falhou; 1 se algum falhou; 2 se o uso estiver errado.
# Precisa de: bash, curl, base64 e psql (ou docker, que roda o psql da imagem postgres:17-alpine).
set -uo pipefail

BOOTSTRAP='' VERCEL='' WORKER='' DOMINIO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --bootstrap) BOOTSTRAP="${2:-}"; shift 2 ;;
    --vercel) VERCEL="${2:-}"; shift 2 ;;
    --worker) WORKER="${2:-}"; shift 2 ;;
    --dominio) DOMINIO="${2%/}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "argumento desconhecido: $1 (veja --help)" >&2; exit 2 ;;
  esac
done
[ -n "$BOOTSTRAP" ] || { echo "informe --bootstrap <arquivo> (veja --help)" >&2; exit 2; }

RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
JOURNAL="$RAIZ/packages/db/migrations/meta/_journal.json"
FALHAS=0

ok() { printf 'OK     %s\n' "$1"; }
falha() { printf 'FALHA  %s%s\n' "$1" "${2:+ — $2}"; FALHAS=$((FALHAS + 1)); }
aviso() { printf 'AVISO  %s%s\n' "$1" "${2:+ — $2}"; }
secao() { printf '\n== %s ==\n' "$1"; }

# Lê NOME=valor de um arquivo de env SEM executá-lo (última ocorrência; tira aspas e \r).
ler() {
  local arq="$1" nome="$2" v
  v="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${nome}=" "$arq" 2>/dev/null | tail -n1 | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${nome}=//" | tr -d '\r')"
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}

psql_q() { # psql_q <url> <sql> — saída sem cabeçalho; erro do psql vai para /dev/null (pode conter a URL)
  local url="$1" sql="$2"
  if command -v psql >/dev/null 2>&1; then
    PGCONNECT_TIMEOUT=15 psql "$url" -XAtq -v ON_ERROR_STOP=1 -c "$sql" 2>/dev/null
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm --network host -e PGCONNECT_TIMEOUT=15 -e URL="$url" postgres:17-alpine \
      sh -c 'psql "$URL" -XAtq -v ON_ERROR_STOP=1 -c "$0"' "$sql" 2>/dev/null
  else
    return 127
  fi
}

host_de() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#^[^@]*@##; s#[/?].*$##'; }
usuario_de() { printf '%s' "$1" | sed -E 's#^[a-z]+://##; s#@.*$##; s#:.*$##'; }
porta_de() { local h; h="$(host_de "$1")"; case "$h" in *:*) printf '%s' "${h##*:}" ;; *) printf '5432' ;; esac; }
bytes_b64() { printf '%s' "$1" | base64 -d 2>/dev/null | wc -c | tr -d ' '; }

exigir() { # exigir <arquivo> <rótulo> NOME...
  local arq="$1" rot="$2"; shift 2
  local faltam=()
  for n in "$@"; do [ -n "$(ler "$arq" "$n")" ] || faltam+=("$n"); done
  if [ ${#faltam[@]} -eq 0 ]; then ok "$rot: $# variáveis obrigatórias presentes"
  else falha "$rot: faltam ${faltam[*]}" "veja a tabela de variáveis do runbook"; fi
}

proibir() { # proibir <arquivo> <rótulo> NOME... (presente e não vazio = falha)
  local arq="$1" rot="$2"; shift 2
  local achou=()
  for n in "$@"; do [ -n "$(ler "$arq" "$n")" ] && achou+=("$n"); done
  if [ ${#achou[@]} -eq 0 ]; then ok "$rot: nenhuma variável proibida"
  else falha "$rot: não deveria ter ${achou[*]}" "remova (segredo do servidor ou chave de desenvolvimento)"; fi
}

chave32() { # chave32 <arquivo> <rótulo> NOME
  local v; v="$(ler "$1" "$3")"
  [ -n "$v" ] || return 0
  if [ "$(bytes_b64 "$v")" = 32 ]; then ok "$2: $3 tem 32 bytes em base64"
  else falha "$2: $3 não tem 32 bytes em base64" "gere com: openssl rand -base64 32"; fi
}

# ---------------------------------------------------------------- arquivos
secao 'Arquivos de env'
for par in "bootstrap:$BOOTSTRAP" "vercel:$VERCEL" "worker:$WORKER"; do
  rot="${par%%:*}"; arq="${par#*:}"
  [ -n "$arq" ] || { aviso "$rot: arquivo não informado; itens dele pulados"; continue; }
  if [ ! -f "$arq" ]; then falha "$rot: arquivo $arq não existe"; continue; fi
  perm="$(stat -c '%a' "$arq" 2>/dev/null || stat -f '%Lp' "$arq")"
  if [ "$perm" = 600 ] || [ "$perm" = 400 ]; then ok "$rot: $arq com permissão $perm"
  else falha "$rot: $arq com permissão $perm" "chmod 600 $arq"; fi
  if git -C "$RAIZ" ls-files --error-unmatch "$arq" >/dev/null 2>&1; then
    falha "$rot: $arq está versionado no git" "remova do índice e troque TODOS os segredos dele"
  fi
done
[ -f "$BOOTSTRAP" ] || { printf '\nResultado: %d falha(s)\n' "$FALHAS"; exit 1; }

# ---------------------------------------------------------------- variáveis
secao 'Variáveis por destino'
exigir "$BOOTSTRAP" bootstrap SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL
ADMIN_URL="$(ler "$BOOTSTRAP" DATABASE_URL)"
SUPA_URL="$(ler "$BOOTSTRAP" SUPABASE_URL)"
SUPA_URL="${SUPA_URL%/}"

WEB_VARS=(DATABASE_URL PHONE_ENC_KEY WA_ID_PEPPER WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_PHONE_NUMBER_ID
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY RESTAURANT_ID NEXT_PUBLIC_LIMITE_UPLOAD_MB)
WORKER_VARS=(DATABASE_URL PHONE_ENC_KEY WA_ID_PEPPER WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_PHONE_NUMBER_ID
  WHATSAPP_ACCESS_TOKEN OPENROUTER_API_KEY AI_TRIAGE_MODELS AI_INGEST_MODELS SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RESTAURANT_ID)

if [ -f "$VERCEL" ]; then
  exigir "$VERCEL" vercel "${WEB_VARS[@]}"
  proibir "$VERCEL" vercel SUPABASE_SERVICE_ROLE_KEY WHATSAPP_ACCESS_TOKEN OPENROUTER_API_KEY OPENROUTER_DEV_SEM_ZDR OPENROUTER_BASE_URL
  chave32 "$VERCEL" vercel PHONE_ENC_KEY; chave32 "$VERCEL" vercel WA_ID_PEPPER
  lim="$(ler "$VERCEL" NEXT_PUBLIC_LIMITE_UPLOAD_MB)"
  if [ "$lim" = 4 ]; then ok 'vercel: NEXT_PUBLIC_LIMITE_UPLOAD_MB = 4'
  else falha "vercel: NEXT_PUBLIC_LIMITE_UPLOAD_MB deve ser 4 (está '${lim:-vazio}')" 'corpo da Vercel é limitado a ~4,5 MB; refaça o build depois de corrigir'; fi
  [ "$(ler "$VERCEL" NEXT_PUBLIC_SUPABASE_URL | sed 's#/$##')" = "$SUPA_URL" ] \
    && ok 'vercel: NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL do bootstrap' \
    || falha 'vercel: NEXT_PUBLIC_SUPABASE_URL difere do SUPABASE_URL do bootstrap' 'mesmo projeto Supabase nos três destinos'
fi

if [ -f "$WORKER" ]; then
  exigir "$WORKER" worker "${WORKER_VARS[@]}"
  proibir "$WORKER" worker OPENROUTER_BASE_URL
  zdr="$(ler "$WORKER" OPENROUTER_DEV_SEM_ZDR)"
  if [ -z "$zdr" ] || [ "$zdr" = 0 ]; then ok 'worker: OPENROUTER_DEV_SEM_ZDR ausente (ZDR exigido)'
  else falha 'worker: OPENROUTER_DEV_SEM_ZDR presente' 'apague a linha: o worker recusa subir em produção com ela'; fi
  chave32 "$WORKER" worker PHONE_ENC_KEY; chave32 "$WORKER" worker WA_ID_PEPPER
  [ "$(ler "$WORKER" SUPABASE_URL | sed 's#/$##')" = "$SUPA_URL" ] \
    && ok 'worker: SUPABASE_URL = SUPABASE_URL do bootstrap' \
    || falha 'worker: SUPABASE_URL difere do SUPABASE_URL do bootstrap' 'mesmo projeto Supabase nos três destinos'
fi

if [ -f "$VERCEL" ] && [ -f "$WORKER" ]; then
  for n in PHONE_ENC_KEY WA_ID_PEPPER WHATSAPP_APP_SECRET WHATSAPP_VERIFY_TOKEN WHATSAPP_PHONE_NUMBER_ID RESTAURANT_ID; do
    if [ "$(ler "$VERCEL" "$n")" = "$(ler "$WORKER" "$n")" ]; then ok "vercel e worker: $n igual nos dois"
    else falha "vercel e worker: $n diferente" 'o mesmo valor nos dois destinos (as chaves de cifra precisam ser idênticas)'; fi
  done
fi

conferir_url() { # conferir_url <arquivo> <rótulo> <role> <porta esperada>
  local url user porta
  url="$(ler "$1" DATABASE_URL)"; [ -n "$url" ] || return 0
  user="$(usuario_de "$url")"; porta="$(porta_de "$url")"
  case "$user" in "$3"|"$3".*) ok "$2: DATABASE_URL usa o role $3" ;;
    *) falha "$2: DATABASE_URL não usa o role $3" "use $3.<project_ref> no pooler" ;; esac
  [ "$porta" = "$4" ] && ok "$2: DATABASE_URL na porta $4" \
    || aviso "$2: DATABASE_URL na porta $porta (esperada $4 do pooler)" 'confira o modo do pooler na tabela do runbook'
  local quem
  quem="$(psql_q "$url" 'select current_user')"
  [ "$quem" = "$3" ] && ok "$2: conexão com DATABASE_URL entra como $3" \
    || falha "$2: não conectou como $3 com a DATABASE_URL" 'senha do role (passo 3), URL-encode da senha, host/porta do pooler'
}
[ -f "$VERCEL" ] && conferir_url "$VERCEL" vercel web_app 6543
[ -f "$WORKER" ] && conferir_url "$WORKER" worker worker_app 5432

# ---------------------------------------------------------------- banco
secao 'Banco (conexão de administrador do bootstrap)'
if ! command -v psql >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
  falha 'nem psql nem docker disponíveis' 'instale o cliente do PostgreSQL (psql)'
elif [ -z "$ADMIN_URL" ]; then
  falha 'DATABASE_URL do bootstrap vazia'
else
  ver="$(psql_q "$ADMIN_URL" 'show server_version_num')"
  if [ -z "$ver" ]; then
    falha 'não conectou com a DATABASE_URL do bootstrap' 'use a conexão direta de administrador (usuário postgres) do painel Connect'
  else
    [ "$ver" -ge 170000 ] && ok "Postgres ${ver:0:2} (exigido 17+)" || falha "Postgres ${ver:0:2}" 'crie o projeto em Postgres 17 (a migration 0014 depende dele)'

    esperadas="$(grep -c '"tag"' "$JOURNAL")"
    ultima="$(grep -o '"tag": *"[^"]*"' "$JOURNAL" | tail -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
    aplicadas="$(psql_q "$ADMIN_URL" 'select count(*) from drizzle.__drizzle_migrations')"
    [ "$aplicadas" = "$esperadas" ] && ok "migrations aplicadas: $aplicadas de $esperadas (até $ultima)" \
      || falha "migrations aplicadas: ${aplicadas:-nenhuma} de $esperadas" 'rode o passo 2 (pnpm db:migrate com a conexão de administrador)'

    for b in cardapio importacoes; do
      pub="$(psql_q "$ADMIN_URL" "select public from storage.buckets where id = '$b'")"
      case "$pub" in f) ok "bucket $b existe e é privado" ;;
        t) falha "bucket $b é PÚBLICO" 'Storage → bucket → desmarcar "Public bucket"' ;;
        *) falha "bucket $b não existe" 'a migration 0027 cria os buckets; confira o passo 2' ;; esac
    done

    for r in web_app worker_app; do
      login="$(psql_q "$ADMIN_URL" "select rolcanlogin from pg_roles where rolname = '$r'")"
      [ "$login" = t ] && ok "role $r existe com login" || falha "role $r ausente ou sem login" 'rode as migrations (passo 2)'
    done

    n_rest="$(psql_q "$ADMIN_URL" 'select count(*) from restaurants')"
    [ "$n_rest" = 1 ] && ok 'um restaurante cadastrado' || falha "restaurantes cadastrados: ${n_rest:-?} (esperado 1)" 'passo 4 (bootstrap:prod)'
    n_dono="$(psql_q "$ADMIN_URL" "select count(*) from staff where papel = 'dono'")"
    [ "${n_dono:-0}" -ge 1 ] 2>/dev/null && ok "dono cadastrado ($n_dono)" || falha 'nenhum dono cadastrado' 'passo 4 (bootstrap:prod com --dono)'
    n_lim="$(psql_q "$ADMIN_URL" 'select count(*) from budget_limits')"
    [ "${n_lim:-0}" -ge 1 ] 2>/dev/null && ok "limites de gasto cadastrados ($n_lim)" || falha 'nenhum limite de gasto (budget_limits)' 'o bootstrap:prod cria os limites padrão; rode-o de novo'
    n_un="$(psql_q "$ADMIN_URL" 'select count(*) from units')"
    n_it="$(psql_q "$ADMIN_URL" 'select count(*) from menu_items')"
    n_fa="$(psql_q "$ADMIN_URL" 'select count(*) from knowledge_facts')"
    if [ "${n_un:-0}" -ge 1 ] 2>/dev/null && [ "${n_it:-0}" -ge 1 ] 2>/dev/null && [ "${n_fa:-0}" -ge 1 ] 2>/dev/null; then
      ok "dados de demonstração: $n_un unidades, $n_it itens de cardápio, $n_fa informações"
    else falha "dados de demonstração incompletos (unidades ${n_un:-?}, itens ${n_it:-?}, informações ${n_fa:-?})" 'passo 4 (demo:s1:prod)'; fi

    rid="$(psql_q "$ADMIN_URL" 'select id from restaurants limit 1')"
    for par in "vercel:$VERCEL" "worker:$WORKER"; do
      rot="${par%%:*}"; arq="${par#*:}"
      [ -f "$arq" ] || continue
      [ -n "$rid" ] && [ "$(ler "$arq" RESTAURANT_ID)" = "$rid" ] && ok "$rot: RESTAURANT_ID = id do restaurante no banco" \
        || falha "$rot: RESTAURANT_ID difere do restaurante no banco" 'use o id impresso pelo bootstrap:prod'
    done
  fi
fi

# ---------------------------------------------------------------- Supabase (APIs públicas)
secao 'Supabase (Auth e Data API)'
PUB=''
[ -f "$VERCEL" ] && PUB="$(ler "$VERCEL" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"
if [ -z "$PUB" ]; then
  aviso 'sem NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (--vercel); itens de Auth/Data API pulados'
else
  cfg="$(curl -s --max-time 15 "$SUPA_URL/auth/v1/settings" -H "apikey: $PUB")"
  if printf '%s' "$cfg" | grep -q '"disable_signup": *true'; then ok 'Auth: cadastro público desligado'
  elif [ -z "$cfg" ]; then falha 'Auth: sem resposta de /auth/v1/settings' 'confira SUPABASE_URL e a chave publishable'
  else falha 'Auth: cadastro público LIGADO' 'Authentication → Sign In / Providers → "Allow new users to sign up" = off'; fi
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SUPA_URL/rest/v1/restaurants?select=id&limit=1" -H "apikey: $PUB")"
  [ "$st" != 200 ] && ok "Data API não expõe o schema public (HTTP $st)" \
    || falha 'Data API expõe o schema public (HTTP 200)' 'Project Settings → Data API → Exposed schemas vazio'
fi
SRV=''
[ -f "$WORKER" ] && SRV="$(ler "$WORKER" SUPABASE_SERVICE_ROLE_KEY)"
if [ -n "$SRV" ]; then
  # mesmos cabeçalhos do worker (apps/worker/src/storage.ts): sb_secret_ só no apikey.
  # Cabeçalhos por arquivo (-H @): a chave não aparece na linha de comando (ps).
  if [ "${SRV#sb_secret_}" != "$SRV" ]; then cab="$(printf 'apikey: %s' "$SRV")"
  else cab="$(printf 'apikey: %s\nAuthorization: Bearer %s' "$SRV" "$SRV")"; fi
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SUPA_URL/storage/v1/bucket/cardapio" -H @<(printf '%s\n' "$cab"))"
  [ "$st" = 200 ] && ok 'worker: chave de serviço lê o Storage (bucket cardapio)' \
    || falha "worker: chave de serviço não lê o Storage (HTTP ${st:-sem resposta})" 'confira SUPABASE_SERVICE_ROLE_KEY (secret key do projeto certo)'
fi

# ---------------------------------------------------------------- domínio
secao 'Painel (domínio)'
if [ -z "$DOMINIO" ]; then
  aviso 'sem --dominio; checagem do painel pulada'
else
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$DOMINIO/login")"
  [ "$st" = 200 ] && ok "GET $DOMINIO/login → 200" || falha "GET $DOMINIO/login → ${st:-sem resposta}" 'veja Deployments/Logs na Vercel'
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$DOMINIO/api/whatsapp/webhook" -H 'content-type: application/json' -d '{}')"
  [ "$st" = 401 ] || [ "$st" = 403 ] && ok "webhook recusa POST sem assinatura (HTTP $st)" \
    || falha "webhook respondeu $st a um POST sem assinatura (esperado 401/403)" 'confira as variáveis WHATSAPP_* na Vercel'
fi

printf '\nResultado: %d falha(s)\n' "$FALHAS"
[ "$FALHAS" -eq 0 ]
