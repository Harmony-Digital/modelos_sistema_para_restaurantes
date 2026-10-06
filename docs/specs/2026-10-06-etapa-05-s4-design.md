# Etapa 05 — Cardápio (S4) + importação de cardápio (CSV, PDF e imagem)

> Spec aprovada em conversa em 06/10/2026. Processo acelerado: um ciclo por etapa. PRD §10 (invariantes) vence qualquer conflito. Por decisão do dono, a importação por IA de PDF/imagem (parte da antiga Etapa 07, só para o alvo `cardapio`) entra nesta etapa.

## 1. Objetivo e critério de sucesso

A IA **envia o cardápio** (PDF/imagem) e **responde perguntas** sobre itens ("tem carne de sol?", "quanto é a picanha na Asa Sul?", "tem opção vegana?") **só com o cardápio cadastrado**, por unidade. O restaurante cadastra o cardápio à mão, **importa uma planilha CSV**, ou **envia um PDF/foto do cardápio que a IA lê e transforma em rascunho** — que o restaurante revisa e confirma antes de virar dado oficial.

Sucesso:
- Simulador: "me manda o cardápio" ⇒ documento/imagem; "tem carne de sol?" e "quanto é a picanha na Asa Sul?" ⇒ nome, descrição e preço do banco; item indisponível na unidade aparece como indisponível; sem resultado ⇒ "Sem resposta" + oferta do cardápio.
- Importar: CSV válido ⇒ prévia ⇒ confirmar grava; PDF/foto ⇒ rascunho preenchido pela IA ⇒ revisar/editar ⇒ confirmar grava. Nada vira oficial sem confirmação humana.
- Evals S4 nas metas; S1–S3 sem regressão.
- Correções do S3 vindas da homologação (§7) funcionando.

## 2. Respostas da IA (abordagem "IA entende, código responde")

### 2.1 Triagem v5
Nova `triage-v5` (v4 intacta): `servico = 'cardapio'`, `tipo ∈ { 'enviar', 'buscar', 'preco', 'filtro' }`, campos `consulta` (termo como o cliente disse, ≤ 60) e `tag` (`vegano | vegetariano | sem_gluten | sem_lactose | infantil | bebida | sobremesa` ou null), além de `unidade`. Mesmo esquema de pergunta pendente da v4. Evals S1–S3 rodam com a v5.

### 2.2 Busca (banco)
Função do banco `buscarCardapio(db, { restaurantId, unitId?, consulta?, tag? })` ⇒ até 8 itens ativos, rank por full-text (`portuguese` + `unaccent`, nome peso A, descrição/outros nomes/tags peso B) + similaridade trigram no nome e nos "outros nomes" (erros de digitação). Respeita exceções por unidade (indisponível; preço por unidade). Índices GIN; `EXPLAIN` revisado.

### 2.3 Resolução determinística (`@atd/core/s4`, puro)
- **buscar/preco** com resultado: "Temos sim: **Nome** — descrição — R$ 59,90." (até 3 itens detalhados; mais ⇒ lista com nome e preço). Preço diferente entre unidades e unidade não informada ⇒ preço de cada unidade (ou lista de unidades se forem muitas). Indisponível na unidade pedida ⇒ "Na unidade X, **Nome** está indisponível no momento."
- **filtro (tag)**: "Opções veganas: …" (até 8).
- **Sem resultado**: "Não encontrei esse item no cardápio." + oferta "Quer que eu mande o cardápio completo?"; lacuna `cardapio:<consulta normalizada>` (aparece em "Sem resposta").
- **enviar**: arquivo ativo da unidade, senão o geral; sem arquivo ⇒ texto com as categorias e até 3 itens de cada (com preço).
- Preço sempre de `preco_centavos`/override, formatado `R$ 1.234,56`; **nunca** preço inventado (asserção nos evals).
- Textos são modelos editáveis (aba Mensagens). Itens S4 contam no "% respondido pela IA".

### 2.4 Envio de arquivo pelo WhatsApp
- `@atd/whatsapp` ganha `uploadMedia(bytes, mime) ⇒ mediaId` e `sendDocument(to, { mediaId, filename, caption })` / `sendImage(to, { mediaId, caption })`.
- Worker: lê o arquivo do Storage (bucket privado), sobe para a Meta e guarda `wa_media_id` + `wa_media_expires_at` (29 dias); reaproveita enquanto válido.
- Conversa simulada: mensagem `documento`/`imagem` marcada `simulado`, nunca sai pela Meta; o simulador mostra o arquivo (miniatura/link assinado de curta duração).

## 3. Importação de cardápio

### 3.1 Fluxo comum: rascunho → revisão → confirmação
`knowledge_documents` (PRD §3.6), por ora só `alvo = 'cardapio'`: arquivo enviado (bucket privado), `status` (`enviado → processando → rascunho → aprovado | rejeitado | erro`), `draft jsonb` validado por Zod, `enviado_por`, `revisado_por`, `revisado_at`, `erro` (mensagem amigável). O rascunho tem categorias e itens (nome, descrição, preço em centavos ou null, tags, unidade opcional). A **tela de revisão** mostra o rascunho editável (corrigir nome/preço, remover itens, marcar "incluir"), indica **novos** vs. **já existentes** (mesmo nome normalizado na mesma categoria ⇒ "atualizar preço/descrição") e só grava ao **Confirmar** (dono/gerente), numa transação com auditoria. **Documentos nunca viram dado oficial sem aprovação humana** (PRD I10).

### 3.2 CSV
Colunas: `categoria, nome, descricao, preco, tags, outros_nomes, unidade` (cabeçalho obrigatório; separador `,` ou `;`; UTF-8; preço "59,90" ou "59.90"; tags e outros nomes separados por `|`). Lido **pelo código** (sem IA), vira o mesmo rascunho com erros por linha ("Linha 12: preço inválido"). Modelo de planilha para baixar.

### 3.3 PDF e imagem (IA)
- Upload (PDF, JPG, PNG, WebP; ≤ 20 MB; MIME real por *magic bytes*; dedup por sha256).
- Job `document.ingest` (pg-boss, worker): reserva de orçamento de IA **antes** da chamada (teto por documento configurável, padrão US$ 0,50); OpenRouter com `provider: { data_collection: 'deny', zdr: true }`; PDF enviado em base64 com o motor **nativo** do modelo (nunca motor de OCR de terceiros); imagem como `image_url` base64; saída **Structured Outputs** no schema do rascunho, validada por Zod; documentos grandes processados por páginas em lotes. Falha ⇒ `status 'erro'` com mensagem para o usuário ("Não consegui ler esse arquivo. Tente uma foto mais nítida ou envie um CSV."). Custo registrado em `ai_runs` (`etapa 'ingestao'`).
- Modelo de visão em configuração (`AI_INGEST_MODELS`), escolhido por evals de extração (ver §6).
- O conteúdo do documento é **dado, nunca instrução** (delimitado; prompt instrui ignorar instruções do documento).
- O arquivo importado pode ser **também** marcado como arquivo de cardápio para envio (opção na revisão).

## 4. Modelo de dados

- `menu_categories` (id, restaurant_id, nome, ordem, ativo; único `(restaurant_id, nome)`).
- `menu_items` (id, restaurant_id, category_id, nome, descricao, preco_centavos `integer` nullable — "sob consulta", tags `text[]`, outros_nomes `text[]`, disponivel, ordem, `search tsvector` gerado; GIN em `search`, GIN trigram em `nome`; único `(category_id, nome)`).
- `menu_item_units` (item_id, unit_id, restaurant_id, disponivel, preco_override_centavos; PK `(item_id, unit_id)`; FK composta com unidade) — **só exceções**.
- `menu_files` (id, restaurant_id, unit_id nullable, titulo, storage_path, mime, tamanho, sha256, wa_media_id, wa_media_expires_at, ativo).
- `knowledge_documents` (§3.1).
- RLS/grants no padrão das etapas anteriores: leitura pela equipe; escrita dono/gerente (exceções por unidade respeitam permissão por unidade); grants por coluna; MFA restritiva; sem DELETE para `authenticated` (desativar; remover arquivo de cardápio = desativar).
- **Storage:** buckets privados `cardapio` (arquivos de envio) e `importacoes` (documentos importados); policies de Storage pelo papel (`app.my_role()`), upload pelo usuário logado; worker lê com chave de serviço **só no servidor** (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` no env do worker, validado por Zod).

## 5. Painel

- **Navegação:** "Respostas" vira **"Conteúdo"** com abas **Cardápio | Sem resposta | Informações | Mensagens** (rotas antigas redirecionam).
- **Cardápio:** categorias (ordem, ativa, criar/editar), itens por categoria (nome, descrição, preço, tags, outros nomes, disponível), busca rápida; **Por unidade** (exceções: indisponível / preço próprio); **Arquivos** (enviar PDF/imagem de cardápio, prévia, unidade, ativar/desativar); **Importar** (CSV ou PDF/foto → acompanhar processamento → revisão → confirmar/rejeitar). Dono/gerente editam; atendente consulta.
- Padrões de UI do painel (estado vazio que ensina, skeleton, toasts, confirmação, 44 px, `R$` formatado, celular primeiro).

## 6. Qualidade
- **Evals S4 camada 2 (CI):** ≥ 50 casos (buscar, preço com/sem unidade, preço por unidade, indisponível, filtro por tag, sem resultado/lacuna, enviar com/sem arquivo, erro de digitação, outros nomes, mistura S1+S4) + asserção "nenhum preço que não esteja no banco".
- **Evals S4 camada 1:** ≥ 30 frases de triagem.
- **Evals de importação:** 3–5 cardápios de exemplo (PDF texto, PDF escaneado, foto) com gabarito de itens/preços; meta ≥ 90% dos itens com nome e preço corretos; rodar quando houver crédito.
- Testes: busca (rank, acento, erro de digitação, exceções), parser CSV (erros por linha), validação de upload (magic bytes, tamanho), confirmação do rascunho (novo × existente, transação, auditoria), envio de mídia (cache e expiração), simulação isolada, RLS/Storage por papel.
- E2E (celular, IA falsa): CRUD de item; importar CSV ⇒ revisar ⇒ confirmar; importar PDF (IA falsa devolve rascunho) ⇒ revisar ⇒ confirmar; simulador responde preço e envia o cardápio.

## 7. Correções do S3 (homologação da Etapa 04)
1. Com pedido de evento em andamento, pedido de **mudança** ("na verdade são 60", outro espaço, outra data) ⇒ a IA responde que vai repassar e **passa a conversa para a equipe** (handoff), registrando nas observações do pedido o que o cliente pediu (texto nosso + campos validados, sem texto livre).
2. Pedido novo para unidade/data de um pedido **confirmado** ⇒ handoff para a equipe (não cria pedido).

## 8. Fora desta etapa
Pedidos/delivery, fotos por item, importação por IA de outros alvos (horários, unidades, eventos — fica na Etapa 07), tradução do cardápio.

## 9. Mudanças no PRD
§3.4: `outros_nomes`, `ordem`, preço nullable ("sob consulta"); §3.6 e §4.6 trazidos para esta etapa só para `alvo = 'cardapio'`; §4.3: `buscar_cardapio`/`enviar_cardapio` viram funções do domínio (como S1–S3); worker com acesso ao Storage por chave de serviço (só servidor); menu "Conteúdo".
