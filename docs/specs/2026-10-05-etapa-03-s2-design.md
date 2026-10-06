# Etapa 03 — Avisos de presença (S2)

> Spec aprovada em conversa em 05/10/2026. Processo acelerado: um ciclo por etapa (spec → um plano enxuto → execução com revisão por bloco → homologação → PR). PRD §10 (invariantes) vence qualquer conflito.

## 1. Objetivo e critério de sucesso

O cliente avisa pelo WhatsApp que vai a uma unidade ("hoje vou na Asa Sul com 4 pessoas lá pelas 20h"); a IA registra ou cancela o aviso; a equipe vê a **previsão do dia** por unidade no painel. **Não é reserva** — é previsão de movimento; nada é garantido ao cliente.

Sucesso:
- No simulador, registrar, atualizar (mesmo cliente/unidade/dia) e cancelar avisos com respostas corretas e dados do banco.
- Dados faltando são pedidos um de cada vez (unidade pela lista do S1; "Para quantas pessoas?"), sem chamar o LLM de novo para a resposta curta.
- O painel "Previsão" mostra o total e a lista por unidade e dia; avisos simulados nunca aparecem.
- Evals S2 dentro das metas (§6).

## 2. Abordagem — igual ao S1 ("IA entende, código responde")

### 2.1 Extração (triagem v3)

Nova versão `triage-v3` (a v2 fica intacta; prompts versionados). O item extraído ganha campos para S2:

| Campo | Tipo | Uso |
|---|---|---|
| `servico` | enum (inalterado) | `aviso_presenca` |
| `tipo` | S1: tipos atuais; S2: `registrar` \| `cancelar` | ação |
| `unidade` | string \| null | nome/apelido como o cliente escreveu |
| `data` | string \| null | expressão de data ("hoje", "sábado", "11/10") — mesma resolução de datas do S1 |
| `pessoas` | inteiro \| null | quantidade, incluindo o cliente ("eu e minha esposa" = 2) |
| `horario` | string \| null | "20h", "às 19:30", "à noite" → normalizado no código para `HH:mm` quando possível |
| `tema` | inalterado (S1) | — |

Uma mensagem pode misturar S1 e S2 ("abre sábado? vou com 4"): cada item é resolvido e a composição junta as respostas (como no S1).

### 2.2 Resolução determinística (`@atd/core/s2`, puro, sem fetch/DB)

**Registrar:**
1. Unidade: busca do S1 (`busca.ts`); ausente ou ambígua com várias ativas ⇒ lista interativa de unidades (pendente do S1, guardando o item S2). Uma só unidade ativa ⇒ assume.
2. Data: resolução de datas do S1 no fuso do restaurante; ausente ⇒ **hoje**. Fora de `[hoje, hoje+30]` ⇒ mensagem e não registra.
3. Pessoas: ausente ⇒ pergunta "Para quantas pessoas?" e guarda o item no pendente (expira em 30 min). A resposta curta seguinte ("4", "somos 5", "quatro") é lida por um parser determinístico (números de 1 a 60, por extenso até "vinte"), sem LLM. Fora de 1–60 ⇒ mensagem (acima de 60: sugere falar com a equipe/eventos).
4. Unidade fechada na data (horário do dia do S1, incluindo exceção e feriado) ⇒ informa que não abre e não registra.
5. Horário informado fora dos turnos do dia (considerando madrugada) ⇒ informa os horários daquele dia e não registra. Horário vago ("à noite") ⇒ guarda como texto livre curto, sem validar.
6. Registra (upsert no aviso ativo do mesmo cliente/unidade/dia) e responde com o resumo — **sem pedido de confirmação**: "Anotado: Asa Sul, sábado (11/10), 4 pessoas, por volta das 20h. Se mudar de ideia, é só me avisar." Atualização: "Atualizei seu aviso: …".

**Cancelar:** cancela o aviso ativo do próprio cliente para unidade/dia informados. Sem unidade/data e com **um** aviso ativo futuro ⇒ cancela esse; com vários ⇒ lista os avisos (texto) e pede qual; nenhum ⇒ "Não encontrei aviso ativo seu."

Todos os textos são **modelos editáveis** (aba Mensagens), com variáveis validadas como no S1. Itens S2 contam no indicador "% respondido pela IA" (válidos/respondidos).

### 2.3 Worker

- O aviso é gravado **na mesma transação** do commit da resposta (mesma garantia de I5/estado da conversa); `audit_log` com `atorTipo 'ia'`, `acao 'aviso.registrado' | 'aviso.atualizado' | 'aviso.cancelado'`, sem PII no `diff`.
- Conversa simulada ⇒ aviso gravado com `simulado = true` (exercita o pipeline real, nunca aparece na previsão).
- Orçamento: mesma reserva atômica da triagem; a resolução S2 não tem custo de IA.
- Relógio simulado do 02-C vale também para S2 (data "hoje" e validações).

## 3. Modelo de dados

`attendance_notices` (PRD §3.2) com dois acréscimos:

| Campo | Notas |
|---|---|
| id, restaurant_id, unit_id | FK compostas como no S1 |
| customer_id | nullable, `ON DELETE SET NULL` (aviso manual do painel não tem cliente) |
| nome | text nullable — nome de perfil do WhatsApp ou digitado no painel (para a equipe identificar) |
| data | `date` |
| pessoas | smallint, check 1–60 |
| horario_aprox | text nullable (`HH:mm` ou texto curto ≤ 40) |
| status | `ativo` \| `cancelado` |
| origem | `ia` \| `painel` |
| simulado | bool default false |
| anonimizado | bool default false |
| criado_por | uuid nullable (staff, quando origem `painel`) |
| timestamps | `timestamptz` |

Índices: único parcial `(customer_id, unit_id, data) WHERE status = 'ativo'`; `(restaurant_id, unit_id, data)` para a previsão; consulta da previsão com `EXPLAIN` revisado.

RLS: leitura pela equipe do restaurante respeitando unidade (mesma forma *initplan* do 02-C); escrita do painel só dono/gerente com permissão na unidade; `worker_app`/`web_app` pela policy `app_roles`. Anonimização após 30 dias da data (cron da Etapa 08): zera `customer_id` e `nome`, mantém unidade, data, pessoas.

## 4. Painel

- **Previsão** (novo item na barra inferior; 5 itens: Início, Previsão, Unidades, Respostas, Mais):
  - Seletor de dia (hoje por padrão; ±30 dias) e de unidade (só as permitidas).
  - Por unidade: total de pessoas e número de avisos ativos; lista com nome, pessoas, horário, origem (IA/painel); cancelados ocultos por padrão ("mostrar cancelados").
  - Dono/gerente: **Novo aviso** (unidade, data, pessoas, horário, nome — mesmas validações do §2.2, inclusive unidade aberta) e **Cancelar** com confirmação. Atendente só lê.
  - Estado vazio que ensina ("Nenhum aviso para hoje. Quando um cliente avisar pelo WhatsApp, aparece aqui."), skeleton, toast, foco, alvos ≥ 44 px, celular primeiro.
- **Início:** cartão "Previstos hoje" (total de pessoas, todas as unidades permitidas) com link para Previsão.
- **Mensagens:** novos modelos S2 aparecem na aba existente.
- **Simulador:** sem mudança de interface; "Ver detalhes" já mostra a execução.

## 5. Segurança e LGPD

- Base legal: execução de procedimento a pedido do titular (PRD §6). O aviso guarda o mínimo: nome de perfil, pessoas, horário.
- Nada de PII em log/Sentry; auditoria sem nome/telefone no `diff`.
- Toda Server Action: `requireStaff` + Zod + resultado tipado; permissão por unidade pela RLS.
- Cliente só cancela o **próprio** aviso (filtro por `customer_id` da conversa no worker).

## 6. Qualidade

### 6.1 Evals S2 (`packages/ai/evals/s2/`, mesmas duas camadas do S1)
- **Camada 2 (composição exata, CI):** ≥ 40 casos — registrar completo, sem pessoas (pergunta), sem unidade (lista), data relativa, fora de 30 dias, unidade fechada, horário fora do turno, atualização, cancelar com/sem dados, mistura S1+S2, "eu e minha esposa", número por extenso.
- **Camada 1 (extração com modelo real, job `evals-extracao`):** ≥ 30 frases reais de aviso/cancelamento e de não-aviso parecido ("vocês aceitam grupo de 10?" ⇒ não é aviso). Meta: ≥ 95% de extração correta.

### 6.2 Testes do sistema
- Unitários: resolução S2, parser de pessoas, normalização de horário.
- Banco: RLS por unidade e papel, upsert/único parcial, concorrência (dois avisos simultâneos do mesmo cliente não duplicam), isolamento da simulação.
- Worker: registrar/atualizar/cancelar, pendente de pessoas, simulação.
- E2E (celular, IA falsa do 02-C): no simulador, "vou hoje na <unidade> com 4 pessoas" recebe o resumo "Anotado…" e o aviso **não** aparece na Previsão (simulação isolada); um aviso manual criado no painel aparece no total do dia e some ao ser cancelado.

## 7. Critério de pronto
1. Simulador: registrar, atualizar, perguntar pessoas, escolher unidade pela lista, cancelar — respostas corretas.
2. Previsão por unidade/dia correta; aviso manual e cancelamento pelo painel; atendente só lê; gerente restrito só vê suas unidades.
3. Evals S2 dentro das metas; `pnpm check` e e2e verdes.
4. Homologação do dono pelo simulador e pelo celular.

## 8. Fora desta etapa
Notificação à equipe por aviso, lembrete ao cliente, limite de lotação por unidade, relatórios de previsão, anonimização automática (cron da Etapa 08).

## 9. Mudanças no PRD
§3.2 `attendance_notices`: colunas `nome`, `simulado`, `criado_por`, `horario_aprox` como texto curto. §4.3: S2 resolvido como S1 (triagem extrai, código resolve) — as tools `registrar_aviso_presenca`/`cancelar_aviso_presenca` viram funções do domínio chamadas pelo worker, não tools de LLM; o laço de tools do modelo principal fica para o primeiro serviço que precisar.
