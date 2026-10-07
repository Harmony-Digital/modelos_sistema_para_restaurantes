# Redesenho do painel no desktop — "central de operação"

> Spec aprovada em conversa em 07/10/2026 (protótipos no companheiro visual). Branch `ux-desktop` (worktree `~/harmony/ia-atendimento-ux`). **Nenhuma funcionalidade muda**: só layout, navegação, fluxo e identidade visual. A paleta atual (marinho + laranja `#F28C1D`, temas claro/escuro) é mantida. PRD §10 vale integralmente.

## 1. Objetivo e critério de sucesso
- No computador (≥ 1024 px) o painel usa a largura da tela, com **menu lateral** e conteúdo em grade, em vez do layout de celular centralizado (`max-w-xl` + barra inferior).
- Menos troca de telas: itens de lista abrem **ao lado** (lista + detalhe); Agenda numa visão só; "Mais" deixa de existir.
- Visual **operacional / central de controle**: sério, profissional, menos genérico.
- Celular e tablet (< 1024 px) mantêm a navegação atual (barra inferior), aprovada pelo dono; recebem só os novos agrupamentos/rotas e a nova tipografia.
- Todos os testes atuais continuam verdes; e2e ganha um projeto **desktop**.

## 2. Estrutura (≥ 1024 px)
- **Menu lateral fixo**, com grupos:
  - topo: nome do restaurante + botão **recolher/abrir** (« »);
  - `Início`;
  - **Atendimento**: `Conversas` (contador de aguardando), `Agenda`, `Simulador`;
  - **Restaurante**: `Conteúdo`, `Unidades`;
  - **Gestão** (dono/gerente): `Gastos`, `Equipe`, `Privacidade`, `Ajustes`.
- Recolhido: só ícones (com dica ao passar o mouse), largura ~56 px; preferência lembrada por usuário (cookie, lido no servidor para não piscar).
- Atendente vê só o que pode (mesmas regras de papel de hoje).
- Barra superior fina: título da tela, busca rápida (Ctrl+K), tema, conta. Faixa de alertas (gastos, modo demonstração) abaixo dela.

## 3. Telas
- **Início = central da operação:** linha de indicadores (aguardando, previstos hoje, eventos novos, % respondido pela IA, gasto de hoje em R$) com mini-gráfico dos últimos 7 dias onde houver série; abaixo, três colunas: fila **Aguardando atendimento** (tabela com espera em mm:ss), **Agenda de hoje** (avisos e eventos), **Alertas** (limite de gasto, prazo LGPD, importação parada, sem resposta). Clique leva ao item já aberto na tela certa.
- **Conversas:** lista (abas atuais como filtros) + conversa aberta ao lado; atalhos ↑/↓ navegar, Enter abrir, A assumir, Esc fechar.
- **Agenda:** uma tela por dia (seletor de data e de unidade) com linha do tempo juntando **avisos de presença** e **pedidos de evento**; o pedido abre ao lado (status, responsável, notas, telefone). As URLs antigas (`/agenda?aba=…`, `/previsao`) redirecionam.
- **Conteúdo:** abas `Cardápio` · `Informações` · `Mensagens`.
  - `Informações` inclui "**Sem resposta**" como lista de pendências com ação "responder" (cria a informação).
  - `Mensagens` inclui as **respostas rápidas**.
  - **Importar** vira botão dentro de Cardápio, Informações e Unidades (abre o fluxo atual de importação já com o alvo escolhido); `/conteudo?aba=importar` e `?aba=sem-resposta` redirecionam.
- **Unidades:** lista + unidade aberta ao lado com seções numa página (dados, horários, exceções, espaços) e âncoras.
- **Gestão:** `Gastos`, `Equipe`, `Privacidade` (telas atuais, em largura de desktop) e **Ajustes** (restaurante, horário de atendimento humano, modo demonstração, tema). `/mais/*` redireciona.
- **Simulador flutuante:** botão no menu (e atalho) abre o simulador como um "celular" ancorado no canto direito, sobre qualquer tela, sem sair dela; pode ser minimizado. Em < 1024 px segue como hoje.
- **Busca rápida (Ctrl+K):** paleta de comandos que leva a telas e itens (unidades, itens do cardápio, informações, conversas por nome de perfil); só dados que o usuário já pode ver (mesma DAL/RLS).

## 4. Identidade visual (todas as larguras)
- Tipografia: **IBM Plex Sans** (texto e títulos) + **IBM Plex Mono** (números, horários, códigos, etiquetas de status), via `next/font`; substitui Sora/DM Sans/JetBrains Mono.
- Densidade maior no desktop: tabelas com linhas finas, cabeçalhos em caixa-alta mono pequenos, cartões com borda de 1 px e raio menor (6–8 px); destaque laranja só para foco, seleção e o que pede ação.
- **Etiquetas de status** padronizadas (AGUARDA, IA, HUMANO, NOVO, CONFIRMADO, SIMULAÇÃO…) num componente único, com cores dos tokens existentes (sucesso, aviso, info, destrutivo).
- Indicador **● AO VIVO** onde há tempo real (Início, Conversas).
- Acessibilidade mantida: contraste AA nos dois temas, foco visível, alvos ≥ 44 px no toque, navegação por teclado no menu, na lista e na paleta de comandos.

## 5. Fora
Mudança de regras de negócio, banco ou worker; novas funcionalidades além de busca rápida e atalhos; redesenho do celular/tablet além de tipografia e agrupamentos.

## 6. Qualidade
- Testes de componentes para menu (aberto/recolhido, papéis), lista+detalhe, paleta de comandos, etiquetas e redirecionamentos.
- E2E: novo projeto **desktop** (1440×900) cobrindo menu, recolher, Início, Conversas lado a lado, Agenda unificada, importar a partir do Cardápio, Ajustes, simulador flutuante e Ctrl+K; projeto **celular** atual continua verde.
- Sem migration. Nada de banco no desenvolvimento além dos testes de sempre.
