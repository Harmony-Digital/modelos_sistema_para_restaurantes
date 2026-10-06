# Homologação — Etapa 05 (cardápio, S4, e importação de cardápio)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp (nem o arquivo do cardápio). A IA responde sobre o cardápio **só com o que está cadastrado**: nome, descrição e preço vêm do banco, por unidade; ela nunca inventa preço. Nada que vem de planilha, PDF ou foto entra no cardápio sem você revisar e **confirmar**.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # 4 unidades, horários, informações e um cardápio de demonstração (7 itens)
pnpm dev                                # painel em http://127.0.0.1:3000
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes, com a chave de serviço só no shell (nunca no `.env`):
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"
```

**Worker** (outro terminal; responde o simulador e lê as importações). Ele baixa os arquivos do Storage com a chave de serviço, que vem do `supabase status` na hora e **não fica gravada em arquivo**:
```bash
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY WHATSAPP_ACCESS_TOKEN=local-sem-meta \
  AI_INGEST_MODELS=<modelo com visão e PDF> pnpm --filter @atd/worker dev
```
- O simulador usa a IA de verdade (triagem **v5**) e precisa de `OPENROUTER_API_KEY` **com crédito** e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Sem crédito, toda mensagem cai no aviso de falha da IA.
- **Importação de PDF/foto pela IA** precisa de `AI_INGEST_MODELS` com um modelo **de visão que leia PDF e devolva JSON estruturado**. Os modelos grátis testados não devolvem o JSON (ou não leem imagem); com crédito, escolha o modelo pelo `pnpm --filter @atd/ai eval:ingestao --modelos <a>,<b>` (meta ≥ 90% dos itens com nome e preço corretos). Sem `AI_INGEST_MODELS`, a importação de PDF/foto termina com "Importação por IA não configurada. Envie um CSV." — a planilha CSV funciona sem IA.

## 2. Cardápio (Conteúdo → **Cardápio**; dono ou gerente com acesso a todas as unidades)
A antiga tela "Respostas" agora se chama **Conteúdo** (abas Cardápio | Sem resposta | Informações | Mensagens); o endereço antigo `/respostas` leva para lá.
1. **Itens:** o cardápio de demonstração aparece por categoria (Carnes, Saladas, Bebidas, Sobremesas). "Costela no bafo" mostra "Preço sob consulta". A busca rápida filtra pelo nome e pelos "outros nomes".
2. **Nova categoria** ("Massas") e **+ Item** nela: nome, descrição, preço (digite só os números: `4590` vira `R$ 45,90`), etiquetas (vegano, sem glúten, bebida…), outros nomes (como o cliente chama o item) e **Disponível**. Sem preço = "sob consulta". O lápis edita; não existe apagar (desligue **Disponível** ou desative a categoria).
3. **Por unidade:** escolha a unidade e um item para marcar **indisponível** ou dar um **preço próprio** (o demo já tem a Picanha a R$ 94,90 na Asa Sul e a Carne de sol indisponível no Lago Sul). Gerente restrito a uma unidade só mexe aqui, nas unidades dele.
4. **Arquivos:** envie o PDF ou a foto do cardápio (até 20 MB), com título e "Vale para" (todas as unidades ou uma). **Ver prévia** abre o arquivo por um link que expira em minutos; **Desativar** tira o arquivo do envio (não apaga).

## 3. Simulador (botão verde do WhatsApp; dono ou gerente)
Use **Novo cliente** entre os blocos.
1. "tem carne de sol?" ⇒ "Temos sim: *Carne de sol* — Com manteiga de garrafa e macaxeira — R$ 74,90" (no WhatsApp o nome sai em **negrito**; no simulador aparecem os asteriscos).
2. "quanto é a picanha na Asa Sul?" ⇒ R$ 94,90 (preço da unidade). "quanto é a picanha?" sem unidade: como o preço varia e há mais de 3 unidades, a IA pergunta a unidade (lista "Ver unidades") e responde com o preço da escolhida; com até 3 unidades, mostra o preço de cada uma numa linha.
3. "tem carne de sol no Lago Sul?" ⇒ "Na unidade Lago Sul, *Carne de sol* está indisponível no momento."
4. "tem opção vegana?" ⇒ "Opções veganas: …" (Salada tropical, Suco de laranja).
5. "tem lasanha?" (item que não existe) ⇒ "Não encontrei esse item no cardápio." + "Quer que eu mande o cardápio completo?". A pergunta aparece em **Conteúdo → Sem resposta**.
6. "me manda o cardápio": com arquivo ativo (seção 2.4) ⇒ bolha de **documento** (PDF) ou **imagem** com o título e o link **Abrir**; sem arquivo ⇒ texto com as categorias e até 3 itens de cada, com preço ("preço varia por unidade" quando for o caso). Com unidade ("cardápio da Asa Norte"), vale o arquivo e os preços daquela unidade.
7. Preço nunca aparece se não estiver no banco: mude o preço de um item e pergunte de novo — a resposta já sai com o preço novo.

## 4. Importar (Conteúdo → Cardápio → **Importar**; dono ou gerente)
1. **Planilha CSV:** **Baixar o modelo de planilha**, preencha (colunas `categoria, nome, descricao, preco, tags, outros_nomes, unidade`; separador `,` ou `;`; preço `59,90` ou `59.90`; etiquetas e outros nomes separados por `|`) e **Ler planilha**. Linha com erro mostra "Linha 12: preço inválido" e nada é criado.
2. A **revisão** mostra cada item com **Novo** (não existe) ou **Atualiza** (mesmo nome na mesma categoria: atualiza preço e descrição). Corrija nome/preço/descrição, desmarque **Incluir** para deixar um item de fora. Nada foi gravado até aqui.
3. **Confirmar importação** grava tudo de uma vez ("Cardápio atualizado: N novos, M atualizados") e registra na auditoria. **Descartar** joga a importação fora.
4. **PDF ou foto:** **Enviar para leitura** ⇒ "Lendo o cardápio…" (até um minuto; a tela atualiza sozinha) ⇒ a mesma revisão, preenchida pela IA. Confira os preços com atenção: a IA pode errar uma leitura. Na revisão de um arquivo dá para marcar **Usar este arquivo como cardápio para enviar aos clientes**.
5. Arquivo ilegível ⇒ "Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV." (com **Descartar**). Leitura que passa de 5 minutos ⇒ "A leitura está demorando. Tente enviar de novo." Enviar o mesmo arquivo de novo abre a importação que já existe.
6. Só o dono, ou gerente com acesso a todas as unidades, confirma. **Atendente** vê o cardápio e os arquivos, sem botões de edição e sem a aba Importar.
7. No celular (360 px), Itens, Arquivos, Importar e a revisão cabem sem rolagem lateral.

## 5. Correções de eventos (homologação da Etapa 04)
1. Com um pedido de evento registrado, "na verdade são 60 pessoas" (ou outra data/espaço) ⇒ a IA diz que vai repassar à equipe e a conversa vai para atendimento humano; a mudança pedida aparece nas observações do pedido.
2. Pedido novo para a mesma unidade e data de um pedido **confirmado** pela equipe ⇒ vai para atendimento humano, sem criar outro pedido.

## 6. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm db:migrate && pnpm --filter @atd/db demo:s1   # prepare o banco de novo (com o bootstrap da seção 1, se pedir)
set -a; source .env; set +a             # PHONE_ENC_KEY e NEXT_PUBLIC_SUPABASE_URL do e2e
eval "$(pnpm exec supabase status -o env | grep -E '^SERVICE_ROLE_KEY=')"
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY pnpm --filter @atd/web e2e
```
Pare o worker local antes do e2e: ele sobe o próprio, com IA falsa (triagem e leitura de cardápio), e a guarda acusa "Há um worker rodando neste banco" se outro estiver vivo. O e2e do cardápio (`s4.spec.ts`) cria categoria e item, pergunta o preço no simulador, envia o arquivo e recebe o documento, importa um CSV e um PDF (a "IA" devolve um rascunho fixo) e confere o atendente sem edição. **Evite rodar o e2e entre 23:59 e 00:00 (horário de Brasília)** (ver `docs/homologacao/etapa-04.md`).

Os evals de composição do cardápio (sem custo) rodam no `pnpm test`. Com crédito no OpenRouter: `pnpm --filter @atd/ai eval:s4` (extração da triagem v5; `eval:s1`/`eval:s2`/`eval:s3` medem a v5 por padrão) e `eval:ingestao` (leitura de PDF/foto; exemplos em `packages/ai/evals/ingestao/exemplos`).

## 7. Pendências para produção (não bloqueiam a homologação local)
- **Upload acima de ~4,5 MB na Vercel:** hoje o arquivo sobe pela Server Action (limite local de 21 MB). Na Vercel o corpo da requisição tem cerca de 4,5 MB; antes do deploy, o upload precisa ir direto ao Storage por **URL assinada**, com a validação (magic bytes, tamanho, sha256) feita depois do envio.
- **Remover `OPENROUTER_DEV_SEM_ZDR` no go-live** (Etapa 09): toda chamada de produção precisa sair com `data_collection: deny` + `zdr: true` — o worker já recusa essa chave em produção.
- **Policies de Storage no Supabase hospedado:** conferir que os buckets `cardapio` e `importacoes` existem, são **privados** e têm as policies por papel da migration 0027 (só dono/gerente enviam; arquivos de envio visíveis à equipe; documentos importados só a dono/gerente), e que a chave de serviço está só no worker.

## Se algo não funcionar
- O worker está rodando? O Início mostra "IA: Online". Sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ele não sobe (mensagem de variável ausente).
- Erro do OpenRouter aparece em **Ver detalhes** do simulador. Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
- Limite de gastos de IA atingido (triagem ou leitura): ajuste `budget_limits` como em `docs/homologacao/etapa-02c.md`.
- Importação parada em "Lendo o cardápio…": confira se o worker está rodando com `AI_INGEST_MODELS`; ao reiniciar, ele retoma ou marca a importação com erro.
- Item parecido respondido como se fosse o pedido (ex.: "tem coca?" → *Cocada*): a busca tolera erros de digitação, então nomes muito curtos podem casar com outro item. Cadastre como o cliente chama o produto em **outros nomes** (ex.: "coca" no refrigerante).
