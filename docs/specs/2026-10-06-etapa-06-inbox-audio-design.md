# Etapa 06 — Atendimento humano (inbox) + áudio

> Spec aprovada em conversa em 06/10/2026. Processo acelerado: um ciclo por etapa. PRD §10 (invariantes) vence qualquer conflito. **Escopo fechado:** o que crescer vira item de etapa futura, não entra aqui. E-mail/push com o painel fechado ficam fora (opção A do dono).

## 1. Objetivo e critério de sucesso

A equipe **atende pelo painel** as conversas que a IA passou para humano: vê em tempo real quem está esperando, **assume**, lê o histórico, **responde o cliente pelo WhatsApp**, **devolve à IA** ou **encerra**. A IA passa a conversa sozinha também por **frustração** e por **falhas seguidas**, e informa **quando a equipe atende** fora do horário. O cliente pode mandar **áudio**: a IA transcreve, descarta o arquivo e responde como se fosse texto.

Sucesso:
- Simulador: "quero falar com um atendente" ⇒ a conversa aparece em **Conversas → Aguardando** sem recarregar (com aviso na aba); atendente assume, responde e a resposta aparece no simulador; "Devolver à IA" ⇒ a IA volta a responder.
- Fora do horário de atendimento humano, o handoff informa quando a equipe volta.
- Duas falhas seguidas da IA ou cliente irritado ⇒ handoff.
- Simulador com arquivo de áudio ⇒ transcrição na conversa ("🎤 …") e resposta normal; o arquivo não fica guardado.
- Evals S1–S4 sem regressão com a `triage-v6`.

## 2. Inbox (painel)

### 2.1 Navegação e lista
- Barra inferior: **Início · Conversas · Agenda · Conteúdo · Mais**; "Unidades" vai para **Mais** (rota mantida).
- **Conversas** (`/conversas`): abas **Aguardando** (padrão) · **Comigo** · **Com a IA** · **Encerradas**; filtro de unidade (só as permitidas). Item: nome de perfil, unidade, último trecho (≤ 80 caracteres), "há X min", selo do estado, quem atende. Ordenação: Aguardando pela espera mais antiga; demais pela última mensagem. Paginação por cursor (50).
- **Simulações:** conversas simuladas só aparecem com o filtro "Mostrar simulações" (padrão desligado; selo "Simulação"). Permite homologar a inbox sem número real.
- Visibilidade: dono vê tudo; gerente e atendente só conversas das unidades a que têm acesso (RLS initplan, como nas etapas anteriores). Conversa sem unidade definida (cliente ainda não citou) é visível a quem tem acesso a todas as unidades.

### 2.2 Conversa aberta (`/conversas/[id]`)
- Histórico completo (paginado para cima), bolhas por autor (cliente, IA, humano — com o nome do atendente —, sistema), mídia (documento/imagem/localização/lista como já no simulador), áudio como "🎤 *transcrição*" (ou "🎤 Áudio não transcrito" quando não houve STT).
- Ações (todas Server Actions com `requireStaff` + Zod + `audit_log` na mesma transação, sem PII no `diff`):
  - **Assumir** — UPDATE atômico `estado → humano, atendente_id = eu` quando `estado ∈ {ia, aguardando_humano, encerrada}`; se outra pessoa já assumiu ⇒ "Fulano já está atendendo" (dono/gerente podem **Assumir mesmo assim**, com confirmação). Assumir conversa que está com a IA interrompe a IA (respostas pendentes da IA canceladas — invariante I5).
  - **Responder** — só quem assumiu, estado `humano`, **dentro da janela de 24 h** (`window_expires_at > now()`). Texto 1–4096 caracteres. Grava `messages` (`autor 'humano'`, `atendente_id`, `status_envio 'pendente'`) e enfileira a entrega no worker (o token da Meta fica só no worker). Fora da janela: campo bloqueado com "O cliente não escreve há mais de 24 h. O WhatsApp só permite responder quando ele mandar uma nova mensagem." (templates ficam para o go-live).
  - **Respostas rápidas** — atalhos de texto da equipe (ex.: "Um momento, vou verificar"), cadastrados por dono/gerente em Conteúdo → Mensagens → "Respostas rápidas" (até 30, título ≤ 40, texto ≤ 1000). Inserem o texto no campo; o atendente revisa e envia.
  - **Devolver à IA** — `estado → ia`, `atendente_id = null`, `falhas_consecutivas = 0` (já existe; passa a valer para quem assumiu e para dono/gerente).
  - **Encerrar** — `estado → encerrada`; a próxima mensagem do cliente reabre com a IA (`estado → ia`).
  - **Mostrar telefone** — mesmo padrão auditado da Etapa 04.
- Status de entrega na bolha humana: enviando / enviado / falhou (com "Tentar de novo").

### 2.3 Tempo real e avisos (painel aberto)
- **Broadcast privado** do Supabase Realtime disparado por **trigger** em `conversations` (mudança de `estado`, `atendente_id`, `last_message_at`) e em `messages` (INSERT), via `realtime.send` em tópicos `inbox:<unit_id>` e `inbox:sem-unidade`, e `conversa:<conversation_id>`. **O payload não leva conteúdo nem PII** — só `{ conversation_id, evento }`; o painel, ao receber, recarrega a lista/conversa pela DAL (RLS vale). Policies em `realtime.messages` (SELECT, `authenticated`): tópico `inbox:<unit>` só para quem tem a unidade em `app.minhas_unidades()`; `conversa:<id>` só se a conversa for visível ao usuário; MFA restritiva como nas tabelas.
- **Avisos:** contador "Aguardando" no ícone de Conversas e no título da aba ("(2) Atendimento"); **som** opcional (liga/desliga no painel, preferência local); **notificação do navegador** opcional (botão "Ativar avisos"; texto fixo sem PII: "Nova conversa aguardando atendente"). Queda do Realtime ⇒ reconecta e recarrega; fallback de recarga a cada 60 s enquanto desconectado.
- **Início:** o cartão "Aguardando atendente" passa a linkar a inbox; novo número "Tempo até assumir (hoje)" — mediana entre entrar em `aguardando_humano` e ser assumida (só conversas reais).

## 3. Handoff automático e horário humano

- **Falhas seguidas:** `falhas_consecutivas ≥ 2` (IA sem resposta válida / erro de modelo / fora do escopo repetido) ⇒ handoff com a mensagem padrão.
- **Frustração:** `triage-v6` (v5 intacta) ganha `frustracao: boolean` (cliente irritado, reclamando do atendimento, repetindo a mesma pergunta com impaciência). `true` ⇒ handoff, mesmo com itens respondíveis (responde os itens e avisa que um atendente vai continuar). Evals de camada 1 ganham ≥ 10 frases de frustração e ≥ 10 de não-frustração parecidas ("que demora pra abrir o restaurante, hein" ≠ frustração com o atendimento).
- **Horário de atendimento humano** (`restaurants.horario_atendimento_humano`, hoje `{}`): formato `{ dias: { seg: [{inicio:'09:00', fim:'18:00'}], … } }` validado por Zod, fuso do restaurante, mesmo esquema de turnos do S1 (inclui madrugada). Tela em **Mais → Atendimento humano** (dono). Vazio ⇒ sem promessa de horário.
- **Mensagem de handoff:** dentro do horário ⇒ "Vou passar você para alguém da nossa equipe. Já já te respondem por aqui."; fora ⇒ "… Nossa equipe atende {proximo_horario} (ex.: amanhã a partir das 9h) e te responde assim que voltar." Modelos editáveis (aba Mensagens), variáveis validadas.
- Handoff grava o motivo (`pedido | frustracao | falhas | economico | servico`) em `conversations.handoff_motivo` (para o painel e métricas; sem texto livre).

## 4. Áudio (STT)

Fluxo no worker, antes da triagem, para mensagem `tipo 'audio'`:
1. **Sem STT configurado** (`AI_STT_MODELS` vazio) ⇒ resposta atual ("ainda não consigo ouvir áudio, pode escrever?"), sem custo.
2. **Baixar** da Meta (`downloadMedia(mediaId)`: GET do id ⇒ URL ⇒ bytes com o token; ≤ 16 MB; só em memória, nunca em disco/Storage). Falha ⇒ "Não consegui ouvir seu áudio. Pode mandar de novo ou escrever?".
3. **Duração** lida do contêiner Ogg/Opus (último *granule position* ÷ 48 000); se não der para ler, estimativa conservadora pelo tamanho. **> 2 min** ⇒ "Seu áudio passou de 2 minutos. Pode mandar um mais curto ou escrever?" (sem STT).
4. **Reserva** de orçamento (`escopo 'ia'`) = duração × preço do modelo (configurável, `AI_STT_USD_POR_MIN`, padrão conservador) **antes** da chamada; sem saldo ⇒ caminho de modo econômico (handoff).
5. **Transcrever** via OpenRouter `POST /api/v1/audio/transcriptions` (`language: 'pt'`, `provider: { data_collection: 'deny', zdr: true }` — exceto a flag de dev já existente), timeout 20 s, 1 retentativa em erro transitório. `ai_runs` com `etapa 'stt'` e `audio_segundos`; liquidação pelo custo real.
6. **Descartar** os bytes (variável liberada; `midia_ref` fica só com `{ mediaId, duracao_s }`, sem URL). Grava `messages.texto` = transcrição, `transcrito = true`. O texto segue a **redação de PII** e o fluxo normal (triagem v6 etc.).
- Meta PRD: resposta < 15 s para áudio ≤ 1 min.
- **Simulador:** botão de microfone/anexo aceita arquivo de áudio (ogg/opus, mp3, m4a, wav; ≤ 16 MB) — sobe para um bucket privado temporário `audios-simulados`, o worker baixa com a chave de serviço, transcreve e **apaga o objeto** (exercita o descarte). E2E com STT falso.
- **Evals de áudio:** script `eval:stt` com 10–15 áudios curtos de exemplo e gabarito de texto (taxa de erro por palavra e acerto de unidade/data/número); roda com crédito e escolhe o modelo de `AI_STT_MODELS`.

## 5. Modelo de dados (migrations via drizzle-kit)

- `conversations`: `handoff_motivo` (enum, nullable), `aguardando_desde timestamptz` (para a métrica e a ordenação), índice para a inbox por `(restaurant_id, estado, aguardando_desde)` e `(restaurant_id, unit_id, last_message_at desc)`; `EXPLAIN` revisado.
- `messages`: `atendente_id uuid` nullable (FK staff) para mensagens humanas.
- `quick_replies` (id, restaurant_id, titulo, texto, ordem, ativo; RLS: leitura equipe, escrita dono/gerente; sem DELETE para `authenticated`).
- Policies de `realtime.messages` e triggers de broadcast (`security definer`, `search_path` fixo).
- Grants por coluna: `authenticated` só altera em `conversations` `estado, atendente_id, falhas_consecutivas, updated_at` (via DAL com as transições válidas); INSERT em `messages` só `autor 'humano'` com `atendente_id = auth.uid()` (ou via `web_app`, decidido no plano pelo padrão atual).
- Bucket `audios-simulados` (privado; upload dono/gerente/atendente; worker lê/apaga com a chave de serviço).

## 6. Pendências da Etapa 04 incluídas
1. Handoff da triagem grava as saídas com autor `sistema` — revisar com a inbox (as bolhas mostram autor certo).
2. "Pessoas" e evento na mesma mensagem perdem o evento.
3. Lista de unidades antiga com pendente `pedido_evento` responde "lista expirada".
4. Corrida com pedido confirmado pela equipe durante a coleta responde "não encontrei".
5. Responsável do pedido de evento precisa ter acesso à unidade (seletor + DAL).
6. `TRANSICOES` de status num lugar só.

## 7. Segurança e LGPD
- Realtime sem conteúdo no payload; leitura sempre pela DAL com RLS.
- Resposta humana sai só pelo worker (token nunca no web/browser).
- Áudio: retenção zero do arquivo; transcrição tratada como mensagem de texto (retenção de `messages`, 90 dias); STT com deny/ZDR; nada de áudio/transcrição em log/Sentry.
- Notificação do navegador sem PII.
- Atendente só lê/responde conversas das suas unidades; tudo auditado (assumir, responder — sem o texto no `diff` —, devolver, encerrar, telefone).

## 8. Qualidade
- Unitários: transições de estado, janela de 24 h, próximo horário humano (fuso, madrugada, feriado não afeta), duração Ogg, estimativa de custo do STT, mensagens de handoff.
- Banco: RLS/grants da inbox por papel e unidade, policies do Realtime por tópico, assumir concorrente (dois atendentes ao mesmo tempo ⇒ um só vence), simuladas fora por padrão.
- Worker: entrega da resposta humana (sucesso, falha, conversa simulada), handoff por falhas e por frustração, áudio (sem STT, longo, falha de download, sem saldo, sucesso com descarte).
- Evals: S1–S4 com `triage-v6` sem regressão (camada 2 no CI); frustração na camada 1 (com crédito); `eval:stt` (com crédito).
- E2E (celular, IA e STT falsos): simulador pede atendente ⇒ aparece em Aguardando sem recarregar ⇒ assumir ⇒ responder ⇒ resposta no simulador ⇒ devolver à IA; atendente de outra unidade não vê; áudio no simulador ⇒ transcrição; horário humano salvo e mensagem fora do horário; resposta rápida.

## 9. Fora desta etapa
E-mail/push com o painel fechado; templates da Meta (resposta fora das 24 h) — go-live; transferência entre atendentes além do "assumir mesmo assim"; anexos enviados pelo atendente; áudio de resposta (TTS); relatórios de atendimento além do "tempo até assumir".

## 10. Mudanças no PRD
§3: `conversations.handoff_motivo`, `aguardando_desde`; `messages.atendente_id`; `quick_replies`; formato de `horario_atendimento_humano`. §4.1 1.5: duração lida do Ogg; STT por `/audio/transcriptions`; simulador com bucket temporário. §4.5: frustração pela triagem v6; mensagem com próximo horário. Realtime: payload sem conteúdo (só ids) + recarga pela DAL. Navegação: "Conversas" na barra; "Unidades" em Mais.
