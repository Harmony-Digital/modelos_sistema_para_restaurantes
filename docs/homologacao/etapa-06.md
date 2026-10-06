# Homologação — Etapa 06 (atendimento humano)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp — nem a resposta do atendente: numa conversa simulada ela aparece só no simulador. A equipe atende pelo painel as conversas que a IA passou para uma pessoa: vê em tempo real quem está esperando, **assume**, responde, **devolve à IA** ou **encerra**.

**Áudio do cliente ficou fora desta etapa** (decisão do dono, 06/10/2026): continua a resposta atual ("ainda não consigo ouvir áudio, pode escrever?"). A transcrição de áudio está registrada como melhoria futura no PLAN.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # unidades, cardápio, horário da equipe (seg–sex 9h–18h) e 2 respostas rápidas
pnpm dev                                # painel em http://127.0.0.1:3000
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes, com a chave de serviço só no shell (nunca no `.env`):
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"
```

**Worker** (outro terminal). Ele responde o simulador e **entrega a resposta do atendente** (fila `conversation.deliver`; o token da Meta fica só nele). A chave de serviço vem do `supabase status` na hora e **não fica gravada em arquivo**:
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY WHATSAPP_ACCESS_TOKEN=local-sem-meta \
  pnpm --filter @atd/worker dev
```
- O simulador usa a IA de verdade (triagem **v6**, que também percebe cliente irritado) e precisa de `OPENROUTER_API_KEY` **com crédito** e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Sem crédito, a triagem falha e a conversa vai direto para a equipe (motivo "IA não conseguiu responder") — dá para homologar a inbox mesmo assim.
- O pedido explícito ("quero falar com um atendente") não usa IA: funciona sem crédito.

## 2. Conversas (barra inferior: **Início · Conversas · Agenda · Conteúdo · Mais**)
"Unidades" saiu da barra e agora fica em **Mais → Unidades**.
1. Abra **Conversas** numa aba do navegador e deixe aberta. Marque **Mostrar simulações** e toque em **Filtrar** (simulações ficam escondidas por padrão; aparecem com o selo "Simulação").
2. Em outra aba, abra o simulador (botão verde do WhatsApp), toque em **Novo cliente** e escreva "quero falar com um atendente". O simulador responde "Vou passar você para alguém da nossa equipe…".
3. Na aba de Conversas, **sem recarregar**, a conversa aparece em **Aguardando** com "Pediu atendente" e "há 1 minuto". O título da aba do navegador ganha o contador "(1) …" e o ícone de Conversas mostra o número de conversas **reais** aguardando (simulação não conta).
4. Abra a conversa e toque em **Assumir** ⇒ "Conversa assumida. Agora é com você." A conversa vai para a aba **Em atendimento**, com o selo "Você". Se outra pessoa já tiver assumido, aparece "Fulano está atendendo esta conversa"; dono e gerente veem **Assumir mesmo assim** (com confirmação).
5. Escreva a resposta e toque em **Enviar** ⇒ "Enviado"; em segundos a mensagem aparece no simulador. A bolha mostra quem respondeu e a situação do envio (Enviando…, Enviada, Entregue, Lida; se falhar, **Tentar de novo**).
6. **Devolver à IA** ⇒ "Conversa devolvida à IA."; a próxima pergunta no simulador ("a Asa Sul está aberta agora?") é respondida pela IA.
7. **Encerrar** (com confirmação) tira a conversa da fila e ela vai para **Encerradas** (últimos 30 dias). Se o cliente escrever de novo, a IA começa uma **conversa nova**.
8. **Mostrar telefone** (só em conversa real) decifra o número no servidor e registra na auditoria, como nos pedidos de evento.
9. Fora da janela de 24 h (o cliente não escreve há mais de 24 h), o campo de resposta fica bloqueado com a explicação: o WhatsApp só permite responder quando o cliente mandar uma nova mensagem.
10. **Quem vê o quê:** dono (ou quem tem acesso a todas as unidades) vê todas as conversas, inclusive as que ainda não têm unidade. Gerente e atendente restritos a uma unidade só veem as conversas daquela unidade — nem pela lista, nem abrindo o endereço da conversa. A unidade da conversa é a última unidade que o cliente citou.
11. **Início:** o cartão "Aguardando atendente" leva à inbox e o número **Tempo até assumir (hoje)** mostra a mediana do dia (só conversas reais).

## 3. Avisos no navegador (painel aberto)
1. Em **Conversas**, toque em **Ativar avisos** e **permita as notificações** quando o navegador perguntar. Se o navegador bloquear, a tela explica como liberar nas configurações do site.
2. Ligue **Som de aviso** se quiser um som quando chegar conversa nova (a preferência fica neste aparelho).
3. Com o painel aberto em outra aba ou minimizado, uma nova conversa aguardando mostra a notificação "Nova conversa aguardando atendente" — o texto é fixo, **sem nome, telefone ou mensagem do cliente**.
4. Com o painel fechado não há aviso (e-mail/push ficam para depois).

## 4. Horário do atendimento humano (Mais → **Atendimento humano**; só o dono)
1. O `demo:s1` já deixa segunda a sexta, das 9h às 18h. Ajuste os turnos (até 4 por dia, inclusive madrugada), use **Copiar segunda para dias úteis** ou **para todos os dias** e **Salvar horário** ⇒ "Horário salvo".
2. No simulador, **Novo cliente**, **Simular data e hora** num sábado ao meio-dia, **Aplicar** e "quero falar com um atendente" ⇒ "Vou passar você para alguém da nossa equipe. Nossa equipe atende **na segunda a partir das 9h** e te responde assim que voltar." Dentro do horário, a mensagem é "… Já já te respondem por aqui."
3. Sem nenhum turno, a IA não promete horário: avisa só que a equipe vai responder.
4. Os textos de handoff (dentro do horário, fora do horário e cliente irritado) são editáveis em **Conteúdo → Mensagens**.

## 5. Respostas rápidas (Conteúdo → Mensagens → **Respostas rápidas**)
1. O `demo:s1` traz "Boas-vindas" e "Verificando". **Nova resposta**: título (só a equipe vê, até 40 caracteres) e texto (vai para o cliente como está escrito, até 1000), **Ativa** ⇒ "Resposta salva". Até 30 ativas; desligue **Ativa** para tirar da conversa sem apagar.
2. Numa conversa assumida, o botão **Respostas rápidas** (ao lado do campo) lista as ativas; escolher uma **preenche o campo** — revise e toque em **Enviar**.
3. Atendente vê a lista, sem editar.

## 6. Handoff automático
1. **Cliente irritado** (triagem v6, precisa de crédito): "já perguntei três vezes e ninguém responde, que atendimento péssimo" ⇒ "Desculpe pelo transtorno. Vou chamar alguém da nossa equipe…" e a conversa entra em Aguardando com "Cliente insatisfeito". Reclamação do restaurante que não é do atendimento ("que demora pra abrir, hein") **não** deve passar para a equipe. A qualidade dessa detecção é medida pelo `eval:frustracao` (seção 7).
2. **Falhas seguidas:** duas mensagens seguidas fora do escopo (ou erro da IA) ⇒ handoff com "IA não conseguiu responder".
3. **Limite de gasto da IA** atingido ⇒ handoff com "Limite de gasto da IA".

## 7. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm db:migrate && pnpm --filter @atd/db demo:s1   # prepare o banco de novo (com o bootstrap da seção 1, se pedir)
set -a; source .env; set +a             # PHONE_ENC_KEY e NEXT_PUBLIC_SUPABASE_URL do e2e
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/web e2e
```
Pare o worker local antes do e2e (`pgrep -af "worker/src/main"` não deve mostrar nada): ele sobe o próprio, com IA falsa, e a guarda acusa "Há um worker rodando neste banco" se outro estiver vivo. O e2e da inbox (`inbox.spec.ts`) cadastra uma resposta rápida, pede atendente no simulador e confere que a conversa aparece em Aguardando **numa segunda aba, sem recarregar**, assume, responde com a resposta rápida (que aparece no simulador como "simulado"), devolve à IA e vê a IA responder; confere que um gerente restrito a outra unidade não vê a conversa (nem pela URL); salva o horário humano e confere a mensagem de fora do horário com o relógio simulado; tudo em 360 px sem rolagem lateral. **Evite rodar o e2e entre 23:59 e 00:00 (horário de Brasília)** (ver `docs/homologacao/etapa-04.md`).

Com crédito no OpenRouter: `pnpm --filter @atd/ai eval:frustracao` (frases de cliente irritado × reclamações parecidas que não são do atendimento) e `eval:s1`–`eval:s4`, que medem a triagem **v6** por padrão (sem regressão em relação à v5).

## 8. Pendências (não bloqueiam a homologação local)
- **Áudio do cliente (transcrição):** melhoria futura (PLAN, "Melhorias futuras").
- **Resposta fora da janela de 24 h** precisa de template aprovado pela Meta — go-live (Etapa 09).
- **E-mail/push com o painel fechado:** fora desta etapa.
- **Realtime no Supabase hospedado:** conferir que as policies de `realtime.messages` e os triggers de broadcast (migrations 0030–0031) foram aplicados e que o Realtime privado está ligado no projeto.

## Se algo não funcionar
- A conversa não aparece sozinha em Aguardando: confira se **Mostrar simulações** está marcado (para simulação) e se a conversa é de uma unidade que você vê. Sem conexão com o Realtime o painel recarrega sozinho a cada 60 s.
- A resposta do atendente fica em "enviando": o worker está rodando? O Início mostra "IA: Online".
- A notificação não aparece: o navegador precisa ter permitido as notificações do site, e ela só aparece com o painel fora de foco (em foco, só o som e o contador).
- Erro do OpenRouter aparece em **Ver detalhes** do simulador. Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
