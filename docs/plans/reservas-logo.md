# Reserva com lotação e logo do restaurante — plano de implementação

> **Para agentes:** use superpowers:subagent-driven-development. Processo acelerado: plano enxuto, revisão por bloco, revisão final + onda única de correções. Os passos usam checkbox (`- [ ]`).

**Objetivo:** o S2 vira reserva (nome, contato, horário HH:MM, status confirmada/cancelada/nao_veio) com limite diário de pessoas por unidade, garantido no banco sem corrida. O restaurante ganha uma logo enviada em Ajustes e exibida no menu, no topo do celular e no login.

**Arquitetura:** uma migration (0045+) cuida de colunas, enum, bucket `marca` e da retenção atualizada. A DAL ganha `registrarReserva` com `FOR UPDATE` na unidade. O core ganha o resolvedor da reserva, que pergunta um dado por vez no padrão do S3. Entra o prompt `triage-v7`, só de extração. O worker captura o telefone do texto bruto quando há pergunta de contato pendente. No painel mudam Agenda, Unidades e Ajustes.

**Stack:** TypeScript, Drizzle + drizzle-kit, Postgres/Supabase (RLS e Storage), Next.js 16 com Server Actions, pg-boss worker, Vitest e Playwright.

**Spec:** `docs/specs/2026-10-07-reservas-e-logo-design.md`. Leia a spec inteira antes de qualquer tarefa; os valores exatos estão lá.

## Global Constraints
- PRD §10 integral. Migrations só via `drizzle-kit` (`pnpm --filter @atd/db generate` / `generate:custom`); nunca editar migration aplicada (a última é 0044).
- RLS em toda tabela nova ou alterada. Toda Server Action verifica sessão, papel e unidade na DAL. `set_config` só parametrizado.
- O LLM só extrai. Unidade, data, lotação, horário e textos são decididos no código, com textos de `packages/core/src/s1/modelos.ts` (chaves novas) e override por `reply_templates`.
- A `triage-v6` não é editada; cria-se `triage-v7` (prompt, schema Zod e JSON schema).
- O telefone de contato nunca vai ao LLM nem a log. Ele é capturado do texto bruto no worker, cifrado com `encryptPhone` e revelado só por ação auditada.
- Limites: pessoas por reserva de 1 a 60; `capacidade_pessoas` de 1 a 5000 ou nulo; `regras_reserva` com no máximo 600 caracteres; logo PNG, JPG ou WebP com no máximo 1 MB, sem SVG, conferida pelos bytes.
- Reservas do simulador (`simulado = true`) contam lotação só entre si. O modo demonstração continua funcionando.
- Textos de UI e mensagens em pt-BR; "Reserva" substitui "Aviso" nas telas e na conversa.
- Worktree `~/harmony/ia-atendimento-ux`: servidor de desenvolvimento só na porta 3001 e e2e com `E2E_PORT=3001`. Nunca usar `pkill -f "next dev"`. Nunca mexer no checkout da `main`.
- Commits pequenos, em português, no imperativo, com o trailer da sessão.

## Review Focus
1. **Corrida nas últimas vagas.** Duas mensagens simultâneas disputam as últimas vagas; só uma grava, e a outra recebe a resposta de lotado. Teste de banco com duas transações (T1) e teste do worker trocando o texto quando o banco recusa (T4).
2. **Mudar uma reserva existente.** Aumentar as pessoas desconta a própria reserva da ocupação; diminuir nunca bloqueia. Testes na DAL (T1) e no core (T2).
3. **Número novo inválido ou com formatação variada.** Entradas como "(61) 9 9999-8888", "+55 61 99999-8888", "61999998888" e "não sei" são tratadas: na segunda falha a reserva usa o WhatsApp e avisa. Testes de `capturarTelefone` (T2) e do worker (T4).
4. **Horário fora do funcionamento ou "à noite".** O cliente recebe o horário do dia e a pergunta de novo; nada é gravado com horário inválido. Testes no core (T2).
5. **Logo extrema.** Um PNG de 4000×200 ou de 50×50 fica sempre no quadro de 32×32 sem estourar o menu; um arquivo `.png` que na verdade é SVG ou PDF é recusado. Testes de UI e da validação (T6).

---

### Task 1: Banco — migration, DAL da reserva com lotação, logo e retenção
**Files:** `packages/db/src/schema/s2.ts`, `schema/restaurant.ts`, `packages/db/migrations/0045_*.sql` (gerada; RLS, Storage e função de retenção em `generate:custom`), `packages/db/src/avisos.ts`, `painel-avisos.ts`, `painel-unidades.ts`, novo `packages/db/src/marca.ts`; testes `avisos.db.test.ts`, `painel-avisos.db.test.ts`, `s2-rls.db.test.ts`, novo `reserva-lotacao.db.test.ts`, `marca.db.test.ts`, retenção (`lgpd-funcoes.db.test.ts`).

**Produz:**
- `units.capacidadePessoas`.
- `restaurants.regrasReserva` (default = texto da spec §2) e `restaurants.logoPath`.
- `attendance_notices.contatoCifrado` e `.horario` (`time`).
- Enum `attendance_status` = `confirmada | cancelada | nao_veio`, migrando `ativo → confirmada` e `cancelado → cancelada`; o índice único parcial passa a ser `where status = 'confirmada'`.
- `registrarReserva(tx, { restaurantId, unitId, customerId, data, pessoas, horario, nome, contatoCifrado, simulado, origem, reservaId? })` → `{ ok: true, id, atualizou } | { ok: false, motivo: 'lotado', vagas: number }`. Executa `FOR UPDATE` em `units`, soma as reservas `confirmada` com o mesmo `simulado` (excluindo `reservaId`) e grava só se couber.
- `ocupacaoDoDia(tx, restaurantId, data, simulado)` → `Map<unitId, { ocupadas: number; capacidade: number | null }>`.
- `mudarStatusReserva(...)`: reconfirmar passa pela lotação.
- `revelarContatoReserva(...)`: audita `reserva.contato_visualizado`; sem `contatoCifrado`, revela o telefone do customer.
- `salvarRegrasReserva`, `salvarCapacidade` (dentro de `salvarUnidade`), `salvarLogo` e `removerLogo` em `marca.ts`.
- Bucket `marca`: público para leitura, 1 MB, PNG/JPEG/WebP. Gravação e remoção só por dono ou gerente no prefixo `<restaurant_id>/`.
- `app.aplicar_retencao` substituída para anular também `contato_cifrado` ao anonimizar.

- [ ] Testes que falham:
  - lotação: cabe, lotado com `vagas`, sem capacidade, aumento que desconta a própria reserva, simulado isolado, **duas transações concorrentes** (`Promise.all` com dois clientes; só uma grava);
  - migração do enum com dados antigos;
  - RLS de gerente restrito em outra unidade;
  - contato revelado e auditado;
  - policies do bucket `marca` (atendente não grava);
  - retenção anula o contato.
- [ ] Implementar e gerar a migration. EXPLAIN da soma da ocupação usando `attendance_previsao_idx` (anotar no relatório).
- [ ] Ajustar os chamadores existentes ao enum novo (`registrarAviso` e `cancelarAvisoDoCliente` delegam ou são renomeados; `previsaoDoDia` e o painel do Início).
- [ ] `pnpm check` → commit "Adiciona a reserva com lotação e a logo no banco".

### Task 2: Core — resolvedor da reserva, ofertas de lotado e captura de telefone
**Files:** `packages/core/src/s2/{tipos,resolver,atendimento,horario}.ts`, novo `s2/contato.ts`, `s1/modelos.ts` (chaves novas), testes ao lado; `apps/web/lib/modelos-tela.ts` (rótulos das chaves novas).

**Consome:** os tipos de vagas da T1 (como dado de entrada; o core não acessa o banco).

**Produz:**
- `CampoReserva = 'unidade' | 'data' | 'pessoas' | 'horario' | 'nome' | 'contato' | 'contato_numero'`.
- `PerguntaReserva { campo; item; unitId | null; tentativasNumero: number }`.
- `AcaoS2` 'registrar' com `{ unitId, data, pessoas, horario: 'HH:MM', nome, contato: 'whatsapp' | { numero: string }, atualiza, reservaId?, textoSeLotado }`.
- `ResultadoS2.perguntarReserva` no lugar de `perguntarPessoas`.
- Entrada `vagas: Map<unitId, { ocupadas; capacidade }>` mais horários do dia (do S1) para decidir lotado e horário válido.
- `capturarTelefone(textoBruto): string | null`: normaliza para E.164 BR e reaproveita a validação de `redact.ts`.
- Chaves novas: `reserva_pergunta_{data,pessoas,horario,nome,contato,contato_numero}`, `reserva_horario_fora`, `reserva_confirmada` (resumo + `{regras}`), `reserva_lotada`, `reserva_lotada_outras_unidades`, `reserva_lotada_grupo_menor`, `reserva_contato_invalido_whatsapp`, `reserva_cancelada`.

- [ ] Testes que falham:
  - ordem das perguntas e uma de cada vez;
  - item já completo vai direto para a confirmação;
  - horário fora do funcionamento e livre ("à noite");
  - lotado com as três ofertas, só as que existirem (outras unidades com vaga até 3, outro dia, grupo menor);
  - mudança (aumentar e diminuir);
  - cancelar;
  - mais de 60 vai para evento;
  - `capturarTelefone` com as variações da Review Focus 3;
  - segunda falha do número vai para WhatsApp com aviso.
- [ ] Implementar no padrão de `s3/resolver.ts` (`perguntaVisivel` e prioridade lista > reserva > evento em `atendimento.ts`).
- [ ] `pnpm check` → commit "Resolve a reserva no core com lotação e contato".

### Task 3: IA — `triage-v7` e evals da camada 2
**Files:** novo `packages/ai/src/prompts/triage-v7.ts`, `packages/ai/src/triage.ts` (`triageV7Schema`, `parseTriageV7`, `triageV7`, `TRIAGE_V7_PROMPT_VERSION`), `packages/ai/evals/s2/*` (casos de reserva) e `evals/triagem-v7.test.ts`.

**Produz:**
- No item `aviso_presenca`: `pessoas`, `horario` (texto como o cliente disse; o código normaliza), `nome` (string ≤ 80 ou null) e `contato_ok` (true / false / null).
- Intenções "reservar" e "vou com N" cobertas; `cancelar` igual à v6.
- O schema JSON e o Zod validam tudo; os demais campos são idênticos à v6.

- [ ] Testes que falham (parse, schema e casos da camada 2: cabe, lotado, contato sim/não, número novo — o LLM vê `[TELEFONE]` —, nome, cancelar, mais de 60).
- [ ] Implementar a v7 copiando a v6 (a v6 fica intacta) e ajustar só a seção do S2.
- [ ] `pnpm check` e `pnpm --filter @atd/ai eval` da camada 2 → commit "Adiciona a triage-v7 com a reserva".

### Task 4: Worker — v7, pendente da reserva, captura do contato e commit com lotação
**Files:** `apps/worker/src/jobs/process-conversation.ts`, `packages/db/src/schema/conversation.ts` (sem coluna nova; só o Zod do pendente no worker), testes `process-conversation-s2.db.test.ts` (+ novo `process-conversation-reserva.db.test.ts`).

**Consome:** T1 (`registrarReserva`, `ocupacaoDoDia`), T2 (resolvedor, `capturarTelefone`, `PerguntaReserva`), T3 (`triageV7`).

**O que faz:**
- Troca `triageV6` por `triageV7` e a versão gravada.
- `pendenteReservaSchema` substitui `pendentePessoasSchema`, com leitura compatível do pendente `pessoas` antigo.
- Respostas curtas a um pendente sem LLM, como `respostaDePessoas` hoje: pessoas, horário, sim/não do contato, número e nome.
- Com pendente `contato_numero`, chama `capturarTelefone(text)` no texto **bruto** antes de qualquer outra coisa. O número cifrado vai na ação; o texto mascarado é o que fica guardado na conversa.
- Lê `ocupacaoDoDia` antes de resolver.
- No commit, `registrarReserva`. Se vier `lotado` (corrida), troca o trecho pelo `textoSeLotado`, como o `textoSeFalhar` atual.
- Auditoria: `reserva.registrada`, `reserva.atualizada` e `reserva.cancelada`, sem PII.

- [ ] Testes que falham:
  - conversa completa até confirmar (texto com as regras);
  - lotado com oferta;
  - corrida (vaga ocupada entre resolver e commit muda o texto);
  - número novo cifrado no banco e ausente do log, do LLM falso e de `conversations.pendente`;
  - pendente antigo de pessoas ainda funciona;
  - simulador isolado.
- [ ] Implementar.
- [ ] `pnpm check` → commit "Liga a reserva no worker com a triage-v7".

### Task 5: Painel — Agenda de reservas, lotação em Unidades e regras em Ajustes
**Files:** `components/painel/agenda-dia.tsx`, `aviso-form.tsx` (vira formulário de reserva: nome e horário obrigatórios, contato opcional), novo `components/painel/reserva-detalhe.tsx`, `app/(painel)/agenda/{page,actions}.ts(x)`, `components/home/agenda-hoje.tsx`, `lib/agenda.ts`, `lib/previsao.ts`, `lib/schemas/*`, `components/painel/dados-unidade-form.tsx` + `unidades/actions.ts`, `components/painel/restaurante-form.tsx` + `ajustes/actions.ts`, busca rápida (rótulo "Reserva"), testes de UI ao lado.

**O que faz:**
- Ocupação por unidade no topo do dia ("147/150" ou "sem limite").
- Linhas com horário, nome, pessoas e etiqueta de status (EtiquetaStatus: CONFIRMADA, CANCELADA, NÃO VEIO).
- Detalhe com "Ver contato" (auditado) e as ações Confirmada, Cancelada e Não veio, pelos papéis atuais dos avisos. Reconfirmar sem vaga mostra mensagem.
- Unidades: campo "Lotação máxima (pessoas por dia)".
- Ajustes: "Regras da reserva" com contador de 600 e "Restaurar padrão" (atendente não vê).

- [ ] Testes de UI e de actions que falham (papéis, lotado ao reconfirmar, 600 caracteres, capacidade inválida).
- [ ] Implementar no visual do redesenho; celular com a navegação atual.
- [ ] `pnpm check` → commit "Mostra as reservas, a lotação e as regras no painel".

### Task 6: Logo do restaurante
**Files:** `components/painel/restaurante-form.tsx` (ou novo `logo-form.tsx`), `app/(painel)/ajustes/actions.ts`, `apps/web/lib/server/upload-arquivo.ts` (bucket `'marca'` na união e `validarImagemLogo(bytes)` por bytes mágicos), `app/(painel)/layout.tsx` (lê `logoPath` e monta a URL pública), `components/shell/{app-shell,menu-lateral,top-bar}.tsx`, novo `components/shell/logo-restaurante.tsx`, `app/(auth)/login/page.tsx` + `components/auth/auth-card.tsx` (logo e nome só com exatamente um restaurante; leitura no servidor pelo papel do web com consulta mínima de `nome` e `logo_path`, sem expor outros dados), testes ao lado.

**Consome:** T1 (`salvarLogo`, `removerLogo`, bucket `marca`, `restaurants.logoPath`).

- [ ] Testes que falham:
  - recusa SVG, PDF renomeado e arquivo com mais de 1 MB;
  - aceita PNG, JPG e WebP;
  - `LogoRestaurante` com 32×32 `object-contain` e `alt`;
  - menu aberto, recolhido (logo no lugar das iniciais) e sem logo (idêntico ao de hoje);
  - top bar do celular com 24 px;
  - login com um restaurante (logo) e com dois (sem logo);
  - atendente não vê o controle.
- [ ] Implementar. Ao trocar ou remover, apagar o objeto anterior só depois do banco gravar.
- [ ] `pnpm check` → commit "Adiciona a logo do restaurante no menu, no celular e no login".

### Task 7: e2e e registros
**Files:** `apps/web/e2e/s2.spec.ts` (reserva), `e2e/desktop/painel-desktop.spec.ts`, novo `e2e/logo.spec.ts`, fixtures `e2e/openrouter-falso.ts` (respostas da v7), `docs/homologacao/reservas-logo.md`, `PLAN.md` (seção da melhoria com evidência), `PRD.md` (modelo de dados do S2 e "Melhorias futuras": lembrete pelo WhatsApp com modelo da Meta), `CLAUDE.md` "Onde paramos" + `cp CLAUDE.md AGENTS.md`.

- [ ] e2e celular e desktop:
  - reserva pelo simulador até a confirmação com as regras;
  - lotado (capacidade baixa definida em Unidades) com alternativa;
  - equipe marca "Não veio" e a ocupação cai;
  - envio da logo, que aparece no menu e no login, e remoção.
  
  Limpar no `afterAll` tudo o que for criado (unidades `E2E %`, logo, capacidade). Não deixar o modo demonstração diferente do estado inicial.
- [ ] Rodar a suíte completa com `E2E_PORT=3001` e `pnpm check` → commit "Adiciona o e2e e o roteiro da reserva e da logo".

**Blocos:** A = T1 e depois T2 e T6 em paralelo (T6 só depende da T1) · B = T3 → T4 · C = T5 · D = T7 → revisão final → onda única de correções → re-revisão.
