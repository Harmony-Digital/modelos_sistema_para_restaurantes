# Homologação — Etapa 04 (eventos, S3)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp e os pedidos dele **nunca** entram na fila de Eventos nem nas contagens. A IA **nunca** confirma um evento: ela registra o pedido e diz que a equipe vai entrar em contato.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # 4 unidades, horários, exceções e informações de demonstração
pnpm dev                                # painel em http://127.0.0.1:3000
WHATSAPP_ACCESS_TOKEN=local-sem-meta pnpm --filter @atd/worker dev   # outro terminal: o worker que responde o simulador
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes: `pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"` (com `SUPABASE_SERVICE_ROLE_KEY` exportada só no shell).

O simulador usa a IA de verdade (triagem **v4**) e precisa de `OPENROUTER_API_KEY` **com crédito** e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Sem crédito, toda mensagem cai no aviso de falha da IA.

## 2. Espaços (Unidades → uma unidade → aba **Espaços**; dono ou gerente)
1. Sem espaços, a aba explica para que servem ("Nenhum espaço cadastrado").
2. **Novo espaço**: cadastre na Asa Sul um "Salão" de 20 a 80 pessoas e uma "Varanda" de 10 a 30, com descrição e condições. Tente mínimo maior que o máximo: aparece "A capacidade mínima não pode ser maior que a máxima." e nada é gravado.
3. O interruptor **Ativo** desativa o espaço (some para a IA, continua na lista como "Inativo"); o lápis edita. Não existe apagar.
4. Como **atendente**, a aba mostra os espaços, sem **Novo espaço** e sem editar.

## 3. Simulador (botão verde do WhatsApp; dono ou gerente)
Use **Novo cliente** entre os blocos para começar do zero.

1. **Pedido completo:** "quero fazer um aniversário para 40 pessoas na Asa Sul dia 20/10". Resposta: "Recebemos seu pedido de aniversário para 40 convidados na unidade Asa Sul, … Nossa equipe vai entrar em contato para confirmar." e, sem espaço citado, a lista dos espaços que comportam 40 pessoas. Em nenhum momento aparece "reservado" ou "confirmado".
2. **Coleta em várias mensagens:** "quero fazer uma festa". A IA pergunta uma coisa por vez, na ordem unidade (lista "Ver unidades") → "Para qual data é o evento?" → "Para quantos convidados?" → "Qual o tipo do evento? …". Responda curto ("sábado", "uns 40", "casamento"): a triagem recebe a pergunta pendente e entende. No fim, "Recebemos seu pedido…". A pergunta pendente vale 60 minutos.
3. **Espaço citado que não comporta:** "quero uma confraternização para 60 pessoas na varanda da Asa Sul dia 25/10" ⇒ "O espaço Varanda recebe de 10 a 30 pessoas. Para 60 pessoas, sugiro: Salão. Qual espaço prefere? …". Responda "pode ser qualquer um" ou "salão" ⇒ registra.
4. **Data fora:** "hoje" ou mais de 1 ano à frente ⇒ "Consigo registrar pedidos de evento de amanhã até …". Mais de 1000 convidados ⇒ "Consigo registrar eventos de 1 a 1000 convidados…".
5. **Unidade fechada no dia:** um dia em que a unidade não abre **não** bloqueia (evento é privado); o pedido sai com a observação "Unidade fechada nesse dia pelo horário cadastrado" para a equipe.
6. **Espaços:** "quais espaços vocês têm na Asa Sul?" ⇒ "Espaços para eventos:" com capacidade, descrição e condições. Numa unidade sem espaços, a pergunta vira lacuna em **Respostas → Sem resposta** (`eventos:espacos`).
7. **Cancelar:** "cancela meu pedido de evento" ⇒ com um pedido só, "Pronto, cancelei seu pedido de evento: …"; com vários, a IA lista e mostra uma frase de exemplo; sem nenhum, "Não encontrei pedido de evento seu em andamento.". Pedido **confirmado** pela equipe não é cancelado pela IA: "Esse evento já foi confirmado pela equipe. Vou chamar um atendente…" e a conversa vai para atendimento humano.
8. Abra **Agenda → Eventos**: nenhum desses pedidos aparece (são simulados) e a aba não conta "novos" por causa deles.

## 4. Agenda → Eventos (barra inferior: **Agenda**, abas Previsão | Eventos)
Para ver a fila com dados reais sem WhatsApp, insira um pedido de teste pelo SQL (o mesmo que o e2e faz) ou aguarde o número oficial.
1. A aba mostra **Eventos (N novos)** quando há pedidos novos. A fila abre com **Novo** + **Em contato**; os filtros de status e de unidade mudam a lista. Cada pedido mostra nome, selo de status, data com dia da semana, convidados, tipo, unidade, espaço e "há X horas".
2. Toque num pedido: o detalhe mostra os dados, observações automáticas, **Status** (só as transições válidas: cancelado/recusado não voltam), **Responsável** e **Notas internas** (só a equipe vê). **Salvar** mostra "Pedido atualizado.".
3. **Mostrar telefone** exibe o número com **Ligar** e **Abrir no WhatsApp**; cada consulta fica registrada na auditoria (`evento.telefone_visualizado`, sem o número). O número some ao fechar o detalhe.
4. **Início**: o cartão **Pedidos de evento novos** conta os pedidos novos das unidades que você vê e leva à fila por **Ver pedidos**.
5. Entre como **gerente** restrito a uma unidade: vê só os pedidos e espaços da sua unidade. Entre como **atendente**: trabalha a fila (status, responsável, notas, telefone), sem cadastrar espaços.
6. No celular (360 px), a barra com **Agenda** e a aba **Eventos (N novos)** cabem sem rolagem lateral.
7. **Mais → Mensagens**: os textos dos eventos (Pedido de evento recebido, Perguntar a data do evento, capacidade do espaço, cancelamento…) podem ser editados como os do S1/S2.
8. Endereço antigo `/previsao` leva à aba Previsão da Agenda.

## 5. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm --filter @atd/web e2e              # pare o worker local antes: o e2e sobe o próprio, com IA falsa
```
Depois do `pnpm check`, prepare o banco de novo (seção 1): `pnpm db:migrate`, o **bootstrap** do restaurante e o `demo:s1`. O e2e precisa de `PHONE_ENC_KEY` no ambiente (a mesma do servidor web) para cifrar o telefone do pedido de teste: `set -a; source .env; set +a` antes. Se o e2e acusar "Há um worker rodando neste banco" logo depois do `pnpm check` sem nenhum worker de pé, é o batimento deixado pelos testes do worker: espere 90 s e rode de novo.

Os evals de composição do S3 (sem custo) rodam no `pnpm test`; a extração com a IA de verdade (`pnpm --filter @atd/ai eval:s3`, e `eval:s1`/`eval:s2`, que medem a v4 por padrão, para conferir que ela não regrediu; `--triagem v2`/`--triagem v3` mede a versão anterior) só depois de comprar crédito no OpenRouter.

## Se o simulador não responder
- O worker está rodando? O Início mostra "IA: Online".
- Erro do OpenRouter aparece em **Ver detalhes**. Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
- Limite de gastos de IA atingido: ajuste `budget_limits` como em `docs/homologacao/etapa-02c.md`.
