# Etapa 08 — Gastos, limites, LGPD e equipe no painel

> Spec aprovada em conversa em 06/10/2026. Processo acelerado (um ciclo). PRD §10 vence conflitos. Decisões do dono: limite **por negócio** (restaurante), configurável no painel; **simulação com limite próprio**; alertas **só no painel**; convite de equipe entra nesta etapa.

## 1. Critério de sucesso
- O dono configura no painel os limites (dia/mês) de IA, simulação e WhatsApp e o % de alerta; nada de valor fixo nem ajuste por SQL.
- Dono/gerente veem gastos em US$ e R$, relatório do mês e alertas de 80%/100%.
- Demonstrações nunca consomem o limite dos clientes reais.
- Pedidos do titular aparecem numa fila com prazo; acesso gera resumo; exclusão confirmada apaga/anonimiza em cascata.
- Retenção roda todo dia conforme prazos configuráveis.
- O dono convida gerente/atendente pelo painel.

## 2. Gastos e limites (Mais → Gastos e limites)
- **Limites:** por restaurante, escopos `ia`, `simulacao` (novo) e `whatsapp`, períodos dia e mês; campos `limite_usd` (> 0) e `alerta_pct` (1–100). Dono edita (auditado: `orcamento.limite_alterado` com valores antigos/novos); gerente só vê; atendente não vê. A coluna `acao` deixa de aparecer (o comportamento é sempre modo econômico).
- **Padrões no bootstrap:** IA 2/dia e 40/mês; simulação 1/dia e 10/mês; WhatsApp 1/dia e 20/mês (USD).
- **Cotação:** `restaurants.cotacao_usd_brl` (numeric, padrão 5,50), editável pelo dono; valores exibidos em US$ e R$ (R$ = US$ × cotação, só exibição).
- **Simulação:** reserva/liquidação de conversas simuladas usam o escopo `simulacao`. Sem saldo ⇒ o simulador mostra "Limite de simulação atingido hoje — ajuste em Gastos e limites" (a conversa simulada vai para modo econômico como hoje, sem afetar clientes reais).
- **Relatório do mês** (dono/gerente): por dia (custo real × simulação), por etapa (`triagem`, `ingestao`…), por modelo, por unidade (`conversations.unidade_contexto_id`; "sem unidade" à parte), custo médio por conversa real; mês selecionável (últimos 12).
- **Quadro "Gastos" no Início:** rótulo do provedor real (`OpenAI`/`OpenRouter`, vindo da configuração do servidor), US$ e R$, simulação à parte.

## 3. Alertas (só no painel)
- Ao reservar ou liquidar, se o contador cruzar `alerta_pct` ou 100% do limite, grava um alerta (tabela `budget_alerts`: restaurante, escopo, período, início do período, nível 80|100 — único por combinação) e audita `orcamento.alerta`.
- Dono/gerente veem faixa no topo do painel e cartão no Início enquanto o período durar ("IA: 82% do limite do dia"); botão "Ajustar limites".

## 4. Pedidos do titular (Mais → Privacidade)
- Fila de `data_subject_requests` (já gravada pelo worker): tipo, status, prazo (15 dias), dias restantes; alerta no Início quando faltarem ≤ 3 dias ou vencido. Dono/gerente operam; atendente não vê.
- **Acesso:** "Gerar resumo" monta, a partir do cliente, um texto com: nome de perfil, primeira e última interação, nº de conversas e mensagens, avisos de presença, pedidos de evento (sem notas internas), pedidos LGPD anteriores. Exibe e permite copiar/baixar (.txt). Telefone só se a pessoa clicar em "Mostrar telefone" (auditado). Marca o pedido `concluido` com `resolvido_por`.
- **Exclusão:** confirmação dupla ⇒ função de banco `app.excluir_titular(customer_id, ator)` (`security definer`, `search_path` fixo, uma transação): apaga mensagens e conversas do cliente; anonimiza `attendance_notices` (`customer_id` null, `nome` null, `anonimizado`) e `event_requests` (`customer_id`, `nome`, `notas_internas`, `tipo_texto`, `observacoes` limpos, `anonimizado`); apaga o `customers`; conclui o pedido; audita `lgpd.exclusao_executada` sem PII. Pedido de cliente já inexistente ⇒ conclui sem erro.
- **Negar/observar:** status `negado` com resposta curta (sem PII).

## 5. Retenção (job diário)
- Job `retencao.diaria` agendado no pg-boss do worker (diário, 03:00 America/Sao_Paulo), por restaurante, chamando `app.aplicar_retencao(restaurant_id, agora)` (`security definer`), em lotes, idempotente:
  - `messages` > N dias ⇒ apagar (conversas vazias e encerradas também);
  - simulações (clientes/conversas/mensagens/avisos/eventos/ai_runs `simulado`) > 7 dias ⇒ apagar;
  - `attendance_notices` > N dias após a data ⇒ anonimizar; `event_requests` > N dias após a data ⇒ anonimizar;
  - `ai_runs` > N dias ⇒ apagar; `customers` inativos > N dias (sem conversa nem pedido aberto) ⇒ apagar em cascata pela mesma lógica da exclusão;
  - `audit_log` > N dias ⇒ apagar (função dona; o `audit_log` continua append-only para os demais roles).
- Prazos lidos de `retention_settings`; dono edita em Mais → Privacidade (mínimos: mensagens ≥ 7, demais ≥ 30 dias; valores padrão atuais). Resumo de cada execução auditado (`retencao.executada` com contagens).

## 6. Equipe (Mais → Equipe)
- Lista de membros (nome, e-mail, papel, unidades, ativo, convite pendente).
- **Convidar** (só dono): e-mail, nome, papel `gerente|atendente`, unidades (todas ou lista). A Server Action valida e enfileira `equipe.convite`; o **worker** chama o convite do Supabase Auth com a chave de serviço (nunca no web) e cria `staff`; e-mail já cadastrado ⇒ erro amigável. Reenviar convite e **desativar/reativar** (desativado não entra: `staff.ativo` respeitado na DAL/RLS). Tudo auditado sem e-mail no `diff`.
- O dono não se desativa nem rebaixa a si mesmo.

## 7. Pendências incluídas
Teste de estresse do teto (reservas concorrentes nunca passam do limite); itens menores da Etapa 08 no PLAN (diff de `espaco.atualizado`, auditoria do simulador na transação).

## 8. Fora
E-mail/push de alerta; limite por unidade; preços de templates do WhatsApp (Etapa 09); runbook de incidente (Etapa 09); exportação legal assinada.

## 9. PRD
§5: escopo `simulacao`, cotação, alertas no painel. §3.8/§6.6–6.7: fila do titular, exclusão em cascata, retenção pelo pg-boss (sem `pg_cron`). Equipe por convite no painel via worker.
