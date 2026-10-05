# Etapa 02 — Horários, funcionamento e unidades (S1) + design system

> **Status:** aprovada em conversa em 05/10/2026 (seções 1–5). Esta spec complementa o [PRD](../../PRD.md); onde houver diferença, **esta spec atualiza o PRD** (as mudanças estão listadas em §9 e registradas no adendo da Etapa 02 do PRD).
> Execução em três planos sequenciais: **02-A**, **02-B**, **02-C** (§8).

## 1. Objetivo e critério de sucesso

O cliente pergunta pelo WhatsApp sobre horários, funcionamento, feriados, unidades, endereços e informações gerais do restaurante e recebe resposta **correta, imediata e sem humano**. Meta do restaurante: atendimento 100% por IA; tudo o que faltar para isso fica **visível e resolvível no painel**.

Sucesso (critério de pronto, §7):
1. Perguntas simples e **compostas** de S1 respondidas a partir do banco, nunca inventadas.
2. Perguntas sem dado cadastrado viram **lacunas** no painel; respondidas uma vez, a IA passa a responder sozinha.
3. Painel com design system Harmony (escuro padrão, claro opcional), celular primeiro, formulários com validação exata.
4. **Simulador de WhatsApp** no painel que roda o pipeline real e mostra exatamente o que o cliente receberia.

## 2. Respostas da IA para S1 — abordagem A ("IA entende, código responde")

### 2.1 Extração (uma chamada barata, lista de itens)
A triagem (`triage-v2`) passa a devolver **todos** os pedidos da mensagem:

```json
{
  "itens": [
    {
      "servico": "horario_unidades",
      "tipo": "aberto_agora | horario_dia | horario_semana | feriado | endereco | como_chegar | lista_unidades | info",
      "unidade": "texto citado pelo cliente ou null",
      "data": "texto citado (hoje, amanhã, domingo, dia 12, feriado) ou null",
      "tema": "assunto para tipo=info (ex.: estacionamento) ou null"
    },
    { "servico": "aviso_presenca | evento | cardapio | humano | lgpd", "...": "..." }
  ],
  "fora_escopo": false
}
```
- `itens` vazio + `fora_escopo: true` ⇒ resposta fixa de fora de escopo (comportamento da Etapa 01).
- Mensagem com parte fora de escopo **e** parte válida ⇒ responde a parte válida; ignora o resto.
- Schema estrito (`json_schema`, `strict: true`), saída validada com Zod; máximo de 5 itens por mensagem.
- Redação de PII e neutralização de delimitadores continuam dentro da função de triagem (I8).
- O modelo **não** produz texto para o cliente.

### 2.2 Resolução determinística (código, sem IA)
| Parâmetro | Regra |
|---|---|
| **Unidade** | Busca por `nome` e `apelidos` com `unaccent` + trigram (tolera "aza sul"). Ambígua/ausente e a resposta depender da unidade: ≤ 3 unidades ativas ⇒ responde **todas** numa mensagem; > 3 ⇒ envia **lista interativa** do WhatsApp e grava a pergunta em `conversations.pendente` (validade 30 min); ao escolher, responde os itens pendentes sem o cliente repetir |
| **Data** | "hoje", "amanhã", "depois de amanhã", dia da semana (próxima ocorrência, hoje incluso), "dia N" (próxima ocorrência), "dd/mm", "no feriado"/nome do feriado (próximo). Sempre no fuso `restaurants.timezone` |
| **Horário de um dia** | Ordem de precedência: **exceção da data** (`unit_hour_exceptions`) → **feriado nacional** + `restaurants.politica_feriado` (`normal` / `fechado` / `como_domingo`) → **regra semanal** (`unit_hours`) |
| **Aberto agora** | Considera turnos múltiplos e virada da meia-noite (turno 18:00–02:00 de sábado cobre domingo 00:00–02:00). Resposta inclui o próximo evento ("fechamos às 23h" / "abrimos amanhã às 11h30") |
| **Informação geral** | Busca em `knowledge_facts` ativos (unidade específica ou todas) por tema, sinônimos e texto (`tsvector portuguese + unaccent` + trigram); melhor resultado acima de um limiar ⇒ responde com o texto aprovado |

### 2.3 Composição
- Cada item ⇒ um trecho a partir de **modelos de resposta** (`reply_templates`: padrão no código, personalização no banco).
- Trechos unidos em **uma mensagem** curta, na ordem da pergunta; repetição de saudação evitada.
- Endereço ⇒ texto **e** mensagem de **localização** do WhatsApp (lat/lng + nome + endereço).
- Itens de serviços ainda não implementados (S2–S4) ⇒ trecho "em breve" daquele serviço.
- Nenhum horário/endereço passa pelo LLM para ser reescrito (I2).

### 2.4 Lacunas (rumo aos 100% IA)
- Item sem dado (tema sem fato, unidade sem horário cadastrado) ⇒ trecho honesto do modelo `lacuna` ("Ainda não tenho essa informação; vou verificar com a equipe.") **sem** transferir para humano.
- Registro em `knowledge_gaps`: pergunta **mascarada** (`redactPii`), chave normalizada (tema ou texto normalizado), unidade, ocorrências, primeira/última vez.
- Indicador **% respondido pela IA** = itens respondidos com dado ÷ itens válidos (exclui fora de escopo e simulações), por dia e 7 dias.
- Handoff para humano continua só por pedido explícito, frustração, falhas consecutivas ou modo econômico (Etapa 01).

### 2.5 Canal e mensagens novas do WhatsApp
`packages/whatsapp` ganha: `sendLocation(to, {lat,lng,name,address})`, `sendList(to, {body, button, sections})` e parsing de resposta de lista (`interactive.list_reply` ⇒ id da unidade). O worker passa a entregar mensagens de saída de tipos `texto`, `localizacao`, `lista` (coluna `messages.payload jsonb` para os dados estruturados).

## 3. Modelo de dados

Todas as tabelas novas: `restaurant_id`, RLS + `mfa_required` restritiva + `app_roles`, grants mínimos (`web_app` no painel via `authenticated`; `worker_app` leitura do que a IA usa e escrita em lacunas/pendente), coberto pelo teste de políticas obrigatórias.

| Tabela / coluna | Campos | Regras e índices |
|---|---|---|
| `units` (completa) | `endereco`, `bairro`, `cidade`, `uf`, `cep`, `lat numeric(9,6)`, `lng numeric(9,6)`, `maps_url`, `telefone`, `apelidos text[]`, `ordem int` | trigram + `unaccent` em `nome`/`apelidos` (função imutável `app.f_unaccent`); `ativo` controla resposta |
| `unit_hours` | `unit_id`, `weekday 0–6`, `turno smallint`, `abre time`, `fecha time` | `fecha < abre` ⇒ termina no dia seguinte; `abre <> fecha`; sobreposição de turnos no mesmo dia rejeitada (validação compartilhada + teste) |
| `unit_hour_exceptions` | `unit_id`, `data date`, `fechado bool`, `turnos jsonb [{abre,fecha}]`, `motivo` | único `(unit_id, data)`; `fechado` ⇔ `turnos` vazio |
| `restaurants.politica_feriado` | `normal` / `fechado` / `como_domingo` (padrão `como_domingo`) | — |
| `knowledge_facts` | `tema`, `exemplos text[]`, `texto`, `unit_id` (null = todas), `ativo`, `search tsvector` gerado | GIN em `search`; trigram em `tema` |
| `reply_templates` | `chave`, `texto` | único `(restaurant_id, chave)`; variáveis validadas contra a lista da chave ao salvar |
| `knowledge_gaps` | `chave_normalizada`, `pergunta_mascarada`, `unit_id`, `ocorrencias`, `primeira_vez`, `ultima_vez`, `status` (`aberta`/`respondida`/`ignorada`), `fact_id` | único parcial `(restaurant_id, chave_normalizada, unit_id) WHERE status='aberta'`; retenção: texto apagado em 90 dias |
| `conversations.pendente` | `jsonb {itens, expira_em}` | só o worker escreve |
| `conversations.simulada`, `customers.simulado`, `ai_runs.simulado` | `bool default false` | excluídos de indicadores, lacunas e retenção normal (apagados em 7 dias) |
| `messages.payload` | `jsonb` | dados de localização/lista/resposta interativa |

**Feriados nacionais:** função pura `feriadosNacionais(ano)` em `@atd/core` (fixos + móveis a partir da Páscoa: Carnaval segunda/terça, Sexta-feira Santa, Corpus Christi). Sem tabela. Feriados locais = exceções por data.

**Permissão por unidade:** função `app.can_access_unit(unit_id)` — dono: todas; gerente/atendente com `unidades_permitidas` vazio: todas; senão só as listadas. Aplicada em `units`, `unit_hours`, `unit_hour_exceptions`, `knowledge_facts` (por unidade) e `knowledge_gaps`.

**Auditoria:** toda mutação do painel grava `audit_log` (ator, ação, entidade, diff) na mesma transação (PRD §7.12).

## 4. Painel (celular primeiro)

**Navegação:** barra inferior com **Início · Unidades · Respostas · Mais**. Ação principal de cada tela em botão no topo. Canto inferior direito reservado ao **simulador**. Formulários em *bottom sheet* no celular e diálogo no desktop.

| Tela | Conteúdo |
|---|---|
| **Início** | Status da IA; **% respondido pela IA** (hoje / 7 dias); top 3 **perguntas sem resposta** com "Responder"; **aguardando atendente** com **"Devolver à IA"**; gasto de IA hoje (dono/gerente) |
| **Unidades** | Lista com selo calculado "Aberta agora · fecha às 23h" / "Fechada · abre amanhã 11h30". Detalhe: **Dados** (endereço, telefone, apelidos, **colar link do Google Maps** ⇒ extrai lat/lng), **Horários** (semana em lista, turnos em pílulas, "Copiar para dias úteis", virada da meia-noite explícita), **Exceções** (feriados nacionais do ano já listados com o comportamento atual; "+ Exceção") |
| **Respostas** | **Sem resposta** (fila agrupada com contagem; Responder ⇒ formulário de informação pré-preenchido; Ignorar), **Informações** (fatos por tema + sugestões de temas comuns ainda não cadastrados), **Mensagens** (modelos com prévia usando dados reais) |
| **Mais** | Restaurante (nome, política de feriado, horário do atendimento humano, link da política), Aparência (escuro/claro), Conta/Sair |
| **Acesso** | Login, MFA e **Definir senha** (destino do link de convite; resolve a pendência da Etapa 01) |

Padrões em todas as telas: estado vazio que ensina o próximo passo, skeleton, toast ao salvar, confirmação antes de apagar, erros em português com a ação para corrigir, alvos de toque ≥ 44px, foco visível, datas `dd/mm/aaaa` e horas `HH:mm`.

## 5. Design system

### 5.1 Tokens (base: site Harmony Digital)
Tailwind v4 `@theme` com variáveis CSS. **Escuro é o padrão**; claro via `[data-theme="light"]`. Troca de marca por cliente = `--brand-primary`, `--brand-accent`, logo.

| Papel | Escuro (padrão) | Claro |
|---|---|---|
| Fundo | `navy-900 #0F1322` | `off #FAF8F4` |
| Superfície/cartão | `navy-800 #1A2036` | `card #FFFEFB` |
| Superfície elevada | `navy #151A2D` + borda | `off-2 #F3F0EA` |
| Texto principal | `ink-dark #C9CCD6` (10,75:1 sobre navy) | `ink #151A2D` (16,3:1) |
| Texto secundário | `ink-dark-2 #8E94A6` (6,1:1 / 5,3:1 sobre cartão) | `ink-3 #4A5061` (7,6:1) |
| Acento / ação | `orange #F28C1D` (texto **navy** sobre ele: 7,0:1) | idem |
| Link / destaque em texto | `orange-300 #F7B265` (10,1:1) | `orange-700 #9E5306` (5,4:1) |
| Divisória | `navy-800`/`#2B3040` | `line #E7E2D9` |
| Borda de controle | `#6B7186` (3,8:1; `#4A5061` reprova com 2,3:1) | `line-strong #8A8377` (3,5:1) |
| Sucesso / Erro / Aviso / Info | `#4ADE80` (10,6:1) / `#F87171` (6,7:1) / `#FBBF24` (11,1:1) / `#7DB3F5` (8,5:1) | `#1F7A4D` / `#B42318` / `#8A5A00` / `#1D4E89` |

Regras: laranja **nunca** como cor de texto sobre fundo claro nem com texto branco por cima; todo par texto/fundo AA (4,5:1; 3:1 para bordas de controle e ícones). Todos os pares acima foram medidos (WCAG, sobre `navy-900` e `navy-800` no escuro; sobre `off`/`card` no claro); um script de contraste no CI impede regressão quando um token mudar.

Tipografia: **Sora** (títulos, números grandes), **DM Sans** (texto, formulários), **JetBrains Mono** (dados técnicos), via `next/font`. Raios `8 / 14 / 22px`. Movimento: `cubic-bezier(.22,1,.36,1)`, ≤ 200ms, respeita `prefers-reduced-motion`. Ícones Lucide. Componentes: shadcn/ui (Radix) no repositório, estilizados pelos tokens.

### 5.2 Formulários componentizados
Componentes: `Field` (rótulo + ajuda + erro), `TextInput`, `Textarea`, **`PasswordInput` (olho mostra/oculta; `aria-pressed`; rótulo acessível "Mostrar senha"/"Ocultar senha"; volta a ocultar ao enviar)**, `TimeInput` (24h), `DateInput` (dd/mm/aaaa), `PhoneInput` (máscara BR), `Select`, `TagInput`, `Switch`, `SubmitButton` (estado "Salvando…"), `ErrorSummary`.

| Estado | Visual |
|---|---|
| Normal | borda de controle; **rótulo sempre visível** acima |
| **Ativo** | anel laranja 2px + rótulo em acento + leve elevação |
| Válido com regra | ✓ discreto (ex.: link do Maps reconhecido) |
| **Erro** | borda + ícone de erro; mensagem **abaixo do campo** dizendo o que está errado e como corrigir |
| Desabilitado | opacidade reduzida + motivo no texto de ajuda |

Placeholders = **exemplo real** ("Ex.: SCLS 404 Bloco C, Asa Sul"). Validação: ao sair do campo; após o primeiro erro, a cada tecla; no envio com erro, **rola e foca o primeiro campo inválido** e mostra `ErrorSummary` com links. Mesmo schema Zod no cliente e no servidor; erros de servidor mapeados ao campo. `aria-invalid` + `aria-describedby`; erros anunciados (`aria-live`). Biblioteca: React Hook Form + resolver Zod (versão e API conferidas no Context7 no plano 02-A).

### 5.3 Simulador de WhatsApp
- Botão flutuante com **ícone do WhatsApp** (verde) no canto inferior direito, em todas as telas do painel.
- Desktop: abre **moldura de iPhone 17** (cantos, Dynamic Island, barra de status com hora/sinal/bateria, indicador de início). Celular: **tela cheia**.
- Interface fiel ao **WhatsApp escuro**: cabeçalho com avatar/nome do restaurante e "online"/"digitando…", papel de parede, balões de saída (verde) e entrada (cinza) com hora e ✓✓, campo de digitação, **lista interativa** (botão que abre a folha de opções), **cartão de localização**.
- **Exatidão:** a mensagem entra no **mesmo pipeline real** (fila, rajada de 4s, pré-filtro, triagem, resolução, composição, aviso de privacidade, handoff, orçamento). Só o **canal** difere: adaptador `simulador` no lugar da Meta. O que aparece é exatamente o que o cliente receberia com os dados atuais.
- Controles: **Novo cliente** (zera conversa simulada), **Simular data e hora** (relógio injetado só na conversa simulada), **Ver detalhes** (itens extraídos, resolução, modelo, custo).
- Isolamento: `simulada=true` em cliente/conversa/execuções; fora de indicadores e lacunas; nunca sai pela Meta; apagado em 7 dias. Custo de IA real, **sujeito ao mesmo teto**, reportado como "simulação".
- Atualização: polling ~1s enquanto aberto (rota autenticada do painel; sem expor API de dados).

## 6. Qualidade

### 6.1 Evals S1 (`packages/ai/evals/s1/`)
~80 conversas-gabarito: simples, **compostas**, erros de digitação, datas relativas, feriados nacionais e locais, virada da meia-noite, unidade ausente/ambígua (lista), lacunas, injeção de instrução, fora de escopo misturado.
- **Camada 1 — extração (IA):** itens extraídos vs gabarito; modelo real; sob comando e no CI quando prompt/modelo mudam; teto de custo por execução.
- **Camada 2 — resolução + composição (código):** determinística; todo CI; compara a mensagem final exata.
- Metas: composição **100%**; extração **≥ 95%**; **0** respostas com horário/endereço inexistente.
- Escolha do modelo de triagem entre 3–4 modelos baratos; resultado registrado no PRD.

### 6.2 Testes do sistema
- Unitários: "aberto agora" (turnos, virada, exceção, feriado + política), `feriadosNacionais` (anos conferidos com datas oficiais), busca de unidade por apelido, datas relativas, modelos de texto, extração de lat/lng de links do Maps.
- Banco: RLS por unidade por papel; auditoria na mesma transação; agrupamento de lacunas; isolamento de simulação; grants com `web_app`/`worker_app` reais.
- E2E (Playwright, viewport de celular): cadastro de unidade + horário ⇒ selo "Aberta agora"; responder lacuna ⇒ simulador passa a responder; erros de formulário (foco no primeiro inválido, mensagem certa); olho da senha; definir senha; devolver à IA; simulador com relógio fixo respondendo "abre domingo?".

## 7. Critério de pronto
1. No simulador: "abre domingo?", "endereço da Asa Sul" (texto + localização), "estão abertos agora?" e uma pergunta composta respondidos corretamente com dados do banco.
2. Pergunta sem cadastro ⇒ lacuna no painel ⇒ respondida ⇒ IA responde sozinha.
3. Evals dentro das metas; modelo de triagem escolhido e registrado.
4. RLS por unidade testada por papel.
5. Design system aplicado nas telas novas, nos dois temas, contraste AA verificado.
6. Homologação do dono pelo simulador e pelo celular.

## 8. Execução
| Plano | Escopo |
|---|---|
| **02-A** | Tokens e temas, fontes, layout com navegação inferior, componentes de formulário, **Definir senha**, **Devolver à IA**, casca visual do simulador; pendências de documentação da Etapa 01 |
| **02-B** | Migrations e RLS por unidade, `feriadosNacionais`, resolução e composição, `triage-v2` (lista de itens), lacunas, mensagens de localização/lista, pendente de unidade, evals e escolha de modelo |
| **02-C** | Telas Unidades / Respostas / Início completas, simulador ligado ao pipeline real (adaptador de canal, relógio injetado, isolamento), E2E |

Fora da Etapa 02: inbox completa e áudio (Etapa 06); equipe/convites e limites no painel (Etapa 08); geocodificação automática.

## 9. Mudanças no PRD
- §4.2–4.4: S1 deixa de usar ferramentas com geração livre; passa a **extração em lista + resolução e composição determinísticas** (esta spec, §2). Ferramentas com LLM continuam previstas para S4 (cardápio) e para o modo híbrido futuro.
- §3.1: `units` completa, `unit_hour_exceptions.turnos jsonb`, `restaurants.politica_feriado`, `knowledge_facts.exemplos`, novas tabelas `reply_templates` e `knowledge_gaps`, colunas `pendente`/`simulada`/`simulado`/`payload`.
- §2.1: React Hook Form; design system com tokens Harmony (escuro padrão).
- Novo: indicador **% respondido pela IA** e fila de lacunas como mecanismo para a meta de 100% IA.
