# Homologação — Reserva com lotação e logo do restaurante (07/10/2026)

Roteiro curto para o dono. Spec: [docs/specs/2026-10-07-reservas-e-logo-design.md](../specs/2026-10-07-reservas-e-logo-design.md);
plano: [docs/plans/reservas-logo.md](../plans/reservas-logo.md). Branch `reservas-logo`. O **aviso de presença vira
reserva** (com nome, horário, contato e controle de lotação por unidade) e o painel ganha a **logo do restaurante**.

## 1. Preparar
```bash
pnpm db:migrate                       # migrations até a 0048 (0045–0048 são desta branch)
pnpm --filter @atd/db demo:s1         # unidades e dados de exemplo
pnpm dev                              # painel em http://127.0.0.1:3000
```
Worker em outro terminal, como em `docs/homologacao/etapa-08.md` (seção 1). **Depois das 0045–0048, a `main` antiga
não roda mais neste banco** (o status da reserva mudou de nome): use esta branch até o merge.

## 2. Roteiro

| # | Faça | Esperado |
|---|---|---|
| 1 | Entre como **dono** → **Unidades** → Asa Norte → **Lotação máxima (pessoas por dia)** = `10` → **Salvar unidade** | "Unidade salva". Vazio = sem limite (como antes) |
| 2 | **Ajustes** → **Regras da reserva** | Texto padrão com a tolerância de 15 minutos; contador até 600; **Restaurar padrão** volta ao texto original. Mude uma palavra e salve |
| 3 | **Ajustes** → **Modo demonstração** ligado (para ver o simulador na Agenda) | "Modo demonstração ligado" |
| 4 | Simulador: "quero reservar amanhã na Asa Norte às 20h para 4 pessoas" | A IA pergunta **um dado por vez** só o que falta: "Em nome de quem fica a reserva?" → responda "Maria Souza" → "Posso usar este número do WhatsApp para falar com você sobre a reserva?" → "sim" → **"Reserva feita: unidade Asa Norte, amanhã…, às 20h, 4 pessoas, em nome de Maria Souza."** seguida das **suas** regras (item 2) |
| 5 | Simulador, **Novo cliente**: "quero reservar amanhã na Asa Norte às 20h para 8 pessoas" | **Lotado**: "A unidade Asa Norte está lotada amanhã para 8 pessoas." + outras unidades com vaga naquele dia (até 3) + "Se preferir, me diga outro dia." + "ainda temos vaga para até 6 pessoas". Nada é gravado |
| 6 | Responda "6" → nome → "não" → "(61) 99999-8888" | A IA aceita o grupo menor sem repetir unidade, dia e horário; pede o número e confirma. Em **Conversas**, a mensagem com o número aparece como **[TELEFONE]** |
| 7 | Simulador: horário fora do funcionamento ("quero reservar amanhã na Asa Norte às 4h para 2") | A IA responde o horário da unidade naquele dia e pergunta de novo; nada é gravado |
| 8 | Simulador (cliente do item 4): "muda minha reserva para sábado" e depois "troca para a Asa Sul" | **"Reserva alterada: unidade …"** (sem repetir as regras). Na Agenda continua **uma** reserva, que muda de dia e de unidade; a lotação do novo dia/unidade é conferida (cheia ⇒ resposta de lotado e nada muda). Com **duas** reservas ativas, a IA lista as duas e pede para cancelar a que não vale |
| 8b | Simulador: "não vou mais" (no cliente do item 4) | "Pronto, cancelei sua reserva…" e a vaga volta |
| 9 | **Agenda** de amanhã, unidade Asa Norte | Topo **Lotação do dia** com "Simulação: x/10"; linhas com horário, nome, pessoas e status (Confirmada, Cancelada, **Não veio**). Abra uma reserva: **Ver contato** mostra o número com máscara, "+55 (61) 99999-8888" (informado ou do WhatsApp), e fica na auditoria. A reserva do simulador **com número informado** (a do item 6) tem o botão; a do simulador **sem número informado** não tem (o WhatsApp do simulador não é número de verdade) |
| 10 | Agenda de **hoje**, **Nova reserva** (nome e horário obrigatórios, contato opcional) e depois **Não veio** no detalhe | A ocupação real sobe e, com "Não veio", cai na hora. "Não veio" só fica disponível no dia da reserva ou depois. Reconfirmar uma cancelada sem vaga mostra "Restam N vagas" e não muda nada. Um "Não veio" marcado por engano num dia passado pode voltar a **Confirmada** (se ainda couber na lotação daquele dia) |
| 11 | **Ajustes** → **Logo** → envie um PNG/JPG/WebP (até 1 MB) | "Logo enviada"; aparece no menu lateral (com o nome, cortado com "…" se for longo), no menu recolhido (só a logo), no topo do celular (24 px) e na **tela de login** (logo e nome). Uma logo muito larga ou muito pequena fica sempre no quadrinho de 32×32, sem distorcer |
| 12 | Tente enviar um SVG, um PDF renomeado para `.png` ou um arquivo maior que 1 MB | Recusado com a mensagem certa; a logo atual não muda |
| 13 | **Remover logo** (confirmação) | Tudo volta ao layout de antes, inclusive o login ("Atendimento IA") |
| 14 | Entre como **gerente** e como **atendente** | Gerente: edita lotação, regras e logo e muda a situação das reservas. Atendente: vê a Agenda e o **Ver contato**, mas não vê Nova reserva, as ações de situação, as regras nem a logo em Ajustes |
| 15 | Desligue o modo demonstração | As reservas do simulador somem da Agenda (como antes) |

## 3. Decisões que o dono deve conhecer
- **"Tem mesa para 4?" agora é reserva:** com a lotação, a IA responde se cabe e segue perguntando os dados. Quem só
  queria saber recebe as perguntas da reserva.
- **Depois do "lotado", a reserva fica pendente:** "e no domingo?", "e na Asa Sul?" ou "6" continuam sem repetir tudo.
- **Com uma reserva ativa, "quero reservar para 4" sem unidade nem dia muda as pessoas dessa reserva.** Para uma
  segunda reserva, o cliente precisa dizer o dia ou a unidade.
- **"Muda/troca minha reserva para domingo / para a Asa Norte" move a reserva que já existe** (a triagem marca a
  intenção de mudança): com uma reserva ativa, ela muda de dia ou de unidade, com a lotação do destino conferida. Com
  várias reservas ativas, a IA não adivinha: lista as reservas e pede para cancelar a que não vale e pedir a nova.
  Sem dizer "muda/troca", "domingo também vou" continua sendo uma segunda reserva.
- **Mudança responde "Reserva alterada: …"** sem repetir as regras (elas já foram com a reserva feita). O texto é
  personalizável em Conteúdo → Mensagens ("Reserva alterada").
- **A mensagem com o número de contato fica guardada como [TELEFONE]** na conversa (minimização da LGPD). A equipe vê o
  número por **Ver contato**, que fica na auditoria. Se preferir ver o número na conversa, é um ajuste pequeno.
- **Textos personalizados das antigas mensagens "aviso_*" deixam de valer:** a tela Conteúdo → Mensagens agora mostra
  as mensagens da reserva (`reserva_*`). Quem tinha personalizado os textos do aviso precisa personalizar de novo.
- **Simulação conta só com simulação:** a lotação do simulador é separada da real (no topo da Agenda, "Simulação:
  x/cap" aparece à parte). A **Nova reserva** criada pelo painel é sempre real, mesmo com o modo demonstração ligado.
- **Cancelada ou Não veio** com "Mostrar cancelados" desligado fecha o detalhe (a linha sai da lista); para desfazer,
  ligue "Mostrar cancelados". O cliente não é avisado dessas mudanças.
- **Lotação garantida pelo app:** as gravações do painel e do worker passam pela trava; uma alteração feita
  diretamente no banco por dono/gerente fora do app não passa.
- **Exportação dos dados do titular** traz, de cada reserva, data, horário, unidade, pessoas, o nome da reserva, a
  situação e "telefone de contato informado: sim/não" — **sem o número** decifrado (ruling); exclusão e retenção
  apagam nome e contato da reserva.
- **WhatsApp antigo sem o nono dígito:** quem digita o próprio celular com o 9 é reconhecido como o mesmo número (não
  vira "Número informado pelo cliente").
- **Busca rápida (Ctrl+K):** "reserva" leva à Agenda; buscar reservas pelo nome do cliente ficou fora (dado pessoal,
  sem índice). Ache a reserva pelo dia na Agenda.
- **Logo:** sem SVG; o leitor de tela lê o nome uma vez só (a logo é decorativa quando o nome está ao lado).
- **Ver contato** mostra o número com máscara ("+55 (61) 99999-8888"); o telefone do pedido de evento continua como
  estava.
- **Política de privacidade (`/privacidade`) — revisar:** recebeu só a atualização factual (reservas guardam o nome e
  o telefone de contato, cifrado; anonimizadas 30 dias após a data). **O texto continua rascunho e precisa da revisão
  jurídica** (Etapa 09), inclusive o trecho sobre retenção pelos provedores de IA (a OpenAI retém por 30 dias).

## 4. Fora desta entrega (registrado)
- **Lembrete automático pelo WhatsApp antes da chegada:** depende de um modelo de mensagem aprovado pela Meta (o
  lembrete sai fora da janela de 24 h). Está em "Melhorias futuras" (PLAN e PRD).
- Escolha de mesa, limite por turno ou faixa de horário, limite diferente por dia da semana, CPF e SVG na logo.
- Corrigidos na onda final: capacidade omitida por um formulário antigo não apaga mais a lotação; "Dia passado: …
  marcar quem não veio" só para quem pode marcar; telefone com pontos ("61.99999.8888") é redigido antes da IA e
  capturado como contato; o teste de ponta a ponta do painel usa amanhã (sem a janela da meia-noite).
- Fica como está: o nome da reserva com resíduos de uma tentativa de injeção ("Ana script http golpe.example") é
  gravado só com letras e pontuação de nome (sem tag nem link clicável).

## 5. Publicação (amostra)
Ordem obrigatória (a 0045 não é compatível com o worker anterior): **parar o worker → migrations 0045–0048 → subir o
worker novo → publicar a web**. Detalhes em `docs/runbooks/producao-amostra.md` (passo 2) e `docs/runbooks/deploy.md`
(seção 2). O bucket público `marca` é criado pelas migrations; `scripts/producao/verificar.sh` confere.
