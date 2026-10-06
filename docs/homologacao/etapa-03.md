# Homologação — Etapa 03 (avisos de presença, S2)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp e os avisos dele **nunca** entram na previsão.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # 4 unidades, horários, exceções e informações de demonstração
pnpm dev                                # painel em http://127.0.0.1:3000
WHATSAPP_ACCESS_TOKEN=local-sem-meta pnpm --filter @atd/worker dev   # outro terminal: o worker que responde o simulador
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes: `pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"` (com `SUPABASE_SERVICE_ROLE_KEY` exportada só no shell).

O simulador usa a IA de verdade (triagem **v3**) e precisa de `OPENROUTER_API_KEY` **com crédito** e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Sem crédito, toda mensagem cai no aviso de falha da IA — compre crédito antes de começar.

## 2. Simulador (botão verde do WhatsApp; dono ou gerente)
Use **Novo cliente** entre os blocos para começar do zero.

1. **Registrar:** "vou hoje na Asa Sul com 4 pessoas às 20h". A resposta começa com "Anotado:" e repete unidade, dia, pessoas e horário, terminando em "Se mudar de ideia, é só me avisar."
2. **Atualizar:** na mesma conversa, "na verdade seremos 6". Resposta começa com "Atualizei seu aviso:" e mantém unidade, dia e horário — continua um aviso só (um por cliente, unidade e dia). Sem dizer unidade nem dia, isso só vale quando o cliente tem **um** aviso ativo; com vários, ele precisa dizer a unidade e o dia ("na verdade seremos 6 no sábado na Asa Sul").
3. **Pessoas:** "vou amanhã na Asa Sul". Pergunta "Para quantas pessoas?"; responda "3" ⇒ "Anotado: …". Teste também "somos 80": a resposta explica o limite de 1 a 60 pessoas.
4. **Lista de unidades:** "vou sábado com 2 pessoas" (sem dizer a unidade). Aparece a lista; toque numa unidade ⇒ "Anotado: …".
5. **Dia ou horário fora:** um dia em que a unidade não abre ("vou na segunda", se estiver fechada) ou um horário fora do turno ⇒ a IA explica e pede outro dia/horário. Mais de 30 dias à frente ⇒ "Consigo anotar avisos de hoje até …".
6. **Cancelar:** "não vou mais" ⇒ com um aviso só, "Pronto, cancelei seu aviso: …"; com vários, a IA lista e pergunta qual. Sem nenhum aviso ⇒ "Não encontrei nenhum aviso ativo seu."
7. **Aviso + pergunta de horário na mesma mensagem:** "vou hoje na Asa Sul com 4 pessoas, até que horas vocês ficam abertos?" ⇒ uma resposta só, com o aviso anotado e o horário de hoje.
8. Abra **Previsão**: nenhum desses avisos aparece (são simulados).

## 3. Previsão (barra inferior)
1. A tela abre em **hoje**. Use as setas ou o campo de data para navegar até 30 dias à frente (não volta para dias passados). Com mais de uma unidade, filtre pelas abas.
2. **Novo aviso** (para quem avisou por telefone ou balcão): escolha unidade, dia, pessoas, horário (opcional, dentro do funcionamento) e nome (opcional). Salvar mostra "Aviso anotado." e o aviso aparece com o selo **Painel**; o resumo da unidade soma as pessoas.
3. Tente salvar com dia em que a unidade não abre ou horário fora do turno: o erro aparece no campo certo, nada é gravado.
4. **Cancelar** (×) pede confirmação; o aviso sai da lista e o total volta. **Mostrar cancelados** exibe os cancelados riscados.
5. **Início**: o cartão **Previstos hoje** mostra o total de pessoas de hoje e o atalho "Ver previsão".
6. Entre como **gerente** restrito a uma unidade: vê e edita só a sua unidade. Entre como **atendente**: vê a previsão, sem "Novo aviso" e sem cancelar.
7. **Mais → Mensagens**: os textos dos avisos (Aviso anotado, Aviso atualizado, Perguntar quantas pessoas…) podem ser editados como os do S1.

## 4. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm --filter @atd/web e2e              # pare o worker local antes: o e2e sobe o próprio, com IA falsa
```
Depois do `pnpm check`, prepare o banco de novo (seção 1): `pnpm db:migrate`, o **bootstrap** do restaurante e o `demo:s1`.

Os evals do S2 de composição (sem custo) rodam no `pnpm test`; a extração com a IA de verdade (`pnpm --filter @atd/ai eval:s2`) só depois de comprar crédito no OpenRouter.

## Se o simulador não responder
- O worker está rodando? O Início mostra "IA: Online".
- Erro do OpenRouter aparece em **Ver detalhes**. Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
- Limite de gastos de IA atingido: ajuste `budget_limits` como em `docs/homologacao/etapa-02c.md`.
