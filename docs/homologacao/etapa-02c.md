# Homologação — plano 02-C (painel de S1 e simulador)

Roteiro para o dono. Tudo roda no banco local; o simulador **nunca** envia nada pelo WhatsApp.

## 1. Preparar
```bash
pnpm db:migrate
pnpm --filter @atd/db demo:s1          # 4 unidades, horários, exceções e informações de demonstração
pnpm dev                                # painel em http://127.0.0.1:3000
WHATSAPP_ACCESS_TOKEN=local-sem-meta pnpm --filter @atd/worker dev   # outro terminal: o worker que responde o simulador (token provisório: o simulador nunca chama a Meta)
```
Se o `demo:s1` disser "Esperado exatamente 1 restaurante; encontrado 0" (o banco foi apagado pelo `pnpm check`), crie o restaurante antes: `pnpm --filter @atd/db bootstrap --restaurante "Restaurante Demo" --dono dono@restaurante.local --nome-dono "Dono"` (com `SUPABASE_SERVICE_ROLE_KEY` exportada só no shell).

O simulador usa a IA de verdade e precisa de `OPENROUTER_API_KEY` com crédito e de `AI_TRIAGE_MODELS` no `.env` (ver `docs/homologacao/etapa-02b.md`, seção 5). Cada mensagem simulada custa uma fração de centavo e entra no limite de gastos de IA.

## 2. Unidades
1. Entre como dono. Abra **Unidades**: cada unidade mostra o selo ("Aberta agora · fecha às 23h", "Fechada · abre amanhã às 11h30", "Horário não cadastrado" ou "Desativada").
2. **Nova unidade**: salve sem nome e veja o erro no campo. Depois preencha nome e endereço, cole um link do Google Maps ("Compartilhar → Copiar link") e salve. A tela abre na aba **Horários**.
3. **Horários**: adicione turnos, use "Copiar segunda para dias úteis" e cadastre um turno que passa da meia-noite (ex.: 18:00–02:00). Aparece o aviso "Termina no dia seguinte (madrugada)." Salve.
4. **Exceções**: veja os feriados nacionais do ano com o comportamento da política; cadastre uma data especial (fechado o dia todo) e apague com confirmação.
5. Desative uma unidade em **Dados**: o selo vira "Desativada" e a IA para de citá-la.

## 3. Respostas
1. **Sem resposta**: perguntas que a IA não soube (geradas por clientes reais, nunca pelo simulador). "Responder" abre o formulário já com o assunto; salve uma resposta. "Ignorar" pede confirmação.
2. **Informações**: crie, edite e apague informações; veja as sugestões de temas comuns.
3. **Mensagens**: edite um texto e veja a prévia com dados reais. Variável escrita errada (`{ unidade }`) ou faltando mostra erro. "Restaurar padrão" volta o texto original.

## 4. Início e Mais
- **Início**: "Respondido pela IA hoje" (e nos últimos 7 dias) e as 3 perguntas sem resposta mais frequentes, com o atalho "Responder".
- **Mais → Restaurante**: nome, política de feriados e link da política de privacidade (só o dono edita).

## 5. Simulador (botão verde do WhatsApp; só dono e gerente)
1. Pergunte "abre domingo?". Em ~5 s aparece a resposta gravada pelo pipeline real (o primeiro contato também recebe o aviso de privacidade).
2. "estão abertos agora?" com várias unidades: aparece a lista; toque numa unidade.
   "endereço da Asa Sul": vem o texto e o cartão de localização. "abre no feriado e aceita pix?": pergunta composta, uma resposta para cada parte.
3. **Simular data e hora** → domingo 12:00 → "estão abertos agora?": a resposta usa o domingo. "Usar relógio real" volta ao normal.
4. **Ver detalhes**: modelo, custo e tempo de cada chamada da IA desta conversa, e "Respondeu X de Y perguntas com dado cadastrado". Se a consulta falhar, aparece "Tentar de novo".
5. "quero falar com um atendente": aparece o aviso de que a conversa foi para um atendente. Ela **não** entra em "Aguardando atendente" no Início. **Novo cliente** recomeça do zero.
6. Entre como atendente: o botão do simulador não aparece.

## 6. Testes automáticos
```bash
pnpm check                              # lint, tipos, testes (apaga o banco local de teste)
pnpm --filter @atd/web e2e              # pare o worker local antes: o e2e sobe o próprio, com IA falsa
```
Depois do `pnpm check`, prepare o banco de novo (seção 1): `pnpm db:migrate`, o **bootstrap** do restaurante (o `pnpm check` apaga o banco, então ele sempre faz falta aqui) e o `demo:s1`.

## Se o simulador não responder
- O worker está rodando? O Início mostra "IA: Online".
- Erro do OpenRouter aparece em **Ver detalhes** (com a causa). Crédito zerado ou modelo sem ZDR: ver `docs/homologacao/etapa-02b.md`, "Se a triagem falhar".
- Limite de gastos de IA atingido: a resposta é o aviso de modo econômico. A tela de limites chega na Etapa 08; por enquanto, ajuste direto na tabela `budget_limits` do banco local no SQL Editor do Supabase Studio local (http://127.0.0.1:54323) ou com `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`:
  ```sql
  update budget_limits set limite_usd = 5 where escopo = 'ia' and periodo = 'dia';
  ```
