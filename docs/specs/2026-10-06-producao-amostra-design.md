# Testes mais rápidos + amostra em produção

> Spec aprovada em conversa em 06/10/2026. Objetivo do dono: deixar pronto para publicar uma **amostra** do produto (Etapas 01–06) para apresentar ao cliente, **só pelo painel e simulador**, num **único ambiente de produção**. O resto (Etapas 07–09, número oficial da Meta, staging) continua depois. PRD §10 vence conflitos. **Código só depois do merge do PR #8 na `main`.**

## 1. Critério de sucesso
- `pnpm check` local em ~2 min (hoje ~5 min; picos bem maiores), **sem remover nem afrouxar testes**.
- Um runbook curto permite a alguém publicar a amostra (Supabase + Vercel + worker no VPS + OpenRouter) e o cliente usar painel, simulador, cardápio, eventos, avisos e inbox em produção.
- Nada sai pela Meta; nenhum segredo no repositório; invariantes de LGPD/segurança intactos (ZDR obrigatório em produção).

## 2. Parte A — testes
1. **Banco por processo de teste:** um *global setup* do vitest (projeto `db`) migra uma vez um banco modelo `atd_test_template` no Postgres local e, para cada worker do vitest, clona `atd_test_<n>` com `CREATE DATABASE … TEMPLATE atd_test_template`; `getTestDb()` usa o banco do worker (`VITEST_POOL_ID`). Projeto `db` passa a rodar com paralelismo (padrão 4, ajustável por env). Sem mudança nos testes em si.
2. **Reset mais barato:** substituir `TRUNCATE … RESTART IDENTITY CASCADE` de todas as tabelas por uma limpeza medida (ex.: `TRUNCATE` único sem `RESTART IDENTITY`, ou `DELETE` em ordem de dependência), escolhendo pelo tempo medido; investigar a lentidão vista em 06/10 (TRUNCATE de ~4 s).
3. **Cache:** `fsModuleCache` do vitest (conferir a opção na doc atual) e cache do Turbo conferido.
4. **CI** no mesmo esquema; timeout revisto.
5. Pré-condição: Postgres local do `supabase start` (a role `postgres` pode criar bancos). Os testes que dependem de `auth.users`/Storage continuam funcionando no banco clonado (o clone leva os schemas `auth`, `storage`, `realtime`, `pgboss`).

## 3. Parte B — amostra em produção (só simulador, um ambiente)
1. **Sem WhatsApp, sem código novo:** as variáveis da Meta recebem valores aleatórios (`WHATSAPP_APP_SECRET`/`VERIFY_TOKEN` gerados, `WHATSAPP_PHONE_NUMBER_ID=0`, token inválido no worker). O webhook só aceita HMAC válido, então nada entra; conversas simuladas nunca chamam a Meta. Documentado no runbook.
2. **Upload na Vercel:** quando rodar na Vercel (`VERCEL=1`), o limite de arquivo (cardápio e importação) cai para **4 MB** com mensagem clara ("Arquivo acima de 4 MB. Envie um PDF menor ou uma foto."); local continua 20 MB. URL assinada fica para a Etapa 09.
3. **Dados de demonstração em produção:** o `demo:s1` (restaurante, unidades, horários, cardápio, espaços, horário humano, respostas rápidas) roda contra produção por arquivo de env dedicado (`.env.production-bootstrap`, fora do git), idempotente, sem nunca ler o `.env` local — mesmo padrão do bootstrap.
4. **IA:** produção exige ZDR (a chave de dev sem ZDR é recusada pelo worker em produção). Escolher e documentar, consultando os endpoints do OpenRouter, um modelo barato de triagem **com provedor ZDR** e um de leitura de cardápio por imagem/PDF; o dono põe crédito (~US$ 10) e a chave tem `limit` mensal + Guardrail com ZDR.
5. **Runbook `docs/runbooks/producao-amostra.md`** (curto, passo a passo): Supabase (sa-east-1, **Postgres 17**, Auth sem cadastro público + TOTP, Data API sem schemas expostos, Realtime: canais privados autorizados por RLS, buckets privados da 0027 conferidos), migrations 0000–0032, senhas dos roles, bootstrap + demo, Vercel (Root `apps/web`, `gru1`, variáveis), worker no VPS (workflow existente, `.env` com `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/modelos), OpenRouter, checklist final (login com TOTP, IA Online, simulador responde S1–S4, inbox em tempo real, importação CSV). Meta, staging e itens de go-live ficam apontados para `deploy.md`/Etapa 09.
6. **Verificação local de produção:** `docker build` da imagem do worker; `pnpm build`; ensaio do worker com `NODE_ENV=production` e variáveis de demonstração (sobe, recusa a chave sem ZDR); `pnpm check` + e2e.
7. **Registros:** PLAN ("Amostra em produção" com evidência), "Onde paramos", `.env.example` revisado.

## 4. Fora
Número oficial e webhook da Meta, staging, CSP com nonce, revisão jurídica, teste de carga, upload por URL assinada, áudio — Etapa 09/Melhorias futuras.
