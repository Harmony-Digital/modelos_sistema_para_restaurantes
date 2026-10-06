# Etapa 04 — Eventos (S3)

> Spec aprovada em conversa em 05/10/2026. Processo acelerado: um ciclo por etapa (spec → plano enxuto → execução com revisão por bloco → homologação → PR). PRD §10 (invariantes) vence qualquer conflito.

## 1. Objetivo e critério de sucesso

A IA **informa** os espaços de evento de cada unidade (capacidade, descrição, condições — só do banco) e **coleta** pedidos de reserva de espaço (unidade, data, convidados, tipo). **A confirmação é sempre humana**: a IA nunca diz "reservado" nem "confirmado". A equipe trabalha uma fila de pedidos com status, responsável e notas internas.

Sucesso:
- No simulador, "quero fazer um aniversário para 40 pessoas" faz a IA perguntar o que falta, uma coisa por vez, e registrar o pedido com a mensagem "Recebemos seu pedido… nossa equipe vai entrar em contato para confirmar".
- Respostas curtas às perguntas ("aniversário", "dia 20", "Asa Sul", "uns 40") são entendidas porque a triagem recebe a pergunta pendente (§2.1).
- "Que espaços vocês têm para festa?" lista os espaços cadastrados com capacidade e condições.
- O pedido aparece na fila Eventos; dono/gerente/atendente mudam status, responsável e notas; tudo auditado.
- Evals S3 dentro das metas e evals S1/S2 sem regressão.

## 2. Abordagem — "IA entende, código responde", com contexto da pergunta pendente

### 2.1 Triagem v4 (melhoria transversal)

Nova versão `triage-v4` (v3 intacta). Duas mudanças:
1. **Itens de evento:** `servico = 'evento'`, `tipo ∈ { 'pedido', 'cancelar', 'espacos' }`, mais os campos `convidados` (inteiro ≥ 1), `tipo_evento` (texto curto como o cliente disse), `espaco` (nome do espaço como o cliente disse), além de `unidade` e `data` já existentes.
2. **Pergunta pendente no contexto:** quando a conversa tem um pendente (S2 ou S3), o prompt recebe, **fora** do bloco da mensagem do cliente, a pergunta que o sistema fez (texto nosso, do modelo) e os campos já conhecidos, por exemplo `<pergunta_pendente>Qual o tipo do evento?</pergunta_pendente>` + `<pedido_em_andamento>{servico: evento, unidade: Asa Sul, convidados: 40}</pedido_em_andamento>`. A triagem devolve o item completo com o que o cliente acabou de responder. O conteúdo do cliente continua só dentro de `<mensagem_cliente>` (dado, nunca instrução) e com redação de PII.

Isso também melhora o S2 (respostas curtas a "Pode me dizer outro dia?" etc.). Os evals S1 e S2 rodam com a v4 e não podem regredir.

O caminho determinístico atual (resposta a "Para quantas pessoas?" e escolha na lista) continua antes da triagem, sem custo.

### 2.2 Resolução determinística (`@atd/core/s3`, puro)

**Pedido:**
1. Unidade: busca do S1; ausente com várias ativas ⇒ lista ("Para qual unidade é o evento?"); uma só ⇒ assume.
2. Data: resolução de datas do S1; deve ser de **amanhã** até **hoje + 365**; ausente ⇒ pergunta "Para qual data?".
3. Convidados: 1–1000; ausente ⇒ "Para quantos convidados?". Resposta curta lida pelo parser de pessoas do S2 (limites próprios do S3).
4. Tipo de evento: normalizado para `aniversario | casamento | corporativo | confraternizacao | outro` (+ texto original curto ≤ 60); ausente ⇒ "Qual o tipo do evento? (aniversário, casamento, corporativo…)".
5. Espaço (opcional): citado ⇒ busca por nome na unidade; convidados fora de `[capacidade_min, capacidade_max]` ⇒ informa a capacidade e sugere os espaços que comportam, **sem** registrar até o cliente escolher ou dizer "pode ser qualquer um"; não citado ⇒ registra sem espaço e a resposta lista os espaços que comportam o grupo (se houver).
6. Unidade fechada no dia: **não bloqueia** (evento privado); grava observação automática "Unidade fechada nesse dia pelo horário cadastrado" para a equipe.
7. Registro: cria `event_requests` status `novo` e responde: "Recebemos seu pedido de {tipo} para {convidados} convidados na unidade {unidade}, {quando}{espaco}. Nossa equipe vai entrar em contato para confirmar." Nunca "reservado/confirmado".

Campos faltando são pedidos **um por vez**, na ordem unidade → data → convidados → tipo, com o pedido em andamento guardado no pendente (expira em 60 min).

**Cancelar:** cancela o pedido do próprio cliente em `novo` ou `em_contato` (mesmas regras de alvo do S2: sem unidade/data e um pedido ⇒ esse; vários ou alvo não reconhecido ⇒ lista com exemplo; nenhum ⇒ "Não encontrei pedido de evento seu em andamento."). Pedido `confirmado` não é cancelado pela IA ⇒ handoff para a equipe.

**Espaços:** "que espaços vocês têm?" ⇒ lista os espaços ativos da unidade (ou de todas, se poucas) com capacidade, descrição e condições; nenhum cadastrado ⇒ lacuna `eventos:espacos` (aparece em "Sem resposta").

Todos os textos são modelos editáveis (aba Mensagens). Itens S3 contam no "% respondido pela IA".

### 2.3 Worker

- Pendente vira `{ tipo: 'unidade' | 'pessoas' | 'pedido_evento', … }` (pendentes antigos continuam válidos).
- Pedido gravado **na mesma transação** do commit, nunca quando o humano assumiu; `audit_log` `evento.pedido_criado` / `evento.pedido_cancelado` sem PII; conversa simulada ⇒ `simulado = true` (fora da fila real e das contagens).
- Pedido de evento **não** muda o estado da conversa (a IA continua atendendo); a equipe é avisada pela fila e pelo cartão no Início.

## 3. Modelo de dados

`event_spaces` (PRD §3.3): id, restaurant_id, unit_id (FK composta), nome, capacidade_min, capacidade_max (1–1000, min ≤ max), descricao, condicoes, ativo, timestamps. Único `(unit_id, nome)`; índice `(restaurant_id, unit_id)`.

`event_requests`: id, restaurant_id, unit_id (FK composta), space_id nullable (`ON DELETE SET NULL`), customer_id nullable (`ON DELETE SET NULL`), nome (perfil do WhatsApp), data `date`, convidados smallint 1–1000, tipo (enum), tipo_texto ≤ 60, observacoes (automáticas, ≤ 300), status (`novo|em_contato|confirmado|recusado|cancelado`), responsavel_id nullable (staff), notas_internas ≤ 2000, simulado, anonimizado, timestamps. Índices `(restaurant_id, status, data)` e `(restaurant_id, unit_id, data)`.

RLS/grants no padrão do S2: leitura pela equipe com permissão na unidade (initplan); `event_spaces` escrita dono/gerente; `event_requests` sem INSERT para `authenticated` (só worker/web_app), UPDATE de `authenticated` **só** em `status, responsavel_id, notas_internas, updated_at` (dono/gerente/atendente com acesso à unidade — o atendente trabalha a fila); sem DELETE; `mfa_required` restritiva; `app_roles` para web_app/worker_app. Transições de status validadas na DAL (cancelado/recusado/confirmado não voltam para novo).

Retenção: anonimizar 2 anos após a data (cron Etapa 08): zera customer_id, nome, notas_internas.

## 4. Painel

- **Navegação:** o item "Previsão" vira **"Agenda"** com abas **Previsão** | **Eventos** (rota `/agenda?aba=…`; `/previsao` redireciona). Barra continua com 5 itens.
- **Eventos (fila):** filtros status (padrão: novo + em contato) e unidade; lista ordenada por data do evento com selo de status, convidados, tipo, unidade, nome, "há X horas"; detalhe em folha/diálogo: dados do pedido, espaço, observações automáticas, **status** (transições válidas), **responsável** (membro da equipe), **notas internas**, **Mostrar telefone**.
- **Mostrar telefone:** Server Action decifra no servidor só para quem tem acesso à unidade do pedido; grava `audit_log` `evento.telefone_visualizado` (sem o número); exibe com link `tel:`/WhatsApp; some ao fechar o detalhe. Pedido manual/sem cliente ⇒ botão ausente.
- **Unidade → aba "Espaços":** CRUD de espaços (dono/gerente), desativar em vez de apagar; validação min ≤ max.
- **Início:** cartão "Pedidos de evento novos" (contagem de `novo`, unidades permitidas) com link para a fila.
- **Mensagens:** modelos S3 aparecem na aba existente.

## 5. Segurança e LGPD

- Base legal: procedimentos preliminares a pedido do titular. Mínimo necessário: nome de perfil, data, convidados, tipo.
- Telefone continua cifrado; revelação só sob demanda, auditada, sem log do número.
- Nada de PII em log/Sentry/`diff` de auditoria (notas internas fora do `diff`).
- Toda Server Action: `requireStaff` + Zod + resultado tipado; permissão por unidade pela RLS.
- Cliente só cancela o **próprio** pedido.

## 6. Qualidade

### 6.1 Evals
- **S3 camada 2 (CI):** ≥ 50 casos — pedido completo, coleta campo a campo com pendente, data fora da janela, convidados fora do espaço, espaço inexistente, sugestões por capacidade, unidade fechada (observação), cancelar com/sem alvo, pedido confirmado ⇒ handoff, espaços listados, lacuna sem espaços, mistura S1+S3.
- **S3 camada 1 (modelo real):** ≥ 30 frases, incluindo respostas curtas com `pergunta_pendente`; meta ≥ 95%.
- **S1/S2:** rodar os gabaritos existentes com a v4 (camada 2 inalterada; camada 1 quando houver crédito).

### 6.2 Testes do sistema
- Unitários: resolução S3, normalização de tipo, sugestões por capacidade, transições de status.
- Banco: RLS por unidade e papel (atendente trabalha a fila mas não cria nem apaga), grants por coluna, auditoria, isolamento da simulação.
- Worker: coleta completa em várias mensagens, cancelamento, confirmado ⇒ handoff, humano assumiu ⇒ nada gravado.
- E2E (celular, IA falsa): simulador coleta e registra (simulado fora da fila); painel cria espaço, pedido real inserido por SQL aparece na fila, muda status/responsável/notas, Mostrar telefone (auditado), atendente trabalha a fila.

## 7. Melhorias transversais incluídas
1. Triagem com pergunta pendente (§2.1) — vale para S2 também.
2. Navegação "Agenda" (§4).
3. Backlog barato: `chamarAcao` repropaga redirect/notFound do Next (`unstable_rethrow`); auditoria das ações do simulador (abrir, novo cliente, relógio).

## 8. Critério de pronto
1. Simulador: pedido completo e em várias mensagens, espaços listados, cancelamento — respostas corretas, nada "confirmado" pela IA.
2. Fila: status, responsável, notas, telefone auditado; gerente restrito só vê suas unidades; atendente trabalha a fila.
3. Evals S3 nas metas; S1/S2 sem regressão; `pnpm check` e e2e verdes.
4. Homologação do dono.

## 9. Fora desta etapa
E-mail/push à equipe (Etapa 06), orçamento/valores, calendário de ocupação de espaços, contrato/sinal, inbox para responder o cliente pelo painel (Etapa 06), anonimização automática (Etapa 08).

## 10. Mudanças no PRD
§3.3: colunas `nome`, `tipo_texto`, `observacoes`, `simulado`, `anonimizado`; tipos de evento como enum. §4.3: `registrar_pedido_evento` vira função do domínio (como S2), não tool de LLM. §4.2 passo 2: triagem recebe a pergunta pendente. Menu: "Agenda" (Previsão + Eventos).
