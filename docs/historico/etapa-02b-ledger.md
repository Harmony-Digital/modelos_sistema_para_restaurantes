# Registro da execução — plano 02-B (S1: dados, resolução e composição)

> Cópia versionada do ledger de execução por subagentes (rascunho em `.superpowers/`, ignorado pelo git). Cada linha `Ruling:` é uma decisão tomada durante a execução, com motivo e custo se estiver errada.

# SDD ledger — plan: docs/plans/etapa-02b-s1-resolucao.md
Spec: docs/specs/2026-10-05-etapa-02-s1-design.md (lida). Branch etapa-02b-s1-resolucao, base 06803a8 (plano commitado).

## Pré-varredura (tarefas que compartilham arquivo/interface)
| Par | Produz → consome | Achado |
|---|---|---|
| T1→T2 | tabelas/colunas (unit_hours, unit_hour_exceptions, knowledge_facts, reply_templates, knowledge_gaps) → policies/grants 0012 | nomes batem; rls.db.test "toda tabela tem mfa/app_roles" falha entre T1 e T2 (plano avisa) |
| T1→T11 | colunas politicaFeriado, apelidos, ordem, lat/lng numeric mode number, time HH:MM:SS → carregarContextoS1 | batem; hhmm corta segundos |
| T1→T12 | message_type + localizacao/lista → InboundItem do pré-filtro | plano manda estender InboundItem na T12 (ok) |
| T2→T11/T12 | grants worker_app (select horários/fatos/modelos; insert + update(ocorrencias, ultima_vez, pergunta_mascarada) em gaps) → registrarLacunas | update usa só colunas concedidas; WHERE/RETURNING exigem select (concedido) |
| T3–T7→T8 | tempo/feriados/datas/horarios/busca/modelos → resolver | código puro validado pelo controlador antes (166 testes, 101 casos, tsc estrito) |
| T8→T9 | SERVICOS/TIPOS_S1/ItemExtraido → schema Zod e json_schema v2 | batem |
| T8+T11+T10→T12 | resolverS1, carregarContextoS1, registrarLacunas, sendLocation/sendList, payload {interativoId} | chave interativoId igual em ingest e worker |
| T8/T9→T13 | resolverS1, triageV2 → evals | validado (composição) |
| T9/T11→T14 | parseTriageV2, carregarContextoS1, getSingleRestaurantId → scripts | batem |
| Por tarefa | testes x código de cada tarefa | T3–T8 conferidos executando; T1/T2/T10/T11/T12 conferidos por leitura (dependem do banco) |

Ruling: T3–T8 (núcleo puro de S1, código completo no plano e já validado executando) vão num ÚNICO despacho e numa revisão só, com um commit por tarefa — mesma forma (transcrição + teste), poupa 5 ciclos — custo se errado: revisão maior (≈1.300 linhas), mas um único revisor sonnet dá conta.
Ruling: implementadores em sonnet (regra herdada do 02-A: haiku errou o trailer); revisores sonnet, opus nas tarefas de segurança/concorrência (T2, T11, T12) e na revisão final — custo se errado: tokens.
Ruling: Task 14 Step 3 (escolha do modelo) depende da OPENROUTER_API_KEY, que o dono ainda não forneceu → executa o resto da tarefa e marca a camada 1 como pendente da chave; não bloqueia o fluxo — custo: escolha do modelo fica para quando a chave chegar.

Task 1: dispatched (base 06803a8, sonnet)
Task 1: implemented (commit a67bafc), DONE_WITH_CONCERNS
Ruling: 0011 gerado reordenado à mão (índice units_id_restaurant_uq antes das FKs compostas) — drizzle-kit emitiu na ordem errada e a migration ainda não estava aplicada; nunca regenerar 0011 — custo: nenhum, SQL equivalente
Ruling: extensão de InboundItem.tipo (planejada na T12) antecipada para a T1 — o enum novo quebrava o typecheck do worker já aqui — custo: nenhum
Task 1: dispatching review
Task 1: review — spec ✅, quality Approved, sem Critical/Important. ⚠️ resolvido: resposta de lista chega como tipo 'texto' (webhook mapeia interactive→texto), não passa por unsupported_media
Task 1: minor (deferred → 02-C): knowledge_gaps.fact_id é FK simples (não composta com restaurant_id) — validar no DAL ao responder lacuna; sem índice começando por unit_id em facts/gaps (cascade de unidade); testes sem unicidade de turno/data e sem defaults de simulado
Task 1: complete (commits 06803a8..a67bafc, review clean)
Task 2: dispatched (base a67bafc, sonnet)
Task 2: implemented (commit 5ebf12d; test:db 111/111); 1ª execução de db:migrate falhou sem mensagem, depois aplicada — controlador conferiu no banco: 13 migrations, 20 policies, 4 índices, can_access_unit
Task 2: review (opus) — spec ✅ (0012 reaplicada em transação com ROLLBACK: limpa; hash aplicado = arquivo); quality Needs fixes: 1 Important — knowledge_gaps.fact_id com FK simples + grant de UPDATE ⇒ lacuna pode apontar para fato de outro restaurante (e vaza existência do id)
Ruling: corrigir com FK composta (fact_id, restaurant_id) → knowledge_facts(id, restaurant_id) ON DELETE SET NULL (fact_id), via schema TS (remove .references, adiciona unique (id, restaurant_id)) gerando 0013 + custom 0014 com a FK composta; mesmo padrão do unit_id — custo: 2 migrations pequenas
Ruling: incluir na 0014 revoke de MAINTAIN de authenticated (tabelas atuais + default privileges) — PG17 dá MAINTAIN por padrão, achado pré-existente e barato de fechar — custo: nenhum
Task 2: minor (deferred → 02-C): can_access_unit por linha (SECURITY DEFINER não inlinável) — trocar por forma initplan e revisar EXPLAIN quando as listas do painel existirem
Task 2: fix round 1/5 dispatched
Task 2: fix round 1/5 (Important + 4 minors addressed, 2 minors deferred; commits 5ebf12d..cd52ada; 0013/0014; test:db 114/114)
Task 2: minor (deferred): teste de gerente restrito atualizando lacuna sem unidade (policy já bloqueia)
Task 2: minor (deferred → Task 14 docs/deploy): 0014 (revoke MAINTAIN) exige Postgres 17 no Supabase hospedado — confirmar versão do projeto antes do deploy; default ACL do supabase_admin ainda dá MAINTAIN/TRUNCATE (só importa se alguma migration criar tabela como supabase_admin)
Task 2: complete (commits a67bafc..cd52ada, review clean)
Tasks 3–8 (lote núcleo S1): dispatched (base cd52ada, sonnet)
Tasks 3–8: implemented (commits 1f4b788..4dcf1ba; 60 testes s1 = 166 da validação − 106 dos evals da T13; sem desvios)
Tasks 3–8: review — transcrição ✅ byte a byte; quality Needs fixes: 3 Important — (1) data ISO '2026-10-12' vira 2012-10-26; (2) 'ter' (verbo) vira terça em "vai ter música sábado"; (3) "lago norte" (inexistente) casa com Asa Norte (Jaccard 0,40)
Ruling: incluir Minor 4 (stopwords no casamento por contenção de fato: "tem", "pode"…) e Minor 7 (ano em data por extenso; "fim de semana" no sábado/domingo = hoje) — mesma área, baratos, evitam resposta inventada
Ruling: Minor 8 (Carnaval e Corpus Christi como feriado com política como_domingo por padrão) MANTIDO — a spec lista os dois em feriadosNacionais e define como_domingo como padrão; o painel do 02-C mostra os feriados do ano com o comportamento e a exceção por data resolve — custo se errado: dono precisa cadastrar exceção nesses dias
Tasks 3–8: minor (deferred): empate entre fatos de unidades diferentes sem unidade informada (responde só uma, rotulada); unidade citada e não reconhecida com ≤3 unidades responde todas sem avisar; partesDaData aceita data impossível; validarModelo não pega "{ unidade }" nem modelo sem variável essencial (→ 02-C, tela de modelos); lista limitada a 10 (decisão 3); sobreposição de turno com o dia seguinte não validada (02-C, formulário)
Tasks 3–8: fix round 1/5 dispatched
Tasks 3–8: fix round 1/5 (3 Important + 2 minors addressed; commits 4dcf1ba..e0d7203; 161 testes core; 101 casos de eval ainda verdes)
Tasks 3–8: minor (deferred): "sab à noite"/"sex 12" (abreviação + palavras) ⇒ pede o dia (seguro); "asa norte e sul" responde só Asa Norte; "sexta 12" ignora o número
Tasks 3–8: complete (commits cd52ada..e0d7203, review clean)
Ruling: Tasks 9 e 10 num único despacho/revisão (pacotes diferentes, independentes, código completo no plano), um commit cada — custo se errado: revisão um pouco maior
Tasks 9–10: dispatched (base e0d7203, sonnet)
Tasks 9–10: implemented (commits 2b0a4de, 09a3fa6)
Tasks 9–10: review — spec ✅, quality Approved, sem Critical/Important. ⚠️ resolvido pelo controlador: packages/ai/src/index.ts reexporta triage.ts (conferido)
Tasks 9–10: minor (deferred → Task 14/evals com chave): schema estrito com tipo nulo (type ['string','null'] + enum com null) não confirmado em provedores não-OpenAI via OpenRouter; se algum recusar, trocar por anyOf; interativoId sem corte de 200 no webhook; sendList corta id sem proteger par substituto
Tasks 9–10: complete (commits e0d7203..09a3fa6, review clean)
Task 11: dispatched (base 09a3fa6, sonnet)
Task 11: implemented (commit 225061d, trailer corrigido por amend antes da revisão; s1-dados 4/4, db 83/83)
Task 11: review (opus) — spec ✅; quality Needs fixes: 1 Important — unit_hours/unit_hour_exceptions filtrados só por restaurant_id sem índice ⇒ 2 seq scans por mensagem (fere a regra de caminho quente com índice)
Ruling: filtrar horários/exceções por inArray(unit_id, ids ativos) (usa os índices únicos existentes, sem migration) + incluir Minor 1 (ordenar lacunas antes do laço: evita deadlock), Minor 3 (filtrar fatos de unidade inativa no SQL antes do limite de 500), Minors 4–5 (testes de borda de fuso e de "ontem em diante") e EXPLAIN das consultas no relatório — custo: nenhum
Task 11: minor (deferred): ocorrência perdida se a lacuna for resolvida exatamente entre o conflito e o 2º update (cosmético); ai_runs sem índice (restaurant_id, created_at) para o indicador (painel, não caminho quente — revisar no 02-C)
Task 11: ⚠️ → Task 12: registrarLacunas segura locks até o fim da transação do commit — conferir que a transação do commit não envolve chamada de LLM nem envio ao WhatsApp; conferir que itens_validos/itens_respondidos só contam itens de S1
Task 11: fix round 1/5 dispatched
Task 11: fix round 1/5 (Important + Minors 1,3,4,5 addressed; commits 225061d..533e944)
Task 11: minor (deferred): sem teste da ordenação de lacunas nem do caminho "nenhuma unidade ativa"
Task 11: complete (commits 09a3fa6..533e944, review clean)
Task 12: dispatched (base 533e944, sonnet)
Task 12: implemented (commit 69b3b4e; worker db 38 testes)
Task 12: review (opus) — spec ✅; quality Needs fixes: 3 Important — (1) pendente sequestra pergunta curta que cita unidade ("Asa Sul fecha quando?") e a pergunta nova some [plan-mandated]; (2) atalho da lista roda antes do pré-filtro ⇒ pedido LGPD/atendente na mesma rajada é descartado [plan-mandated]; (3) reserva de orçamento vaza se resolverS1/decisaoS1/redactPii lançarem
Ruling: (1) escolha digitada só vale quando o texto é apenas o nome/apelido (nova função pura escolhaDeUnidade em @atd/core: igualdade após limpar, ou similaridade ≥ 0,6 com o mesmo número de palavras, sem o atalho de contenção); qualquer palavra a mais ⇒ triagem normal — a spec manda responder o que o cliente pergunta; o plano errou ao reaproveitar encontrarUnidade — custo: cliente que digita "a da asa sul por favor" vai para a triagem (paga, mas responde)
Ruling: (2) atalho da lista só com pending.length === 1 (vale também para o id da lista) e só depois do pré-filtro devolver 'pass' — LGPD e handoff são invariantes; rajada com toque + outra mensagem vai para a triagem — custo: uma chamada de IA a mais nesse caso raro
Ruling: (3) mover carregarContextoS1 + resolverS1 + decisaoS1 + perguntaMascarada para dentro do try que compensa — orçamento é invariante
Ruling: incluir Minors 1–2 (testes do id da lista com texto que não casa; expiração e id estrangeiro isolados), 3 (payload inválido ⇒ safeParse, marca falhou:payload_invalido e segue, sem loop), 4 (limpar pendente no caminho humanOwns), 5 (guardar a pergunta mascarada no Pendente e usá-la nas lacunas do caminho da lista) — todos tocam o mesmo trecho e evitam perda de dado
Task 12: fix round 1/5 dispatched
Task 12: fix round 1/5 (3 Important + 5 minors addressed; commits 69b3b4e..7ec726a; worker db 46)
Task 12: minor (deferred → leva final): teste de orçamento só faz carregarContextoS1 lançar — falta um que faça resolverS1 lançar e confira reservado 0 / gasto 0.000200
Task 12: complete (commits 533e944..7ec726a, review clean)
Task 13: dispatched (base 7ec726a, sonnet)
Task 13: implemented (commit 5dd4c9b; 101 casos verdes de primeira; test:unit 444)
Task 13: review — spec ✅ (snapshot conferido: datas/dias/endereços corretos); quality Needs fixes: 4 Important — (1) teto de custo cego quando o provedor não informa custo (null conta 0); (2) camada 1 nunca falha (sem meta de 95% no exit code); (3) chave da API exposta a todos os passos do job (checkout/pnpm install); (4) [plan-mandated] como_chegar ≡ endereco na comparação esconde a perda do link de rota
Ruling: (1) custo desconhecido conta pela estimativa TRIAGE_BUDGET_ESTIMATE_USD e há teto de chamadas; (2) exit 1 se algum modelo < 95% ou execução parcial pelo teto; (3) chave só no env do último passo, gate por saída de passo anterior, github.base_ref via env; (4) como_chegar e endereco viram chaves distintas — as respostas diferem (link de rota); o plano errou — custo: extração que confunde os dois conta como erro (meta mais rígida)
Task 13: minor (deferred → 02-C): "fim de semana" responde só sábado (d18); lacuna genérica primeiro em resposta composta não diz o assunto (m08); "Na unidade X: A senha…" com maiúscula após dois-pontos; horasInventadas compara com todas as unidades (não por unidade) e endereço não é verificado fora dos casos com texto exato; equivalências frouxas de unidade/tema não resolvidos em chaveItem; job verde com passos pulados não mostra que evals não rodaram
Task 13: fix round 1/5 dispatched
Task 13: fix round 1/5 (4 Important addressed; commits 5dd4c9b..4022868; ai unit 126)
Task 13: minor (deferred): chave da API ainda alcançável por código de PR do mesmo repositório que o passo final executa (extracao.ts) — aceitável; considerar environment protegido no GitHub
Task 13: complete (commits 7ec726a..4022868, review clean)
Task 14: dispatched (base 4022868, sonnet)
Task 14: implemented (commit 59da688; pnpm check 652 testes/71 arquivos; camada 1 pendente da chave; candidatos listados)
Task 14: review — spec ❌ por 1 Important [plan-mandated]: trava "só banco local" do demo-s1 é regex solta na URL inteira (URL remota com "localhost" em parâmetro/senha passa e o script apaga/reescreve dados); ⚠️ conferidos pelo controlador: ci.yml usa vars.AI_TRIAGE_MODELS; pendente 30 min e até 10 unidades batem com o código; contagem 652/71 vem do pnpm check do implementador
Ruling: trava pelo hostname (new URL(url).hostname ∈ {127.0.0.1, localhost, ::1}) e recusa com NODE_ENV=production; incluir Minor 2 (perguntar avisa "Defina AI_TRIAGE_MODELS") — o script apaga dados, a trava precisa ser exata — custo: nenhum
Task 14: minor (deferred): perguntar imprime r.error do provedor (local, baixo risco)
Task 14: fix round 1/5 dispatched
Task 14: fix round 1/5 (Important + Minor 2 addressed; commits c49a034..626fcc6; re-revisão feita pelo controlador — diff pequeno: ehBancoLocal por hostname + NODE_ENV)
Task 14: complete (commits 4022868..626fcc6, review clean)
Final review: dispatched (range 50b9495..626fcc6, opus)
Final review (opus): pronto para merge, sem Critical/Important; migrations 0000–0014 aplicadas do zero num banco temporário; hashes conferidos; test:unit 450
Ruling (leva final): incluir teste de regressão do T12 (resolverS1 lança após triagem paga ⇒ reservado 0 / gasto 0.000200), testes do T11 (ordenação de lacunas; nenhuma unidade ativa), Minor 1 (toque em lista vencida responde sem LLM "Essa lista expirou…"), Minor 3 (noticePending dentro do try que compensa — invariante de orçamento, mesmo sendo anterior ao 02-B), Minor 4 (PLAN: item separado [ ] para escolha do modelo/camada 1 e faixa de commits correta), Minor 5 (remover ReplyKey emBreve morto) — custo: um despacho
Ruling: Minor 2 (data relativa do pendente resolvida na hora da escolha) adiado para o 02-C — caso raro (virada do dia entre pergunta e escolha)
Final fix wave: dispatched (base 626fcc6, sonnet)
Final fix wave: 5 commits 626fcc6..a458a44; pnpm check 661 testes/73 arquivos; dispatching scoped re-review
Final fix wave: re-review — 6 itens ADDRESSED, sem Critical/Important novos; test:unit 450 e typecheck reexecutados pelo revisor
Final fix wave: minor (deferred → 02-C): lista_expirada não usa modelos personalizados (contexto não carregado nesse caminho); qualquer interativoId sem pendente vira "lista expirou" — prefixar ids da lista (u:<uuid>) quando houver botões; data relativa do pendente resolvida na hora da escolha
Plano 02-B: COMPLETO — 06803a8..a458a44; pnpm check 661 testes / 73 arquivos; 101 casos de eval (camada 2) verdes; camada 1 pendente da OPENROUTER_API_KEY
