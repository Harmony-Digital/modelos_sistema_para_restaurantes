# Redesenho do painel no desktop ("central de operação") — plano enxuto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Processo acelerado:** interfaces, regras, testes e decisões. Revisão por bloco (A–D) + revisão final. Trabalho só na worktree `~/harmony/ia-atendimento-ux` (branch `ux-desktop`); a pasta da `main` não é tocada. `next dev` desta worktree sempre na **porta 3001**. **Não rodar e2e enquanto o dono estiver em reunião** (o controlador avisa).

**Goal:** painel com menu lateral recolhível, telas em grade e lista+detalhe no desktop, menos telas, simulador flutuante, busca rápida e identidade "operacional", sem mudar nenhuma funcionalidade.

**Architecture:** um shell responsivo (`< 1024 px`: barra inferior atual; `≥ 1024 px`: menu lateral + barra superior) alimentado por uma única configuração de navegação; rotas reorganizadas com redirecionamentos; telas de lista usam *layouts* de segmento do Next (lista no layout, detalhe na página); componentes visuais novos (etiqueta de status, número mono, tabela densa, "ao vivo") sobre os tokens atuais.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, shadcn/ui, `next/font` (IBM Plex Sans + IBM Plex Mono), Vitest + Testing Library, Playwright.

**Spec:** [docs/specs/2026-10-07-ux-desktop-design.md](../specs/2026-10-07-ux-desktop-design.md). PRD §10 vence conflitos.

## Global Constraints

- Branch `ux-desktop`, worktree `~/harmony/ia-atendimento-ux`. Nunca `--force`. Commits em português no imperativo, terminando com as duas linhas exatas `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_015ce8Cfg6prhqAgCRc3Vzvo`.
- **Nenhuma regra de negócio, Server Action, DAL de escrita, migration ou worker muda.** Leituras novas só onde a spec pede (série de 7 dias do Início, busca rápida), pela DAL com RLS.
- Paleta e tokens de cor atuais mantidos (claro e escuro); só tipografia, raio, densidade e componentes.
- Breakpoint de desktop: `lg` (≥ 1024 px). Abaixo disso, a navegação inferior atual.
- Acessibilidade: contraste AA nos dois temas, foco visível, alvos ≥ 44 px no toque, teclado em menu/lista/paleta.
- Todo endereço antigo redireciona (`/mais/*`, `/previsao`, `/respostas`, `/agenda?aba=…`, `/conteudo?aba=importar|sem-resposta`).
- TDD por tarefa; `pnpm check` e e2e (projetos **celular** e **desktop**) no fim dos blocos C e D.
- Consultar Context7: Next 16 (layouts de segmento, `redirect`, `cookies`), `next/font/google`, cmdk (se usado na paleta — já é dependência do shadcn? confira; dependência nova precisa de justificativa no relatório).

## Decisões deste plano

1. **Navegação única:** `apps/web/lib/navegacao.ts` exporta os grupos/itens (rótulo, rota, ícone, papéis, contador) usados pelo menu lateral e pela barra inferior (na barra inferior: Início, Conversas, Agenda, Conteúdo, Mais→ que abre uma folha com o resto dos itens).
2. **Rotas novas:** `/ajustes` (restaurante, horário humano, modo demonstração, tema), `/gestao/gastos`, `/gestao/equipe`, `/gestao/privacidade` (as páginas atuais de `/mais/*` mudam de lugar; `/mais` e `/mais/*` redirecionam). `/privacidade` pública não muda.
3. **Lista + detalhe:** `conversas/layout.tsx` e `unidades/layout.tsx` renderizam a lista na coluna esquerda em `lg+` e o `children` (detalhe) à direita; em `< lg` o layout mostra só a lista em `/conversas` e só o detalhe em `/conversas/[id]` (comportamento atual).
4. **Agenda:** `/agenda?dia=AAAA-MM-DD&unidade=…&pedido=<id>`; a linha do tempo junta avisos e pedidos de evento do dia; `pedido` abre o detalhe ao lado (`lg+`) ou em folha (`< lg`).
5. **Conteúdo:** `?aba=cardapio|informacoes|mensagens`; Sem resposta dentro de Informações; respostas rápidas dentro de Mensagens; botão "Importar" abre o fluxo atual com `alvo` pré-selecionado (cardápio, informações; em Unidades: horários e espaços).
6. **Menu recolhido:** cookie `atd_menu=recolhido|aberto`, lido no layout do servidor (sem piscar).
7. **Simulador flutuante:** o `simulator-dialog` atual vira um painel ancorado (≥ lg) com minimizar; abre pelo menu e por atalho `Shift+S`; em `< lg` segue a folha atual.
8. **Busca rápida:** `Ctrl/Cmd+K`; fonte: uma leitura nova `buscarNoPainel(db, claims, termo)` na DAL (unidades, itens do cardápio, informações, conversas por nome de perfil), ≤ 20 resultados, RLS do usuário.

## Review Focus

1. **Gerente restrito / atendente** veem no menu só o que podem e a busca rápida não retorna nada de outra unidade (Tasks 2, 7).
2. **Link antigo salvo** (`/mais/gastos`, `/previsao`, `/conteudo?aba=sem-resposta`) leva à tela nova certa, preservando parâmetros úteis (Tasks 2, 5, 6).
3. **Tela entre 1024 e 1280 px com menu aberto** não corta tabelas nem o detalhe (lista+detalhe com larguras mínimas e rolagem própria) (Tasks 1, 4).
4. **Tempo real** (contador de aguardando, fila, Agenda) continua atualizando no layout novo, inclusive com o modo demonstração (Tasks 3, 4, 5).
5. **Teclado:** atalhos não disparam quando o foco está num campo de texto (compositor da conversa, formulários) (Tasks 4, 7).

## Mapa de arquivos

| Arquivo | Task |
|---|---|
| `apps/web/app/layout.tsx` (fontes), `app/globals.css` (tipografia, raio, densidade), `components/ui/{etiqueta-status,numero,tabela,ao-vivo}.tsx` | 1 |
| `lib/navegacao.ts`, `components/shell/{app-shell,menu-lateral,barra-superior,bottom-nav}.tsx`, `app/(painel)/layout.tsx`, `app/(painel)/{ajustes,gestao/*}/**`, redirects de `mais/*` | 2 |
| `app/(painel)/page.tsx`, `components/home/*`, leitura `serieUltimos7Dias` na DAL | 3 |
| `app/(painel)/conversas/{layout,page,[id]/page}.tsx`, `app/(painel)/unidades/{layout,page,[id]/page}.tsx`, atalhos | 4 |
| `app/(painel)/agenda/**`, `previsao` redirect, componentes da linha do tempo | 5 |
| `app/(painel)/conteudo/**`, `respostas` redirect, botões de importar | 6 |
| `components/simulator/*` (flutuante), `components/shell/paleta-comandos.tsx`, `buscarNoPainel` na DAL | 7 |
| `apps/web/playwright.config.ts` (projeto desktop), e2e, docs | 8 |

Blocos: **A** = Tasks 1–2 · **B** = Tasks 3–5 · **C** = Tasks 6–7 · **D** = Task 8 (+ revisão final).

---

### Task 1: Fundação visual
- Fontes IBM Plex Sans (400/500/600) e IBM Plex Mono (500/600) via `next/font/google`, variáveis CSS; remover Sora/DM Sans/JetBrains Mono; tokens de tipografia (`--font-sans`, `--font-mono`), raio padrão 8 px (cartões 8, botões 6), densidade das tabelas.
- Componentes: `EtiquetaStatus` (`variante: aguarda|ia|humano|novo|em_contato|confirmado|recusado|cancelado|simulacao|erro|ok`, texto mono caixa-alta, cores dos tokens), `Numero` (mono, `tabular-nums`, tamanhos), `Tabela` densa (cabeçalho mono pequeno caixa-alta, linhas finas, linha selecionável com barra laranja à esquerda), `AoVivo` (ponto + "AO VIVO", `aria-live` não intrusivo).
- Trocar os selos/badges existentes (Simulação, status de evento, estado de conversa) por `EtiquetaStatus` sem mudar textos visíveis além da caixa-alta.
- [ ] Testes (componentes, contraste das variantes nos dois temas via tokens, `a11y.test.tsx` atualizado) → implementar → `pnpm vitest run --project unit --project ui apps/web && pnpm typecheck && pnpm lint` → commit "Adota a identidade operacional com IBM Plex e etiquetas de status".

### Task 2: Shell responsivo, menu lateral e reorganização de rotas
- `lib/navegacao.ts` (decisão 1) com papéis e contadores; `MenuLateral` (grupos, recolher/abrir com cookie, dicas no modo recolhido, item ativo com barra laranja, contador de Conversas em tempo real reaproveitando o atual); `BarraSuperior` (título, botão da busca rápida — abre a paleta da Task 7; até lá desabilitado —, tema, conta); `AppShell` escolhe por breakpoint; barra inferior usa a mesma configuração e ganha a folha "Mais" com os demais itens.
- Rotas: `/ajustes` (restaurante, horário humano, modo demonstração, tema — mesmas Server Actions), `/gestao/gastos|equipe|privacidade` (páginas movidas), redirects permanentes de `/mais` e `/mais/*`.
- [ ] Testes (menu por papel: dono, gerente restrito, atendente; recolher persiste; item ativo; redirects; barra inferior < lg) → implementar → commit "Adiciona o menu lateral recolhível e reorganiza Ajustes e Gestão".

**Fim do Bloco A → revisão.**

### Task 3: Início como central da operação
- Linha de indicadores com `Numero` (aguardando, previstos hoje, eventos novos, % respondido pela IA, gasto de hoje em R$) + mini-gráfico de 7 dias (`serieUltimos7Dias(db, claims)` na DAL: conversas reais/dia — ou simuladas no modo demonstração —, gasto IA/dia; uma consulta, índices existentes, EXPLAIN no relatório) desenhado em SVG simples (sem lib nova).
- Três colunas em `lg+` (uma em `< lg`): Aguardando (Tabela com espera mm:ss ao vivo), Agenda de hoje, Alertas (gasto, prazo LGPD, importação parada, sem resposta — reaproveitando os cartões atuais). Cada linha leva ao item aberto na tela certa.
- [ ] Testes (DAL da série, componentes, links) → implementar → commit "Transforma o Início na central da operação".

### Task 4: Lista + detalhe em Conversas e Unidades
- Layouts de segmento (decisão 3); colunas com largura mínima e rolagem própria; estado vazio no detalhe ("Escolha uma conversa"); atalhos em Conversas (↑/↓, Enter, A, Esc) ignorados quando o foco está em campo de texto; Unidades com seções (dados, horários, exceções, espaços) e âncoras numa página.
- [ ] Testes (layout em lg e < lg, atalhos e foco, tempo real da lista com detalhe aberto) → implementar → commit "Abre conversas e unidades ao lado da lista".

### Task 5: Agenda unificada
- `/agenda?dia&unidade&pedido`: seletor de dia/unidade, linha do tempo do dia com avisos (`EtiquetaStatus`) e pedidos de evento; detalhe do pedido ao lado (lg+) ou folha (< lg) com as mesmas ações; redirects de `/previsao` e `/agenda?aba=…` preservando dia/unidade.
- [ ] Testes (junção e ordenação por horário, filtros, redirects, modo demonstração) → implementar → commit "Junta avisos e eventos numa Agenda única por dia".

**Fim do Bloco B → revisão.**

### Task 6: Conteúdo em três abas e Importar dentro de cada tela
- Abas Cardápio · Informações (com "Sem resposta" como pendências e ação "responder") · Mensagens (com respostas rápidas); botão "Importar" em Cardápio, Informações e Unidades abrindo o fluxo atual com o alvo; redirects de `/respostas`, `?aba=importar` (vai para Cardápio com o importador aberto) e `?aba=sem-resposta` (Informações).
- [ ] Testes → implementar → **`pnpm check`** → commit "Reorganiza Conteúdo em três abas com importação em cada tela".

### Task 7: Simulador flutuante e busca rápida
- Simulador ancorado no canto (lg+), minimizar/restaurar, atalho `Shift+S`, sobrevive à navegação entre telas (montado no layout do painel); `< lg` como hoje.
- Paleta `Ctrl/Cmd+K` com telas + `buscarNoPainel` (decisão 8); setas/Enter/Esc; nada fora do que o usuário vê (teste de banco com gerente restrito).
- [ ] Testes → implementar → **`pnpm check`** → commit "Adiciona o simulador flutuante e a busca rápida".

**Fim do Bloco C → revisão.**

### Task 8: E2E desktop, ajustes de celular e registros
- Projeto Playwright **desktop** (1440×900) com specs: menu e recolher, Início, Conversas lado a lado (assumir/responder), Agenda unificada (aviso e pedido do simulador com modo demonstração), Importar a partir do Cardápio (CSV), Ajustes (modo demonstração), simulador flutuante, Ctrl+K; ajustar specs **celular** às rotas novas sem afrouxar asserções.
- Docs: `docs/homologacao/ux-desktop.md` (roteiro curto), PLAN (seção "Redesenho desktop" com evidência), CLAUDE "Onde paramos", `cp CLAUDE.md AGENTS.md`; runbook da amostra (caminhos novos: Ajustes → modo demonstração).
- [ ] `pnpm check` + e2e (celular e desktop) verdes → commit "Adiciona o e2e desktop e o roteiro do redesenho".

**Fim → revisão final → onda única de correções → re-revisão.**
