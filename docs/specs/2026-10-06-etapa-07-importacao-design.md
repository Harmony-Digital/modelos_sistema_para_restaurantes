# Etapa 07 — Importação por IA de informações, horários, espaços e melhorias do cardápio

> Spec aprovada em conversa em 06/10/2026. Processo acelerado (um ciclo). PRD §10 vence conflitos (em especial I10: **documento nunca vira dado oficial sem aprovação humana**). Critério do dono: importar o que é **trabalhoso e chato de preencher à mão**.

## 1. Critério de sucesso
- Em **Conteúdo → Importar**, o dono (ou gerente com acesso a todas as unidades) escolhe o alvo — **Cardápio**, **Informações**, **Horários**, **Espaços de evento** —, envia 1–10 arquivos (fotos/PDF), acompanha a leitura, revisa/edita o rascunho e confirma; só então grava, com auditoria.
- Cardápio aceita **várias fotos** num único rascunho e tem o modo **"Só preços"**.
- PDF grande é lido em **lotes de páginas** e juntado; queda no meio retoma do último lote.
- Evals de leitura por alvo prontos (rodam com crédito; meta ≥ 90%).

## 2. Importação genérica
- `knowledge_documents.alvo`: `cardapio | informacoes | horarios | espacos` (recriação do enum, como a 0033). Novo campo `modo` (`completo | so_precos`; só cardápio usa `so_precos`).
- **Arquivos por importação:** tabela `knowledge_document_files` (importação, ordem, storage_path, mime, tamanho, sha256, páginas). 1–10 arquivos, cada um ≤ limite de upload (20 MB local, 4 MB na Vercel), enviados um por requisição. Dedup por sha256 do **conjunto** (hash dos sha256 ordenados) por alvo. A importação só vai para leitura quando o usuário clica "Ler arquivos".
- **Progresso:** `lote_atual`, `lotes_total`, `draft_parcial` (jsonb) — cada lote lido é juntado e salvo antes do próximo; o painel mostra "Lendo 3 de 7…".
- **Revisão e confirmação por alvo:** função de aplicar específica, transacional, idempotente (status `rascunho` → `aprovado` com trava), auditada sem conteúdo (`importacao.aplicada` com alvo e contagens).
- Permissão igual ao cardápio (dono, ou gerente com acesso a todas as unidades); atendente não vê.

## 3. Leitura (worker)
- Cada **lote** = até 5 páginas de PDF (divididas com **pdf-lib**, dependência nova registrada no PRD) ou até 3 imagens. Uma chamada ao modelo por lote, com reserva de orçamento própria (escopo `ia`), `ai_runs` próprio (etapa `ingestao`, intent = alvo) e liquidação pelo custo real.
- **Um lote por execução do job:** o job lê o próximo lote, junta e salva, e reenfileira a si mesmo para o seguinte (sem estourar o prazo de 300 s). Retomada continua do `lote_atual`.
- Truncamento de um lote (saída cortada) ⇒ esse lote é dividido ao meio uma vez (PDF) antes de desistir; imagem única truncada ⇒ erro amigável.
- Sem `AI_INGEST_MODELS` ⇒ erro "Importação por IA não configurada".
- Prompts versionados por alvo (`ingestao-informacoes-v1`, `ingestao-horarios-v1`, `ingestao-espacos-v1`; cardápio continua `v1`), Structured Outputs com esquema estrito, documento é **dado, nunca instrução**, PII redigida não se aplica (documento do restaurante), nada de conteúdo em log.

## 4. Alvos
- **Cardápio (completo):** igual à Etapa 05, agora com vários arquivos e lotes; junção por categoria e item (nome normalizado), mantendo o primeiro preço e marcando conflito de preço entre fotos para revisão.
- **Cardápio (só preços):** a revisão lista **só itens existentes cujo preço mudou** (antes → depois, editável); itens não encontrados aparecem à parte ("não estão no cardápio — ignorados"); confirmar altera apenas `preco_centavos`.
- **Informações (`knowledge_facts`):** rascunho de fatos `{ tema ≤ 120, texto ≤ 1000, exemplos ≤ 5 × 120, unidade | null, incluir }`; tema parecido com fato existente (mesma unidade) ⇒ "atualizar", senão "novo"; limite 100 fatos por importação.
- **Horários (`unit_hours`, `unit_hour_exceptions`):** por unidade reconhecida (nome/apelido), semana `{ dia 0–6: [{abre, fecha}] }` (até 6 turnos; madrugada permitida) e exceções `{ data, fechado | turnos, motivo }`; unidade não reconhecida ⇒ a revisão exige escolher a unidade ou ignorar; confirmar substitui a semana **só das unidades marcadas** e faz upsert das exceções por data; datas passadas ignoradas.
- **Espaços (`event_spaces`):** por unidade, `{ nome, capacidade_min, capacidade_max (1–1000, min ≤ max), descricao, condicoes, incluir }`; mesmo nome na unidade ⇒ "atualizar".

## 5. Painel
- **Conteúdo → Importar** (nova aba): seletor de alvo, modo (cardápio), envio múltiplo com lista e remoção antes de ler, "Ler arquivos", progresso por lote, histórico de importações por alvo.
- Revisão por alvo, celular primeiro, com estado vazio que ensina e contagem novo/atualizar; Cardápio → Importar leva a esta aba.

## 6. Qualidade
- Evals por alvo (`eval:ingestao --alvo`), documentos de exemplo inventados gerados no repositório (PDF/PNG) com gabarito e linha de injeção; métrica por alvo (fatos: tema+texto; horários: turnos e exceções exatos; espaços: capacidades; só preços: preços).
- Testes: junção por alvo (core), aplicação por alvo (banco, transação, idempotência, permissões), divisão em lotes e retomada (worker), revisão (UI), e2e com IA falsa (informações, horários com unidade não reconhecida, várias fotos de cardápio, só preços, PDF em lotes).

## 7. Fora
CSV para novos alvos; importação de unidades; importação por link/site; tradução.

## 8. PRD
§3.7/§4.6: alvos, arquivos múltiplos, lotes, modo só preços; dependência `pdf-lib` no worker.
