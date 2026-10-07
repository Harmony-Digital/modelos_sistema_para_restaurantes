# Reserva com controle de lotação e logo do restaurante

> Spec aprovada em conversa com o dono em 07/10/2026. Branch `reservas-logo` (worktree `~/harmony/ia-atendimento-ux`). PRD §10 vale integralmente. Os conflitos se resolvem a favor do invariante do PRD.

## 1. Objetivo e critério de sucesso
- O **aviso de presença (S2) vira reserva**. O cliente avisa que vai a uma unidade num dia, com N pessoas e um horário. A IA registra a reserva com nome e contato. A reserva **não escolhe mesa**: ela garante lugar para N pessoas.
- **Controle de lotação.** Cada unidade pode ter um limite fixo de pessoas por dia. Exemplo: com limite de 150 e 147 já reservadas, um pedido de 4 é recusado com alternativas.
- Depois de reservar, a IA envia as **regras**: um texto padrão, editável por dono e gerente, com tolerância de 15 minutos.
- A **logo do restaurante** é enviada em Ajustes e aparece ao lado do nome sem quebrar o layout.
- Todos os testes atuais continuam verdes. Os testes novos cobrem a lotação com concorrência, a conversa completa da reserva e a logo.

## 2. Reserva — dados (uma migration via `drizzle-kit`)
- `units.capacidade_pessoas smallint null`, com `check (capacidade_pessoas between 1 and 5000)`. Vazio significa sem controle de lotação, como hoje.
- `attendance_notices` (o nome da tabela fica; "reserva" é o nome na tela e na conversa):
  - `nome` passa a ser exigido em toda reserva nova. Os registros antigos continuam válidos.
  - Novo campo `contato_cifrado`: o telefone para contato, cifrado como o telefone de `customers` (mesma chave e mesma função), ou nulo quando é o mesmo número do WhatsApp do cliente. Ele é sempre derivado no servidor e nunca vem do LLM.
  - Novo campo `horario time null`: obrigatório na reserva nova, em HH:MM. O `horario_aprox` antigo fica só para leitura do histórico.
  - O status passa de `ativo | cancelado` para `confirmada | cancelada | nao_veio`, migrando os dados: `ativo` vira `confirmada` e `cancelado` vira `cancelada`. O índice único "uma reserva ativa por cliente, unidade e dia" passa a valer para `confirmada`.
- `restaurants.regras_reserva text not null`, com o padrão abaixo e no máximo 600 caracteres. Texto padrão:
  > "Sua reserva está confirmada! Guardamos o lugar por até 15 minutos após o horário marcado; depois disso, o espaço pode ser liberado para outros clientes. Se precisar cancelar ou mudar o número de pessoas, é só avisar por aqui."
- O limite por reserva continua de **1 a 60 pessoas**. Acima de 60, segue o fluxo de evento (S3), como hoje.
- RLS: as policies atuais da tabela continuam valendo. `capacidade_pessoas` e `regras_reserva` seguem as regras de edição de unidade e restaurante já existentes.

## 3. Reserva — lotação sem corrida
- **Ocupação de um dia** = soma de `pessoas` das reservas `confirmada` da unidade naquele dia, com o mesmo valor de `simulado`. As reservas do simulador contam só entre si.
- **Registrar** uma reserva, ou **aumentar** as pessoas de uma existente, acontece na transação do worker que grava a resposta:
  1. `select … from units where id = $1 for update`;
  2. soma a ocupação do dia, sem contar a reserva que está sendo alterada;
  3. só grava se `ocupação + pessoas ≤ capacidade` (ou se não há capacidade).
  Se não couber, nada é gravado e a resposta vira a de lotado. Diminuir pessoas ou cancelar nunca é bloqueado.
- O painel, ao marcar `confirmada` de novo uma reserva cancelada, passa pela mesma checagem. Se não couber, avisa e não muda.
- Teste de banco com **duas transações concorrentes** disputando as últimas vagas: só uma grava.

## 4. Reserva — conversa
- Entra um prompt novo, **`triage-v7`** (a `v6` não é editada). A intenção `aviso_presenca` passa a cobrir "quero reservar", "vou hoje com 4", "reserva para sábado". A IA só **extrai**: unidade, data, pessoas, horário, nome e a resposta sim/não sobre o contato. **O código decide** e monta as perguntas e respostas a partir de modelos de texto (como no S2 e no S3 de hoje).
- **Um dado por vez**, só o que faltar, nesta ordem: unidade, data, pessoas, horário, nome, contato. O padrão de pergunta pendente do S3 é reaproveitado.
  - **Horário:** HH:MM, dentro do horário de funcionamento da unidade naquele dia (o resolvedor do S1 já calcula). Fora do horário, a IA responde com o horário daquele dia e pergunta de novo.
  - **Contato:** a pergunta é "Posso usar este número do WhatsApp para falar com você sobre a reserva?". Sim: `contato_cifrado = null`. Não: a IA pede o número. O worker captura o telefone da **mensagem original, antes da redação de PII** (com a mesma validação de telefone da redação) e grava cifrado. A IA nunca vê o número. Se o número for inválido, a IA pede de novo; na segunda falha, segue com o número do WhatsApp e avisa.
- **Coube:** grava `confirmada`. A resposta traz o resumo (unidade, data, horário, pessoas, nome) seguido de `regras_reserva`.
- **Lotado:** a resposta diz que a unidade está cheia naquele dia e oferece, nesta ordem, só o que existir:
  - (a) outras unidades com vaga para N no mesmo dia, até 3;
  - (b) que o cliente escolha outro dia;
  - (c) um grupo menor, se ainda couber alguém ("temos vaga para até X pessoas").
  Nada é gravado.
- **Cancelar** ("não vou mais", "cancela minha reserva"): vira `cancelada`, como o cancelamento de hoje.
- **Mudar** pessoas ou horário de uma reserva confirmada: atualiza, passando pela lotação quando aumenta.
- Evals da triagem: a camada 2 ganha casos de reserva (cabe, lotado, contato sim/não, número novo, cancelar, mais de 60 pessoas para evento). A camada 1 continua dependendo de crédito no OpenRouter.

## 5. Reserva — painel
- **Agenda do dia:** "Avisos" passam a se chamar "Reservas". Cada linha mostra horário, nome, pessoas e status.
  - No topo, **ocupação por unidade** ("147/150"; "sem limite" quando não há).
  - Detalhe da reserva com **ver contato**, auditado como o telefone do evento (`reserva.ver_contato`). Ele mostra o número informado ou o do WhatsApp.
  - Ações **Confirmada**, **Cancelada** e **Não veio**, com auditoria e as mesmas regras de papel de hoje para avisos. "Cancelada" e "Não veio" liberam vagas na hora.
- **Unidades:** novo campo "Lotação máxima (pessoas por dia)".
- **Ajustes:** campo "Regras da reserva", com o padrão e um botão de restaurar o padrão. Dono e gerente editam; atendente não vê.
- Início, Agenda e a busca Ctrl+K usam o termo "reserva". O modo demonstração continua funcionando igual.

## 6. Reserva — LGPD
- O contato é cifrado e só é lido pelo "ver contato" auditado. O nome e o contato entram na **anonimização e na retenção** que já existem para avisos. Nada de nome nem telefone em log ou Sentry.
- A redação de PII antes do LLM continua igual. A captura do telefone acontece no worker, antes da redação, só quando há uma pergunta de contato pendente.

## 7. Logo do restaurante
- **Ajustes:** "Logo" com enviar, prévia, trocar e remover, só para dono e gerente. Aceita PNG, JPG ou WebP até **1 MB**; **SVG não**. Tipo e tamanho são conferidos no servidor pelo conteúdo, não pela extensão.
- **Armazenamento:** bucket `marca`, **público para leitura** (logo não é dado pessoal). O caminho é `<restaurant_id>/logo-<sha256>.<ext>`. A escrita é feita pela Server Action com verificação de papel na DAL, e as policies de Storage permitem gravar só no prefixo do próprio restaurante. O caminho fica em `restaurants.logo_path text null`. Trocar ou remover apaga o objeto anterior depois que o banco grava.
- **Exibição:** quadro **32×32** com `object-contain` (qualquer proporção, sem distorcer) e `alt` com o nome.
  - Menu lateral aberto: logo e nome (o nome é cortado com "…").
  - Menu recolhido: só a logo, no lugar das iniciais.
  - Topo do celular: logo de 24 px e nome.
  - Tela de login: logo e nome, **só quando existe exatamente um restaurante**. Sem logo ou com mais de um restaurante, a tela de login fica como hoje.
- Sem logo, o layout fica idêntico ao de hoje.

## 8. Fora do escopo
- Escolha de mesa.
- Limite por turno ou por faixa de horário.
- Limite diferente por dia da semana.
- CPF.
- **Lembrete automático pelo WhatsApp antes da chegada:** depende de modelo aprovado pela Meta. Fica registrado em "Melhorias futuras".
- SVG na logo.

## 9. Qualidade
- **TDD** em core (resolvedor da reserva, lotação, ofertas de lotado, captura de telefone), DB (lotação concorrente, migração de status, RLS, Storage) e UI (Agenda, Unidades, Ajustes, logo no menu, no celular e no login).
- **e2e celular e desktop:** reserva pelo simulador até a confirmação com as regras; lotado com alternativa; a equipe marca "Não veio" e a vaga volta; envio da logo, que aparece no menu e no login.
- `pnpm check` verde. Os evals da camada 2 (deterministas) ficam verdes com a `triage-v7`.
