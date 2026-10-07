# Homologação — Modo demonstração (07/10/2026)

Roteiro curto para o dono. Problema: tudo o que nasce no simulador fica marcado como simulação e o painel esconde
esses dados (isolamento das Etapas 02-C a 04). Como a amostra só é mostrada pelo simulador, o painel ficava vazio
na demonstração. O **Modo demonstração** resolve isso com um interruptor.

## 1. Preparar
```bash
pnpm db:migrate                       # migrations até a 0044
pnpm --filter @atd/db demo:s1         # unidades e dados de exemplo
pnpm dev                              # painel em http://127.0.0.1:3000
```
Worker em outro terminal, como em `docs/homologacao/etapa-08.md` (seção 1).

## 2. Roteiro

| # | Faça | Esperado |
|---|---|---|
| 1 | Entre como **dono** e abra **Mais** | Em **Restaurante** aparece **Modo demonstração**, desligado, com o texto: "Ligado: conversas, avisos e pedidos de evento do simulador aparecem no painel como se fossem reais, marcados 'Simulação'. Desligue quando começar a atender clientes reais." |
| 2 | Com o modo **desligado**, abra o simulador e mande "Hoje vou na Asa Norte com 4 pessoas às 20h" | O simulador responde "Anotado: …"; **Agenda → Previsão** de hoje **não** mostra o aviso (como antes) |
| 3 | Ligue **Modo demonstração** | Toast "Modo demonstração ligado" |
| 4 | Abra **Agenda → Previsão** de hoje na Asa Norte | O aviso de 4 pessoas aparece com o selo **Simulação** e entra no total; o Início conta em **Previstos hoje** |
| 5 | No simulador: "quero fazer um aniversário para 30 pessoas na Asa Norte amanhã" | Em **Agenda → Eventos** o pedido aparece com o selo **Simulação**; o Início conta em **Pedidos de evento novos**. No detalhe do pedido, mude o status para "Em contato": funciona. Não há botão de telefone (cliente simulado não tem telefone) |
| 6 | No simulador: "quero falar com um atendente" | Em **Conversas → Aguardando** a conversa aparece com o selo **Simulação**, sem precisar do filtro (o "Mostrar simulações" some com o modo ligado); o contador da barra e o Início contam a conversa; dá para assumir e responder |
| 7 | Entre como **gerente** | Vê o interruptor, mas não consegue mudar ("Só o dono muda."); gerente restrito a uma unidade continua vendo só a sua |
| 8 | Entre como **atendente** | Não vê o interruptor em Mais |
| 9 | Desligue o modo (como dono) | Tudo o que é simulação volta a sumir do painel; Conversas volta a ter "Mostrar simulações" |

## 3. O que não muda
- Worker e IA: o simulador continua igual, com o limite próprio de **Simulação** em Gastos.
- Gastos: a simulação segue numa linha à parte, fora do total dos clientes.
- Retenção: simulações com mais de 7 dias continuam sendo apagadas pela limpeza diária.
- **Perguntas sem resposta** (Início): o worker não registra lacunas de conversas simuladas, então esse cartão segue só com clientes reais.
- Toda troca do interruptor fica na auditoria (`restaurante.modo_demonstracao`, com antes e depois).

**Antes de atender clientes reais, desligue o modo.**
