# Homologação — Redesenho desktop do painel (07/10/2026)

Roteiro curto para o dono. Spec: [docs/specs/2026-10-07-ux-desktop-design.md](../specs/2026-10-07-ux-desktop-design.md);
plano: [docs/plans/ux-desktop.md](../plans/ux-desktop.md). Branch `ux-desktop`. Nenhuma regra de negócio, Server
Action de escrita, migration ou worker mudou: o que muda é a navegação, o layout em telas a partir de 1024 px e a
identidade visual (IBM Plex, etiquetas de status, números alinhados). Paleta de cores mantida.

## 1. Preparar
```bash
pnpm db:migrate                       # nada novo (sem migration nesta branch)
pnpm --filter @atd/db demo:s1         # unidades e dados de exemplo
pnpm dev                              # painel em http://127.0.0.1:3000
```
Worker em outro terminal, como em `docs/homologacao/etapa-08.md` (seção 1). Use o navegador do computador numa
janela larga (≥ 1280 px) e depois estreite para ~1024 px; no fim, confira no celular.

## 2. Roteiro (computador)

| # | Faça | Esperado |
|---|---|---|
| 1 | Entre como **dono** | Menu lateral à esquerda em grupos (Início · Atendimento: Conversas, Agenda, Simulador · Restaurante: Conteúdo, Unidades · Gestão: Gastos, Equipe, Privacidade, Ajustes); o item da tela atual tem a barra laranja; sem barra inferior |
| 2 | Clique em **Recolher menu** (setas no topo do menu) e recarregue a página | O menu vira uma coluna de ícones com dica ao passar o mouse; depois de recarregar continua recolhido, sem "piscar" aberto. **Abrir menu** volta ao normal |
| 3 | Veja o **Início** | Seis indicadores numa linha (Aguardando, Previstos hoje, Eventos novos, Conversas hoje com o gráfico de 7 dias, Respondido pela IA, Gasto IA hoje em R$); abaixo, três colunas: Aguardando atendimento, Agenda de hoje e Alertas |
| 4 | Abra o **Simulador** pelo menu (ou **Shift+S** fora de um campo de texto) | Um "celular" ancorado no canto direito, sem escurecer a tela: dá para clicar no menu e trocar de tela com ele aberto. **Minimizar** vira uma pílula no canto; **Shift+S** ou a pílula restauram, com o histórico e o rascunho preservados; **Esc** (com o foco no simulador) minimiza |
| 5 | No simulador: "quero falar com um atendente"; abra **Conversas** | A conversa chega em **Aguardando** sem recarregar. Clique nela: abre **ao lado** da lista. **Assumir**, escreva e **Enviar**: a resposta aparece no simulador. Teclado: ↑/↓ percorrem a lista, Enter abre, **A** assume, **Esc** fecha |
| 6 | Vá em **Ajustes** e ligue **Modo demonstração** | Toast "Modo demonstração ligado". Ajustes reúne Restaurante, Horário de atendimento humano, Modo demonstração, Tema e Conta (antes em "Mais") |
| 7 | No simulador: "hoje vou na Asa Norte com 4 pessoas à noite" e "quero fazer um aniversário para 30 pessoas na Asa Norte amanhã"; abra **Agenda** | Agenda única por dia: a linha do tempo de hoje mostra o aviso com o selo **SIMULAÇÃO**; o pedido de amanhã aparece em "Pedidos para responder em outros dias". Clique nele: vai para o dia do pedido e o detalhe abre **ao lado** da linha do tempo, com as mesmas ações de antes. Ao rolar, o detalhe fica abaixo da barra superior. **Todos os pedidos (N novos)**, no topo da Agenda, mostra a fila completa de pedidos de evento com o filtro de status (Novo, Em contato, Confirmado, Recusado, Cancelado), como a antiga aba Eventos; o pedido abre ao lado da lista |
| 7a | No simulador: "está aberto agora?" (com mais de 3 unidades) e toque em **Ver unidades** | A lista de unidades abre **dentro do celular** do simulador, não no pé da janela |
| 8 | **Conteúdo** | Abre na aba **Cardápio** (as outras: Informações, com "Sem resposta" dentro, e Mensagens, com as respostas rápidas). **Importar** abre o importador já no alvo Cardápio; importe um CSV de 2 itens, revise e confirme |
| 9 | **Unidades** | Lista à esquerda, unidade aberta ao lado com seções (dados, horários, exceções, espaços) |
| 10 | **Ctrl+K** (ou o botão **Busca rápida** na barra superior) | Paleta de busca: telas do menu e, a partir de 2 letras, unidades, itens do cardápio, informações e conversas. ↑/↓ escolhem, Enter abre, Esc fecha |
| 11 | Estreite a janela para ~1024 px com o menu aberto e o simulador aberto | Nada corta nem rola para o lado; o simulador fica compacto (controles atrás do botão de ajustes) e termina acima do campo de resposta de Conversas: **Sair** e **Enviar** continuam clicáveis; clicar fora dele o minimiza |
| 11a | Com um **alerta de gasto** ativo (faixa no topo), abra uma conversa em **Conversas** (1440 e 1024 px) | A página não rola: só a lista e a conversa rolam; o campo de resposta e o **Enviar** ficam na tela. Com o simulador aberto, a pílula começa abaixo da faixa e do cabeçalho da conversa: **Ajustar limites** e o **X** de fechar a conversa continuam clicáveis |
| 12 | Endereços antigos: `/mais/gastos`, `/previsao`, `/agenda?aba=eventos`, `/conteudo?aba=sem-resposta` | Levam à tela nova certa (Gestão → Gastos, Agenda, Agenda → Todos os pedidos, com o mesmo filtro de status, Conteúdo → Informações) |
| 13 | Entre como **gerente restrito** e como **atendente** | O menu mostra só o que cada um pode (atendente: sem Gestão e sem Simulador); a busca rápida não traz nada de outra unidade |
| 14 | No **celular** | Igual a antes: barra inferior com Início, Conversas, Agenda, Conteúdo e **Mais** (folha com o resto, incluindo Ajustes e Gestão) |

## 3. Decisões que o dono deve conhecer
- **Aba padrão de Conteúdo = Cardápio** (a primeira). "Sem resposta" fica dentro de Informações: um clique a mais do que antes.
- **↑/↓ em Conversas (≥ 1024 px):** com o foco solto na página (sem campo de texto em foco), as setas percorrem a
  lista, mesmo depois de clicar no texto da conversa; para rolar a conversa, use o mouse/trackpad ou role com o
  foco na área das mensagens.
- **Simulador aberto em telas largas (≥ 1280 px):** o painel não é modal e cobre parte do canto direito — parte do
  campo de resposta de Conversas fica por baixo dele (o "X" de fechar a conversa e a faixa de alertas ficam livres:
  o painel começa abaixo deles). Minimize (pílula ou Shift+S) para responder. Em ~1024 px ele termina acima do
  campo de resposta e clicar fora o minimiza. Com isso o celular do simulador fica um pouco mais baixo.
- **Agenda:** a visão por dia é a padrão; a fila completa de pedidos de evento fica em **Todos os pedidos**, com o
  contador de novos. No dia, "Pedidos para responder em outros dias" mostra até 8 e leva à fila completa.
- **Busca rápida leva à aba, não ao item:** item do cardápio abre Conteúdo → Cardápio e informação abre
  Conteúdo → Informações (sem rolar até o item); unidade e conversa abrem o próprio item.
- **Busca sem índice de trigramas:** procura por trecho do nome, sem acento; com muitos clientes no futuro, uma
  migration com `pg_trgm` deixa mais rápida.
- **Contraste:** a etiqueta da linha "minha" em Conversas fica em ~4,4:1 só durante o hover (abaixo de AA nesse
  instante); a paleta foi mantida por decisão do dono.

## 4. Pendências conhecidas (menores, ficam para depois)
- Durante o carregamento de uma tela (≥ 1024 px), a faixa de alertas de gasto some por um instante.
- Agenda (≥ 1024 px): salvar um pedido como recusado ou cancelado no detalhe ao lado tira o pedido da linha do tempo
  (o detalhe continua aberto; ele aparece em "Mostrar cancelados" e em Todos os pedidos com esse status).
- Importar horários ou espaços a partir de Unidades: a lista à esquerda só mostra os dados novos depois de navegar
  (o resultado da importação fica na tela até lá; atualizar a lista na hora apagaria esse resultado).
- Início: "Previstos hoje" e "Agenda de hoje" usam o fuso padrão (São Paulo) e o gráfico de 7 dias o fuso do
  restaurante; só diverge para um restaurante fora desse fuso.
- Alguns endereços antigos passam por dois redirecionamentos seguidos (funcionam, só um salto a mais).
- Esc só minimiza o simulador com o foco dentro dele.

## 5. O que não muda
Worker, orçamento, Gastos, retenção, LGPD, RLS e Server Actions. A amostra publicada segue o runbook
(`docs/runbooks/producao-amostra.md`), agora com os caminhos novos (Ajustes → Modo demonstração; Gestão → Gastos/Equipe).
