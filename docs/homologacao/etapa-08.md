# Homologação — Etapa 08 (gastos, limites, LGPD e equipe)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp. Nesta etapa o painel ganha três telas em **Mais** (só dono e gerente veem):

- **Gastos e limites:** limites de gasto por dia e por mês da IA (clientes), da **Simulação** (novo: o simulador tem limite próprio e nunca gasta o limite dos clientes) e do WhatsApp; cotação do dólar; relatório do mês. Alertas de 80% e 100% aparecem no topo do painel e no Início.
- **Privacidade (LGPD):** fila de pedidos dos clientes (acesso, exclusão, correção) com prazo de 15 dias; resumo de acesso; exclusão definitiva; prazos de guarda dos dados (a limpeza roda sozinha todo dia às 03:00).
- **Equipe:** o dono convida gerente e atendente pelo e-mail, reenvia o convite e desativa/reativa o acesso.

Nada disso precisa mais de SQL: limites e equipe são configurados pelo painel.

## 1. Preparar
```bash
pnpm db:migrate                       # migrations até a 0037
pnpm --filter @atd/db demo:s1         # unidades, cardápio, horário da equipe, respostas rápidas e 1 pedido de LGPD de exemplo
pnpm dev                              # painel em http://127.0.0.1:3000
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes, com a chave de serviço só no shell (nunca no `.env`):
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"
```
O bootstrap cria os limites padrão: IA US$ 2/dia e US$ 40/mês; Simulação US$ 1/dia e US$ 10/mês; WhatsApp US$ 1/dia e US$ 20/mês. Restaurantes que já existiam ganharam os limites da Simulação pela migration.

**Worker** (outro terminal). Ele responde o simulador, envia os **convites de equipe** (a chave de serviço do Supabase fica só nele) e agenda a **limpeza diária** (retenção, às 03:00). A chave vem do `supabase status` na hora e **não fica gravada em arquivo**:
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY WHATSAPP_ACCESS_TOKEN=local-sem-meta \
  pnpm --filter @atd/worker dev
```
O simulador usa a IA de verdade (OpenRouter no local) e precisa de `OPENROUTER_API_KEY` **com crédito** e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Os e-mails do Supabase local (convites) chegam no **Mailpit**: http://127.0.0.1:54324.

## 2. Gastos e limites (Mais → **Gastos e limites**)
1. **Limites:** um bloco por tipo — **IA (clientes)**, **Simulação** ("conversas de teste no simulador; não afeta os clientes") e **WhatsApp** — cada um com o dia e o mês: quanto já foi usado ("Usado hoje: US$ 0,0123 · R$ 0,07 (1%)"), **Limite (US$)** e **Avisar em (%)**. Mude um valor e toque em **Salvar limite do dia/mês** ⇒ "Limite do dia salvo". Valores aceitos: limite maior que zero e até US$ 10.000 (vírgula ou ponto), aviso de 1% a 100%. A mudança fica na auditoria (valor antigo e novo).
2. **Cotação do dólar (R$):** só para mostrar os valores em reais (limites e cobrança continuam em dólar). Mude para 5,25 e **Salvar cotação** ⇒ "Cotação salva"; o Início passa a mostrar "Cotação usada: US$ 1 = R$ 5,25".
3. **Relatório do mês:** escolha o mês (últimos 12). Mostra o total dos clientes e o da simulação, separados, em US$ e R$; custo médio por conversa com cliente; tabelas por dia (clientes × simulação), por etapa, por modelo e por unidade ("Sem unidade" à parte). Mês sem gasto mostra de onde vêm os custos.
4. **Gerente** vê tudo, mas com os campos desabilitados ("Só o dono altera os limites e a cotação."). **Atendente** não vê a tela nem o atalho.
5. **Início → Gastos:** linhas "IA (clientes)" com o provedor real (OpenRouter no local, OpenAI em produção), WhatsApp, Total e **Simulação** à parte ("Testes no simulador, fora do total"), cada valor em US$ e R$.

## 3. Limite da simulação e alertas
1. Faça uma pergunta no simulador (gera um gasto pequeno de simulação).
2. Em **Gastos e limites → Simulação**, ponha o **Limite do dia** em `0,000001` (menor que o já gasto) e salve.
3. No simulador, **Novo cliente** e outra pergunta ⇒ aparece "**Limite de simulação atingido hoje — ajuste em Gastos e limites**" (com link). A conversa simulada vai para a equipe (modo econômico), como acontece com o limite da IA.
4. Enquanto isso, **clientes reais continuam sendo atendidos**: o limite da simulação não toca no limite da IA (o e2e confere isso com uma conversa real no mesmo minuto).
5. **Alerta:** no topo do painel aparece a faixa "**Simulação: N% do limite do dia** — modo econômico até o próximo período ou até aumentar o limite", com **Ajustar limites**; o Início mostra o cartão **Alertas de gasto** com todos os alertas do período. Ao chegar a 80% (ou o % configurado) aparece o aviso de 80%. Os alertas valem até o fim do dia/mês; só dono e gerente veem. Não há e-mail nem push. **A faixa não se atualiza sozinha:** um alerta novo aparece ao recarregar a página (ou ao abrir o painel de novo).
6. Volte o limite do dia da Simulação para 1,00.

## 4. Privacidade (Mais → **Privacidade (LGPD)**)
1. **Pedidos dos clientes:** o `demo:s1` deixa um pedido de **Acesso aos dados** do "Cliente de demonstração (LGPD)", recebido hoje, "Faltam 15 dias". Os pedidos chegam pelo WhatsApp (o pré-filtro reconhece frases como "quero apagar meus dados", sem chamar a IA) e ficam em aberto em ordem de prazo; os resolvidos ficam em **Resolvidos (N)**.
2. **Prazo:** 15 dias. Com 3 dias ou menos o prazo fica em destaque, e o **Início** mostra o cartão **Pedidos de privacidade (LGPD)** ("1 pedido vence em até 3 dias" / "1 pedido vencido") com **Ver pedidos**.
3. **Acesso:** **Gerar resumo** abre o texto para o cliente (nome no WhatsApp, primeira e última interação, número de conversas e mensagens, avisos de presença, pedidos de evento sem notas internas, pedidos de LGPD). **Copiar**, **Baixar .txt** e **Mostrar telefone** (cada consulta fica registrada). O telefone não entra no texto. **Marcar como concluído** fecha o pedido.
4. **Exclusão:** **Excluir dados** explica o que será apagado (conversas e mensagens, inclusive uma em atendimento; cadastro e telefone) e o que fica anonimizado (avisos e pedidos de evento continuam na agenda, sem nome, observações e notas). Só libera **Excluir definitivamente** depois de digitar `EXCLUIR`. O resultado mostra as contagens ("Dados excluídos: 3 mensagens, 1 conversa, 1 aviso e 0 pedidos de evento."). A auditoria registra só as contagens, sem dados pessoais. Para testar, crie um pedido de exclusão para o cliente de demonstração com o SQL de apoio abaixo (um pedido feito no simulador é de um cliente simulado, que a limpeza diária já apaga depois de 7 dias).
5. **Correção:** a tela orienta corrigir o dado pelo atendimento (conversa ou agenda) e **Concluir correção** com a resposta ao cliente.
6. **Negar:** pede uma resposta curta ao cliente (sem dados pessoais).
7. **Prazos de guarda dos dados:** dono edita por linha (mensagens, avisos, pedidos de evento, uso da IA, clientes sem contato, auditoria); mínimos de 7 dias para mensagens e 30 para os demais, máximo 3650. Gerente só vê. Áudio é fixo (descartado depois de transcrever).
8. **Limpeza diária (retenção):** o worker roda às 03:00 (horário de Brasília), em lotes, e pode rodar de novo no mesmo dia sem apagar nada a mais. Apaga mensagens vencidas, **simulações com mais de 7 dias**, registros de uso da IA e auditoria vencidos e clientes sem contato (salvo quem está em atendimento humano ou tem pedido de LGPD em aberto); anonimiza avisos e pedidos de evento vencidos. Cada execução fica na auditoria com as contagens (`retencao.executada`). Para rodar agora, sem esperar as 03:00:
   ```bash
   set -a; source .env; set +a
   psql "$DATABASE_URL" -c "select app.aplicar_retencao((select id from restaurants limit 1), now())"
   ```

SQL de apoio (pedido de exclusão para o cliente de demonstração):
```bash
psql "$DATABASE_URL" -c "insert into data_subject_requests (restaurant_id, customer_id, tipo)
  select restaurant_id, id, 'exclusao' from customers where wa_id_hash = 'demo-lgpd:titular'"
```
Depois de excluir, rode o `demo:s1` de novo para recriar o cliente de demonstração.

## 5. Equipe (Mais → **Equipe**)
1. A lista mostra cada pessoa com nome, papel, e-mail, unidades e situação ("Ativo", "Convite enviado, aguardando o primeiro acesso", "Enviando o convite…", "Falha ao enviar o convite").
2. **Convidar** (só o dono): nome, e-mail, papel (**Gerente** ou **Atendente**) e unidades (**Todas as unidades** ou algumas) ⇒ **Enviar convite** ⇒ "Convite enviado". Em segundos o worker envia o e-mail (abra o Mailpit em http://127.0.0.1:54324) e a pessoa aparece como "Convite enviado, aguardando o primeiro acesso". O link leva a **Definir senha**; gerente cadastra o autenticador (TOTP) no primeiro acesso.
3. E-mail que já está na equipe ou com convite em aberto ⇒ erro no campo e-mail, sem convite duplicado. Se a pessoa já tem conta (de outro convite antigo), o worker só vincula — ela entra com a senha que já tem.
4. **Reenviar convite** para quem ainda não entrou (ou cujo envio falhou). O Supabase limita quantos e-mails saem por hora; se aparecer "Falha ao enviar o convite", espere e reenvie.
5. **Desativar** (com confirmação) tira o acesso na hora (a pessoa não entra mais); **Reativar** devolve. O dono não desativa a si mesmo nem aparece com botões sobre si.
6. **Gerente** vê a lista sem botões; **atendente** não vê o atalho nem abre a tela.
7. Tudo fica na auditoria **sem e-mail nem nome**.

## 6. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm db:migrate && pnpm --filter @atd/db demo:s1   # prepare o banco de novo (com o bootstrap da seção 1, se pedir)
set -a; source .env; set +a             # PHONE_ENC_KEY e NEXT_PUBLIC_SUPABASE_URL do e2e
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/web e2e
```
Pare o worker local antes do e2e (`pgrep -af "worker/src/main"` não deve mostrar nada): ele sobe o próprio, com IA falsa (caminho de produção, `AI_PROVIDER=openai`, servidor falso). O e2e da etapa (`gastos-lgpd.spec.ts`), em 360 px sem rolagem lateral:
- o dono muda a cotação (o Início mostra R$ 5,25) e baixa o limite do dia da Simulação abaixo do já gasto; a pergunta seguinte no simulador mostra "Limite de simulação atingido hoje"; uma conversa **real** inserida no banco no mesmo minuto é respondida pela IA (escopo `ia`); a faixa "Simulação: N% do limite do dia" aparece no topo;
- pedidos do titular vencidos (inseridos no banco) aparecem no cartão do Início; o resumo de acesso traz nome e contagens e é concluído; a exclusão só sai com `EXCLUIR` e apaga cliente e conversa (que estava aguardando atendente), anonimiza o aviso de presença, conclui os pedidos e audita sem dados pessoais; a caixa de Conversas continua abrindo;
- a retenção, chamada direto pela função (como o agendamento das 03:00), apaga a simulação de 10 dias e poupa a de 1 dia, e a segunda execução não apaga mais nada;
- o dono convida uma atendente: o worker do e2e chama o convite do **Supabase Auth local** (o mesmo caminho de produção), o membro aparece no banco e o e-mail chega no Mailpit; convite repetido para o mesmo e-mail dá erro no campo;
- o gerente vê Equipe e Gastos só para leitura; a atendente não vê os atalhos.

**Evite rodar o e2e entre 23:59 e 00:00 (horário de Brasília)** (ver `docs/homologacao/etapa-04.md`). O e2e devolve no fim os limites da Simulação e a cotação que estavam antes.

## 7. Pendências (não bloqueiam a homologação local)
- **E-mail/push de alerta de gasto:** fora desta etapa (alertas só no painel).
- **Limite por unidade:** fora; o limite é do restaurante.
- **Preços de templates do WhatsApp:** go-live (Etapa 09).
- **Política de privacidade, LIA e RIPD revisados pelo jurídico** e runbook de incidente: Etapa 09.
- **Pool de conexões em produção:** o worker abre até 14 conexões (11 + 3 do pg-boss) no pooler de sessão do Supabase; confira o limite do plano (ver `docs/runbooks/producao-amostra.md`).
- **Convites em produção:** o SMTP padrão do Supabase só entrega para membros da organização e com poucos envios por hora; para convidar a equipe de verdade, configure SMTP próprio.
