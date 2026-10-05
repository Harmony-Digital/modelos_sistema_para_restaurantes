# Etapa 01 — registro de execução (ledger do SDD)

> Cópia versionada do ledger usado na execução por subagentes (05/10/2026). Contém a varredura prévia do plano, cada revisão, cada decisão (`Ruling:`) com seu custo se estiver errada, os itens menores adiados e as pendências manuais. Fonte para triagem nas próximas etapas.

# SDD ledger — plan: docs/plans/etapa-01-fundacao.md
Spec: PRD.md (raiz). Branch: etapa-01-fundacao (base 683bf9c).

## Pre-flight scan
| Par/Task | Produz → Consome | Achado |
|---|---|---|
| T1↔T2 tsconfig.base | T2 acrescenta allowImportingTsExtensions | ok (T1 não importa .ts) |
| T3↔T7↔T13 test-utils | T3 cria getTestDb/resetDb/seedRestaurant; T7 +createAuthUser/seedStaff e resetDb apaga auth.users; T13 +getTestBoss | ok, imports adicionados por cada task |
| T3↔T4↔T5↔T7 migrations | 0000 ext, 0001 base, 0002 conv, 0003 ops, 0004 security | nomes consistentes |
| T6↔T7 withRole/withUserContext | T7 usa ambos | ok |
| T7↔T13 pgboss schema | T7 cria schema pgboss (owner worker_app) + grant worker_app to postgres; T13 testes rodam pg-boss como postgres | ok se postgres herdar de worker_app (PG17 default inherit) |
| T8/T9/T10↔T12/T16 core | redactPii, prefilter, renderReply, periodStarts | assinaturas batem |
| T11↔T15/T16 whatsapp | parseWebhook, verifySignature, createWhatsAppClient/SendResult | ok |
| T12↔T16 ai | triage, LlmClient, JsonCallResult, TRIAGE_* | ok |
| T13↔T15↔T16 ingest/queue | ingestInbound, enqueueProcess, Enqueue(tx) | ok |
| T14↔T16↔T19 worker main/sentry | T16 edita main.ts; T19 move scrubEvent p/ core | ok, ordem correta |
| T15↔T19 route.ts | T19 troca console.warn por Sentry | ok |
| T17↔T18 StaffRole | T18 importa StaffRole de db/staff.ts (T17) | ok, ordem correta |
| Cada task: testes vs código | revisado na escrita do plano (self-review) | T16 fakeLlm tipagem já corrigida; T17 Suspense já corrigido; T7 sem FORCE RLS |

Ruling: executar numa branch `etapa-01-fundacao` no próprio checkout em vez de git worktree — Supabase local/Docker e .env ficam no diretório do projeto; branch isola o histórico igualmente — custo se errado: nenhum, merge é igual.
Ruling: implementers em `sonnet` (plano tem código completo, mas há atrito de ambiente: Docker, Supabase CLI, versões novas); revisores `sonnet`, e `opus` nas tasks de segurança/concorrência (7, 10, 13, 16) e na revisão final — custo se errado: tokens.

## Progress
Task 1: dispatched (base 683bf9c, agent ae3e9908d2a08af86)
Ruling: turbo injeta bloco 'agentGuidance' no AGENTS.md — desligar com "agentGuidance": false no turbo.json e reverter AGENTS.md (CLAUDE.md e AGENTS.md devem ser idênticos) — custo se errado: perder dica do turbo para agentes, irrelevante
Task 1: review — spec ✅, approved; minors (deferred): pnpm-workspace onlyBuiltDependencies pode virar allowBuilds no pnpm 11 (supabase binário funcionou, verificado); tseslint.config() deprecado; globs de apps inexistentes (ok nesta fase)
Task 1: fix round 1/5 (turbo agentGuidance; commits f9bd3c4..564c012) — re-review pendente
Task 1: complete (commits 683bf9c..564c012, review clean)
Task 2: dispatched (base 564c012, agent a3801d8de9ad21b0a, haiku)
Task 2: review — spec ✅, Needs fixes: Important `.env.example` SENTRY_DSN="" quebra z.url().optional(); trailer de commit errado (Haiku 4.5)
Task 2: minor (deferred): base64 da chave é leniente (Buffer.from aceita lixo/base64url) — endurecer com regex estrita; cobertura de testes de env fina (CSV vazio, regex de phone id/graph version, webEnvSchema)
Task 2: fix round 1/5 (2 addressed, 0 open; amend 89f8d36→bcbf374)
Task 2: complete (commits 564c012..bcbf374, review clean)
Task 3: dispatched (base bcbf374, sonnet)
Ruling: drizzle 0.45 encapsula erro do driver (mensagem/constraint ficam em err.cause) — testes das tasks seguintes que usam toThrow(/constraint|row-level security|permission denied/) devem verificar via err.cause (code/constraint_name/message), mantendo o caso de teste — custo se errado: só ajuste de asserção
Task 3: review — spec ✅ approved; trailer ok; .env ignorado (verificado)
Task 3: minor (deferred): pnpm-workspace tem allowBuilds esbuild E onlyBuiltDependencies (redundante) — pnpm 11 exigiu allowBuilds; limpar lista antiga no final
Task 3: complete (commits bcbf374..36456bb, review clean)
Task 4: dispatched (base 36456bb, sonnet)
Task 4: minor (deferred): FKs filhos não garantem mesmo restaurant_id do pai (composite FK/trigger futuro); messages.ai_run_id sem FK p/ ai_runs; status_envio texto livre
Task 4: complete (commits 36456bb..3b77dc8, review clean)
Task 5: dispatched (base 3b77dc8, sonnet)
Task 5: minor (deferred): CHECKs sem teste (non_negative, alerta_range, retention); falta índice por restaurant_id em ai_runs/spend_ledger (avaliar com RLS); retention_dias_positive aceita 0 (nome)
Task 5: complete (commits 3b77dc8..123cb85, review clean)
Task 6: dispatched (base 123cb85, sonnet)
Task 6: minor (deferred): teste de vazamento usa pool com >1 conexão (pode cair em outra conexão) — considerar max:1 ou teste com 2 chamadas sequenciais; withRole sem guarda em runtime; sub não validado como uuid
Task 6: complete (commits 123cb85..50140d5, review clean)
Task 7: dispatched (base 50140d5, sonnet; review opus)
Task 7: review (opus) — spec ✅; Needs fixes (plan-mandated, 4 Important): authenticated mantém TRUNCATE/TRIGGER/REFERENCES (TRUNCATE ignora RLS); service_role altera audit_log (I11); atendente reatribui conversa a cliente de outro tenant via UPDATE customer_id; worker_app sem SELECT em ai_runs (RETURNING/UPDATE falham)
Ruling: corrigir os 4 Important + minors 5 (self_insert exige ator_tipo='staff'), 6 (anon sem sequences/funções default), 8 (gerente não apaga DSR) e testes de 9, numa NOVA migration 0005/0006 (migration aplicada não se edita) — segurança de produção, custo baixo — custo se errado: mais uma migration
Ruling: integridade cross-tenant por grants de coluna (authenticated só atualiza colunas de estado) em vez de FKs compostas agora; FKs compostas (restaurant_id, id) ficam como minor diferido — grants fecham o vetor do painel; web/worker são código confiável — custo se errado: bug no código confiável pode misturar tenants (há 1 restaurante só)
Ruling: audit_log.restaurant_id passa a ON DELETE RESTRICT (apagar restaurante não pode apagar trilha de auditoria) — custo se errado: apagar restaurante exige purge explícito
Task 7: minor (deferred): pgboss default privileges dão select/insert/update a web_app (brief dizia insert/select — inconsistência do plano, mantido); FKs compostas restaurant_id
Task 7: fix round 1/5 (6 addressed, 1 open — anon mantém UPDATE em sequences (setval); commits f8e6c2c..3cf903f)
Ruling: incluir na rodada 2 o achado out-of-scope Important (authenticated com UPDATE/setval em sequences) e revogar TRIGGER/REFERENCES de service_role em audit_log — mesma classe, custo baixo — custo se errado: nenhum
Task 7: fix round 2/5 (3 addressed, 0 open; commits 3cf903f..4e51dec)
Task 7: minor (deferred): verificar default ACL global (sem namespace) de postgres p/ sequences ainda dando anon rwU; defaults do schema storage/supabase_admin ainda dão anon; service_role mantém MAINTAIN em audit_log (não apaga)
Task 7: complete (commits 50140d5..4e51dec, review clean após 2 rodadas)
Task 8: dispatched (base 4e51dec, haiku)
Ruling: implementers haiku ignoram o trailer exigido (usam o próprio modelo) mesmo com contrato explícito — daqui em diante implementers em sonnet; trailers errados já gravados são corrigidos por amend na rodada de correção da task — custo se errado: tokens
Task 8: review — Needs fixes (plan-mandated): telefone 13 dígitos 55DDD… não mascarado (quebra I8); formas espaçadas (61 9 9999-8888, 99999 8888, CPF com espaços) passam; GCM aceita tag truncada (sem authTagLength)
Ruling: corrigir 1–3 + RG formatado (é PII) + minors baratos do mesmo arquivo (separador consumido pelo cartão; e-mail com acento); CNPJ/0800 não são PII de pessoa física → gap aceito e documentado no código — custo se errado: falso positivo em número de pedido de 9 dígitos começando com 9
Ruling: rodada 1 da Task 8 com implementer novo em sonnet (o original haiku erra o trailer), carregando brief+report+achados; corrigir trailer por amend
Task 8: fix round 1/5 (6 addressed, 0 open; amend b96020b→e39ce1f)
Task 8: minor (deferred): fixo 8 dígitos sem DDD (3333-4444) não mascarado; over-mask cosmético '12 34 5678 9012'; normalizeWaId não canoniza 9º dígito; pepper sem tamanho mínimo; keyFromBase64 leniente
Task 8: complete (commits 4e51dec..e39ce1f, review clean)
Task 9: dispatched (base e39ce1f, sonnet)
Task 9: review — spec ✅ Approved, mas 4 Important plan-mandated: handoff em qualquer menção a atendente/humano (elogio, pergunta); LGPD exclusão com janela frouxa ('remover a cebola dos dados'); negação de handoff frágil; falsos negativos LGPD
Ruling: corrigir os 4 (handoff exige intenção de falar/chamar ou mensagem só com a palavra; LGPD ancorado em 'meus dados'/'dados pessoais'/'sobre mim'/'cadastro'; negação só imediatamente antes; variantes de exclusão) + gerente/a e dono — custo de produto alto e correção barata; triagem LLM mapeia lgpd→handoff como rede de segurança — custo se errado: algum pedido indireto vai para a triagem em vez do atalho
Task 9: fix round 1/5 (4 addressed, 2 new Important — 'cancel…meus dados' dispara LGPD; 'quero alguém/uma pessoa pra…' dispara handoff; commits 4b2da1f..fc4695f)
Task 9: fix round 2/5 (3 addressed, 0 open; commits fc4695f..339de6f)
Task 9: minor (deferred): 'quero cancelar todos os meus dados' não pega (janela do cancel =1 palavra); 'queria uma pessoa' sem 'falar com' não faz handoff (trade-off); 'quero apagar meu histórico' não pega — triagem LLM é rede de segurança
Task 9: complete (commits e39ce1f..339de6f, review clean após 2 rodadas)
Task 10: dispatched (base 339de6f, sonnet; review opus)
Task 10: review (opus) — spec ✅; Needs fixes (plan-mandated, Important): settle/release não idempotentes + greatest() esconde over-release (dupla liquidação fura o teto, quebra I6); valores negativos/zero/malformados passam pelo gate
Ruling: Reservation ganha reservationId = id da linha 'reserva' no spend_ledger; spend_ledger ganha coluna reserva_id + índice único parcial (reserva_id) where tipo in ('liquidacao','estorno') → 2ª liquidação/estorno vira no-op (ledger segue append-only); remover greatest(); validar valores em TS (decimal ≤6 casas; reserva >0, liquidação >=0) + CHECK valor_usd >= 0; grant select em spend_ledger para worker_app (RETURNING/ON CONFLICT) — custo se errado: uma migration e uma coluna a mais
Task 10: minor (deferred): liquidação acima da estimativa pode passar do teto (inevitável; Task 16 deve logar actual > estimativa); teste concorrente só checa contador 'dia'
Task 10: fix round 1/5 (2 addressed, 0 open; commits 9c80608..9a4ea51)
Task 10: minor (deferred): adjust confia no objeto Reservation (não confere com a linha 'reserva') — ok enquanto Reservation não for serializada em payload de job
Task 10: complete (commits 339de6f..9a4ea51, review clean)
Task 11: dispatched (base 9a4ea51, sonnet)
Task 11: pendência manual: conferir versão da Graph API no painel da Meta (default v24.0)
Task 11: review — Needs fixes (plan-mandated): parser lança em change sem metadata (outros fields da Meta) → perde mensagens reais; 1 item malformado derruba payload; corte 4096 parte surrogate pair; hex do HMAC leniente
Ruling: corrigir 1–4 + interactive (button_reply/list_reply → texto), timestamp numérico validado por item, appSecret vazio ⇒ false, 131016 retentável — baratos e no mesmo arquivo — custo se errado: nenhum
Task 11: minor (deferred): 200 sem wamid vira permanente; timeout retentado pode duplicar envio (Cloud API sem idempotência); rota deve responder challenge como text/plain (Task 15 já faz)
Task 11: fix round 1/5 (5 addressed, 0 open; commits 33b1d65..1f7453f)
Task 11: minor (deferred): change.value não-objeto ainda derruba payload (Meta não envia); list_reply e 131016 sem teste
Task 11: complete (commits 9a4ea51..1f7453f, review clean)
Ruling: Task 12 Step 6 (chamada real ao OpenRouter) depende de OPENROUTER_API_KEY que o .env local não tem — implementer pula e registra como pendência manual; Step 1 (escolha de modelos via endpoint público) é feito — custo se errado: modelo escolhido só validado na homologação
Task 12: dispatched (base 1f7453f, sonnet)
Task 12: pendência manual: smoke test real (Step 6) e confirmar que zdr:true encontra provedor para mistral-nemo / gemini-2.5-flash-lite (MCP OpenRouter não expõe política ZDR por endpoint; ambos têm structured_outputs; Vertex/Mistral EU disponíveis)
Task 12: review — Needs fixes (plan-mandated): delimitador </mensagem_cliente> não escapado (prompt injection); toUsage pode lançar (body null, cost string) após chamada paga; custo ausente/negativo/minúsculo vira 0 ou NaN
Ruling: escapar < e > do texto do cliente (substituir por ‹ ›) antes de envolver nas tags; body/usage normalizados sem lançar; LlmUsage.costUsd vira string|null — null = custo desconhecido (ausente/não finito/negativo); custo >0 arredonda PARA CIMA em 6 casas; Task 16 usa a estimativa da reserva quando costUsd for null (fail-safe para o teto) — custo se errado: superestimar gasto em casos raros
Task 12: minor (deferred): timeout na leitura do corpo vira saida_invalida; mensagem de erro do provedor repassada sem truncar (truncar antes de logar); restaurante interpolado no system prompt (dado confiável hoje)
Task 12: fix round 1/5 (3 addressed, 0 open; commits 1ef5362..d0b918e)
Task 12: complete (commits 1f7453f..d0b918e, review clean)
Task 13: dispatched (base d0b918e, sonnet; review opus)
Task 13: review (opus) — spec ✅; Needs fixes: (1) wamid reentregue ainda faz upsert de conversa (abre conversa órfã se a antiga está encerrada; estende janela 24h) — quebra I7; (2) boss 'web' não funciona como web_app (tabelas pgboss de postgres localmente; registrar faz DELETE em pgboss.instance; sem listener 'error' → start() rejeita); (3) corrida: job coalescido pego pelo worker antes do COMMIT do webhook perde a mensagem
Ruling (1): após upsert do customer, se wamid já existe → retorno antecipado sem tocar conversa; IngestInput ganha `timestamp: Date` (da Meta) e window_expires_at = greatest(atual, timestamp + 24h) — Task 15 deve passar m.timestamp — custo se errado: nenhum
Ruling (2): createBoss('web') com registerInstance:false; createBoss sempre anexa listener 'error' (parâmetro onError; default emite warning só com err.message); testes passam a rodar o boss do worker como worker_app e o do web como web_app (senhas locais de dev definidas no setup de teste só no Supabase local; schema pgboss recriado com dono worker_app localmente) — fidelidade com produção — custo se errado: setup de teste mais complexo
Ruling (3): mitigação vai para a Task 16 — ao fim do processamento, se houver mensagem de entrada com id > processed_up_to_id, reenfileirar a conversa (send com mesma singletonKey) — custo se errado: um job extra ocasional
Task 13: minor (deferred): applyStatus sem ordem (delivered depois de read regride); debounce só no início da rajada
Task 13: fix round 1/5 (2 addressed, 0 open; commits c8eebd7..a02f4f1)
Task 13: minor (deferred): guarda local de test-utils usa substring da URL (usar new URL().host); TEST_DATABASE_URL diferente do Supabase local quebra getTestBoss
Task 13: complete (commits d0b918e..a02f4f1, review clean)
Task 14: dispatched (base a02f4f1, sonnet)
Task 14: review — spec ✅ Approved; minors: dataCollection.queues não desligado; err.detail/message de pg pode carregar PII p/ log/Sentry; shutdown sem catch (rejeição não tratada); Sentry.init depois dos imports (sem auto-instrumentação ESM)
Ruling: queues:false + scrub de exception values/err.detail entram na Task 19 (que mexe no sentry); try/catch no shutdown e log de falha no boot entram na Task 16 (que edita main.ts) — mesmo arquivo, evita retrabalho — custo se errado: nenhum
Task 14: complete (commits a02f4f1..41c9e58, review clean)
Task 15: dispatched (base 41c9e58, sonnet)
Task 15: review (opus) — spec ✅ Approved; minors: body lido inteiro antes do limite (conta chars, não bytes) e env/db/boss inicializados antes do HMAC; mensagem 'venenosa' (ex.: \u0000) bloqueia o lote inteiro em toda reentrega; getSingleRestaurantId cache global sem teste; teste de status fraco; RESTAURANT_ID inexistente → 500 eterno
Ruling: na Task 19 (que já edita route.ts) incluir: rejeitar Content-Length > 1MB, ler arrayBuffer e checar bytes, HMAC sobre os bytes, montar enqueue/boss só após verificar assinatura; aplicar statuses antes das mensagens e remover \u0000 do texto no parser; teste de status checando statusEnvio — hardening do único endpoint público — custo se errado: nenhum
Task 15: complete (commits 41c9e58..8c64115, review clean)
Ruling (Task 16): costUsd null ⇒ liquidar pela estimativa da reserva (TRIAGE_BUDGET_ESTIMATE_USD) e registrar ai_run com essa estimativa; logar warn quando custo real > estimativa; ProcessDeps ganha requeue(conversationId) e, após decide+deliver, se houver mensagem de entrada com id > processed_up_to_id, chama requeue (mitigação da corrida da Task 13); main.ts: shutdown com try/catch + exit(1) e log de falha no boot
Task 16: dispatched (base 8c64115, sonnet; review opus)
Ruling (revisa a anterior): falha da API sem usage (ex.: 502) conta custo 0; estimativa só quando a chamada foi atendida (ok, ou ok:false com usage presente porém costUsd null) — evita superfaturar falhas — custo se errado: subcontar se o provedor cobrar erro (improvável)
Task 16: review (opus) — Needs fixes: CRITICAL I5 — tomada humana durante a triagem: respostas da IA ainda são gravadas/enviadas e novoEstado sobrescreve 'humano'; jobs concorrentes duplicam resposta. Important: maybeBilled conta 502 sem usage (regra revisada não aplicada); reserva vaza em exceção (sem try/finally; commit após settle perde ai_runs); retentativa do LLM sem reserva própria; deliver envia pendentes da IA mesmo com estado humano; aviso de privacidade marcado como enviado antes da entrega
Ruling (crit): no commit, SELECT conversations FOR UPDATE; se cursor >= upTo → grava só ai_runs; se estado <> 'ia' → grava ai_runs e avança cursor, sem respostas, sem mudar estado, sem aviso — custo se errado: nenhum
Ruling: maybeBilled = r.ok || r.usage !== null; reservar 2× a estimativa (cobre a retentativa); liquidação DENTRO da transação do commit (settleBudget/releaseBudget aceitam Db|Tx); qualquer exceção entre reserva e commit → releaseBudget e relança — custo se errado: reserva maior reduz folga do teto em ~0,005 USD por conversa em andamento
Ruling: deliver cancela (status 'cancelado') pendentes com autor 'ia' quando estado <> 'ia'; mensagens 'sistema' seguem; privacy_notice_sent_at só quando o aviso é efetivamente enviado (no deliver); atorTipo da auditoria segue d.autor ('sistema' no pré-filtro); heartbeat?.stop() — custo se errado: nenhum
Task 16: minor (deferred): envio duplicado se crash entre sendText e UPDATE (sem claim 'enviando'); falha de decryptPhone gasta triagem até a DLQ; cost_usd estimado sem flag 'estimado'; bloqueio de flood fora do commit; erro do provedor logado em nível error
Ruling: serializer de err que remove 'params' de DrizzleQueryError entra na Task 19 (logger/Sentry)
Task 16: fix round 1/5 (A–F addressed; commits 42f3358..29ec6d6)
Ruling: rodada 2 para dois efeitos colaterais da rodada 1 — aviso de privacidade identificado por texto (frágil) e duplicável em retentativa → coluna messages.reply_key + needsNotice=false se houver aviso pendente; falha no commit após chamada paga → liquidar o gasto real (settle) em vez de estornar; erro do release não mascara o original; outcome 'replied' só quando houve resposta — custo se errado: uma migration pequena
Task 16: fix round 2/5 (3 addressed, 0 open; commits 29ec6d6..fcc5504)
Task 16: minor (deferred): caminho 'LLM lança após chamada concluída' sem teste dedicado; aviso pendente pré-migração 0009 sem reply_key
Task 16: complete (commits 8c64115..fcc5504, review clean após 2 rodadas)
Task 17: dispatched (base fcc5504, sonnet)
Ruling: next dev injeta bloco 'nextjs-agent-rules' em AGENTS.md/CLAUDE.md (opt-out oficial: agentRules:false no next.config) — desligar, igual ao turbo — custo se errado: nenhum
Task 17: review (opus) — spec ✅ Approved; getClaims verifica assinatura (JWKS/getUser) — confirmado no auth-js 2.117.2
Ruling: rodada 1 com agentRules:false + endurecimentos baratos: matcher/paths públicos ancorados; redirect do proxy leva cookies/headers do setAll; enable_signup=false no supabase/config.toml (PRD §7.4); /mfa reaproveita fator TOTP não verificado em vez de criar outro; claims em allowlist (sub, role, aal, session_id, exp) em vez de spread; getClaims com try/catch → login — custo se errado: nenhum
Task 17: minor (deferred): TOFU no primeiro MFA (documentar); sessões revogadas valem até expirar (configurar jwt_expiry/timebox em produção); ?erro=permissao não exibido; custo formatado en-US; lacunas de e2e (não-staff, dono aal1 direto em /)
Task 17: fix round 1/5 (5 addressed, 1 new Important — redirect do proxy copia set-cookie com headers.set e sobrescreve cookies múltiplos; commits 1579e5e..e282b5e)
Task 17: fix round 2/5 (1 addressed, 0 open; commits e282b5e..463142a)
Task 17: complete (commits fcc5504..463142a, review clean após 2 rodadas)
Task 18: dispatched (base 463142a, sonnet)
Ruling: comando do bootstrap no pnpm 11 é sem '--' (pnpm --filter @atd/db bootstrap --restaurante ...) — Task 20 (runbook) deve usar essa forma
Task 18: review — spec ✅ Approved; Important (plan-mandated): reexecução com dono já existente falha antes do addStaff; corrida de duas execuções cria 2 restaurantes
Ruling: corrigir os 2 (dono já registrado → localizar usuário e seguir para addStaff; pg_advisory_xact_lock no início do bootstrapRestaurant) + /privacidade com notFound() se não houver restaurante — custo se errado: nenhum
Task 18: minor (deferred): --politica/--restaurante ignorados sem aviso quando restaurante já existe; sql.end fora de finally
Task 18: fix round 1/5 (3 addressed, 0 open; commits 6a6c74d..47c0e04)
Task 18: complete (commits 463142a..47c0e04, review clean)
Task 19: dispatched (base 47c0e04, sonnet; review opus) — com itens herdados das Tasks 14, 15 e 16
Task 19: review (opus) — Needs fixes: Important — valores 'params:' do DrizzleQueryError continuam em message/stack (logs e Sentry) e redactPii não cobre texto livre (quebra 'nunca logar texto de mensagem')
Ruling: truncar tudo a partir de '\nparams:' (message, stack e cause) antes do redactPii nos dois lugares, com teste de texto livre; + permissions: contents: read no CI; descartar breadcrumbs[].data.arguments; scrub também em beforeSendTransaction; erro de JSON.parse enviado ao Sentry sem a mensagem original (só o tipo) — custo se errado: nenhum
Task 19: minor (deferred): corpo chunked sem Content-Length lido inteiro antes do limite (Vercel limita ~4,5MB); boss.start() pode rodar dentro da transação da 1ª ingestão; sem teste no nível da rota (413/401 sem boss)
Task 19: fix round 1/5 (4 addressed, 1 open — stripQueryParams para no 1º '\n\s+at ' e texto do cliente com linha 'at …' vaza; commits 434f157..5d07c3e)
Ruling: em message/exception values cortar de '\nparams:' até o FIM da string; no stack, substituir o texto exato da message original pela versão cortada e, como rede, cortar até um frame real (/\n {4}at .*:\d+:\d+\)?$/m) — perde-se no máximo frames em casos patológicos — custo se errado: stack menos útil em raros casos
Task 19: fix round 2/5 (1 addressed, 0 open; commits 5d07c3e..023cce5)
Task 19: minor (deferred): stack reescrito à mão (sem a message literal) ainda pode vazar após frame falso — não ocorre com Error nativo
Task 19: complete (commits 47c0e04..023cce5, review clean após 2 rodadas)
Task 20: dispatched (base 023cce5, sonnet)
Task 20: review (opus) — Needs fixes: CRITICAL staging carrega .env de produção (env_file fixo); Important: latest publicado antes da aprovação + default do compose; segredos VPS como repository secrets sem regra de branch; sed no sshd_config não vence 50-cloud-init.conf (senha continua ativa); bootstrap.sh pode trancar o operador fora; runbook do bootstrap lista variáveis erradas e herda .env local
Ruling: corrigir 1–6 + minors baratos (permissões por job, concurrency no deploy, checagem pós-deploy (docker compose ps/logs + heartbeat recente), paths do gatilho, DEBIAN_FRONTEND e authorized_keys sem sobrescrever, pids_limit, rollback com pull e aviso, conferir fingerprint do ssh-keyscan); pin por SHA das actions/digest da imagem fica diferido — custo se errado: nenhum
Task 20: fix round 1/5 (6 + minors addressed, 0 open; commits d28f8d9..77dab37)
Task 20: minor (deferred): append em authorized_keys sem newline final corrompe a última chave; checagem pós-deploy não pega crash-loop após 'worker iniciado'; pin por SHA das actions/digest da imagem
Task 20: complete (commits 023cce5..77dab37, review clean)
Ruling: Task 21 — o subagente roda a verificação completa e escreve o roteiro de homologação; NÃO marca a homologação do dono nem itens que dependem de produção/Meta/OpenRouter real; marca no PLAN só o que tem evidência local (commits, contagens de testes)
Task 21: dispatched (base 77dab37, sonnet)
Task 21: fix round 1/5 (6 addressed, 0 open; commits 6303dbb..56c6538)
Task 21: complete (commits 77dab37..56c6538, review clean)
FINAL REVIEW: dispatched (683bf9c..HEAD, opus)
FINAL REVIEW (opus): sem Critical; With fixes. Important: (1) erro de banco no webhook vai cru para stdout/Vercel com params (texto/nome); (2) throw err no worker grava params em pgboss.job.output; (3) roteiro de homologação gera falsos negativos (handoff trava passos 6–8; limite 0 viola CHECK; sem como criar atendente); (4) runbook não sobe staging (Vercel por ambiente, Deployment Protection, Meta/OpenRouter de staging); (5) deploy do worker não depende do CI nem das migrations; (6) PostgREST expõe public (escrita sem audit_log); (7) testes do worker/webhook rodam como postgres
Ruling: UMA leva de correção com Important 1–7 + pré-merge (newline em authorized_keys; remover onlyBuiltDependencies) + minors baratos 1 (teste mfa_required em toda tabela), 4 (pool 6+3 e corrigir texto sobre LISTEN), 5 (web sem WHATSAPP_ACCESS_TOKEN), 6 (ordem Meta após worker), 8 (alinhar PRD: stately; handoff após retentativa interna) — custo se errado: nenhum
FINAL FIX WAVE: commits 56c6538..d600d25; re-review: 1,2,5,6,7,8,9 fechados; residuais (docs): homologação passo 9 precisa updateUserById com email_confirm:true; runbook 'Release regular' deve desligar o deploy automático de produção da Vercel na main
Ruling: residuais de docs vão para o dono na finalização (sem 2ª leva, conforme processo) — custo se errado: homologação do dono falha no login e um deploy web pode chegar à produção antes da migration
