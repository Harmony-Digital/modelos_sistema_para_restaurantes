# Registro da execução — plano 02-A (design system)

> Cópia versionada do ledger de execução por subagentes (rascunho de trabalho em `.superpowers/`, que é ignorado pelo git). Cada linha `Ruling:` é uma decisão tomada durante a execução, com motivo e custo se estiver errada.

# SDD ledger — plan: docs/plans/etapa-02a-design-system.md
Spec: docs/specs/2026-10-05-etapa-02-s1-design.md (+ PRD adendo Etapa 02). Branch: etapa-02-s1 (base d10cfff).

## Pre-flight scan
| Par/Task | Produz → Consome | Achado |
|---|---|---|
| T1↔todas | projeto ui (jsdom, alias @) e unit ampliado p/ apps/web/**/*.test.ts | ok |
| T2↔T3 | globals.css/tokens são fonte de verdade; CLI shadcn pode reescrever globals.css | T3 já manda restaurar e o teste de contraste pega |
| T2↔T12 | contrastRatio usado no colors.test do simulador via alias @ | ok (alias no unit) |
| T3↔T4..T12 | Button (h-11), Dialog, Switch, Toaster | ok |
| T4↔T5,T9,T10 | Field/TextInput/PasswordInput/useZodForm/applyServerErrors/ActionResult | tipagem genérica RHF+Zod4 pode exigir ajuste — T4 autoriza ajuste interno |
| T6↔T7,T8,T11,T12 | TopBar/AppShell(floating)/layout | T12 reescreve layout (ok, ordem certa) |
| T7↔T2 | THEME_COOKIE/parseTema | ok |
| T8↔T11 | comentário placeholder substituído na T11 | ok |
| T9↔T13 | e2e auth.spec seletores exact; T13 extrai helpers | ok |
| T10↔T9 | AuthCard | ok |
| T11↔db | column grants (estado, atendente_id) e self_insert audit exige ator_tipo staff | ok |
| T12↔02-C | contrato SimMessage/WhatsAppChat | registrado na spec |
| Cada task | testes vs código revisados na escrita | ok |

Ruling: implementers em sonnet (opus nas tasks 10 e 11: auth e RLS); revisores sonnet, opus em 4, 10, 11 e revisão final — custo se errado: tokens.

## Progress
Task 1: dispatched (base d10cfff, sonnet)
Task 1: complete (commits d10cfff..f0eecbb, review clean; desvio aceito: @vitejs/plugin-react também na raiz)
Task 2: dispatched (base f0eecbb, sonnet)
Task 2: review — Approved; Important (plan-mandated): teste de sincronia tokens↔globals.css só confere presença do hex no arquivo (não pega troca de cor repetida)
Ruling: rodada 1 — teste por variável e por tema (parse dos blocos :root/[data-theme=dark] e [data-theme=light]) + themeColor do viewport seguindo o cookie (generateViewport) — custo se errado: nenhum
Task 2: minor (deferred): pares de contraste de status sobre fundo, accent/popover; variante dark: só com atributo presente
Task 2: fix round 1/5 (2 addressed, 0 open; commits f71d17d..ff9df4a)
Task 2: complete (commits f0eecbb..ff9df4a, review clean)
Task 3: dispatched (base ff9df4a, sonnet)
Task 3: review — Needs fixes: Badge destructive texto branco sobre #F87171 (~2,8:1); Badge link text-primary (laranja como texto); botões de fechar em inglês, com ~16px e foco fora do padrão; Switch < 44px
Ruling: corrigir todos + minors (Sheet ≤200ms, bottom sheet com max-h-[90dvh] overflow-y-auto, foco de Badge/Switch no padrão outline-ring) — acessibilidade é constraint do plano — custo se errado: nenhum
Task 3: fix round 1/5 (4 addressed; commits bc59ba6..fa7d87b); fix round 2/5 (switch hit area ≥44px; fa7d87b..a585c6e)
Task 3: minor (deferred): Sheet left/right/top sem max-h/safe-area; botão fechar do Dialog pode sobrepor título estreito; testes de UI checam classes, não layout calculado
Task 3: complete (commits ff9df4a..a585c6e, review clean)
Task 4: dispatched (base a585c6e, sonnet; review opus)
Task 4: review (opus) — spec ✅; Needs fixes: erros de servidor de campos inexistentes somem e bloqueiam foco; fieldErrorsFromZod descarta issue sem path; root.server nunca é exibido
Ruling: corrigir 1–3 + minors 5 (group/field nomeado), 6 (erro do campo com aria-live=polite em vez de role=alert; resumo continua anunciado), 8 (hora/data vazias: 'Informe…'; telefone aceita +55 e rejeita letras; e-mail em minúsculas), 9 (SubmitButton com aria-disabled sem perder foco) e 10 (testes); 4 mantido (constraint pede aria-pressed + rótulo); 7 documentado (ids = nomes do RHF, só nível raiz) — custo se errado: nenhum
Task 4: fix round 1/5 (all addressed; commits d31006d..198d144)
Task 4: minor (deferred): applyServerErrors usa control._fields (interno do RHF, fixar versão/comentário); aspas simples no submit-button
Ruling: Server Actions novas (Task 10 em diante) usam actionErrorFromZod em vez de fieldErrorsFromZod — custo se errado: nenhum
Task 4: complete (commits a585c6e..198d144, review clean)
Task 5: dispatched (base 198d144, sonnet)
Task 5: review — Needs fixes: maxLength corta colagem antes da máscara; cursor pula ao editar no meio; TagInput ordem de tab ≠ visual, sem lista/anúncio de etiquetas, foco perdido ao remover, chip de 32px
Ruling: corrigir 1–5 + minors (blur não confirma rascunho ao clicar dentro do componente; compor onBlur/onKeyDown do chamador; colar 'a,b' divide; Enter durante IME ignorado; aviso ao atingir o máximo; testes de Select/SwitchField/colagem/edição no meio); TagInput volta a ter etiquetas antes do campo no DOM (ul/li), campo ligado por htmlFor via Field — custo se errado: nenhum
Task 5: fix round 1/5 (all addressed; commits 47f8f79..5d0b870)
Task 5: minor (deferred): DDD 55 (RS) com dígito extra vira número errado na máscara (remover 55 só em colagem/+55/13 dígitos); duplicado/Enter vazio sem anúncio; plural 'Limite de 1 etiquetas'
Task 5: complete (commits 198d144..5d0b870, review clean)
Task 6: dispatched (base 5d0b870, sonnet)
Task 6: implemented (commit 93b1283), dispatching review
Task 6: review — spec ✅, quality Approved; 1 Important (text-primary laranja como texto/ícone no tema claro ≈2.3:1) + verificado: falta viewportFit 'cover' (safe-area = 0)
Ruling: estado ativo da nav e ícone do EmptyState usam text-link (#F7B265 escuro / #9E5306 claro); barra indicadora segue bg-primary — o plano mandava text-primary, mas a restrição global de contraste (spec) vence — custo se errado: só troca de classe
Ruling: viewportFit 'cover' no generateViewport — sem ele os env(safe-area-inset-*) do shell valem 0 no iPhone — custo: nenhum
Task 6: fix round 1/5 dispatched
Task 6: fix round 1/5 (all addressed; commits 93b1283..2a0c51e; re-review feita pelo controlador — diff de 16 linhas)
Task 6: minor (deferred): <main> por página em vez de no AppShell; slot floating sem z-index (Task 12 posiciona acima da nav z-40)
Task 6: complete (commits 5d0b870..2a0c51e, review clean)
Task 7: dispatched (base 2a0c51e, sonnet)
Task 7: implemented (commit 7d86f25), dispatching review
Task 7: review — spec ✅, quality Approved, sem Critical/Important
Ruling: adicionar teste unitário de setTheme (tema inválido não grava cookie; sem sessão não grava) + ícone de check na opção selecionada — CLAUDE.md exige teste do caso ruim; o plano omitiu — custo: ~1 arquivo de teste
Ruling: signOut sem requireStaff é exceção aceitável (só encerra sessão) — custo se errado: nenhum
Task 7: fix round 1/5 dispatched
Task 7: fix round 1/5 (all addressed; commits 7d86f25..3655a20; conferido pelo controlador)
Task 7: complete (commits 2a0c51e..3655a20, review clean)
Task 8: dispatched (base 3655a20, sonnet)
Task 8: implemented (commit db6ac02), dispatching review
Task 8: review — spec ✅, quality Approved, sem Critical/Important
Task 8: minor (deferred): StatCard aria-label duplica leitura (preferir dl/dt/dd); gasto USD via Number() só exibição; grid-cols-2 apertado em 320px — conferir no e2e celular (Task 13)
Task 8: complete (commits 3655a20..db6ac02, review clean)
Task 9: dispatched (base db6ac02, sonnet)
Task 9: implemented (commit 8af062a; e2e 4/4), DONE_WITH_CONCERNS
Ruling: seletores e2e por regex /^E-mail/ /^Senha/ em vez de exact:true — o rótulo inclui o marcador "*" de obrigatório; regex ancorada mantém a desambiguação — custo: nenhum
Ruling: e2e local com service role tirada de `supabase status` só no shell — conferido: nada gravado em arquivo nem commitado
Task 9: dispatching review
Task 9: review (opus) — spec ✅, quality Needs fixes: 1 Important (MFA envia código incompleto ao Supabase após noValidate — regressão; consome rate limit)
Ruling: incluir também Minor 1 (só invalid_credentials vai para Senha; 429/rede vão para FormError genérico) e Minor 2 (teste unitário do MFA) — é código de auth, custo baixo
Task 9: fix round 1/5 dispatched
Task 9: fix round 1/5 (all addressed; commits 8af062a..61846d6; conferido pelo controlador; e2e 4/4)
Task 9: minor (deferred): erro de tela do MFA em <p role=alert> próprio (não FormError); sem ErrorSummary no login (2 campos)
Task 9: complete (commits db6ac02..61846d6, review clean)
Task 10: dispatched (base 61846d6, sonnet)
Task 10: implemented (commit 5fe33ce; e2e 6/6), DONE_WITH_CONCERNS (safeNext endurecido além do brief — aceito; e2e regex /^Nova senha/ — mesma regra da Task 9)
Task 10: dispatching review (opus — auth)
Task 10: review (opus) — spec ✅, quality Needs fixes: 1 Important (/definir-senha aceita qualquer sessão aal1 → troca de senha sem MFA para dono/gerente com senha roubada)
Ruling: /definir-senha (página e action) só aceita sessão cujo amr contém método 'invite' (conferido empiricamente no GoTrue local); qualquer outra → redirect('/'). Plano só checava sub; a spec exige MFA para dono/gerente — custo se errado: convidado precisaria de novo convite
Ruling: incluir Minors 2 (error.code same_password/weak_password), 3 (getClaims em try/catch), 4 (sessão antes da validação), 7 (&amp;). Minors 5 (scanner de link queima token) e 6 ("1 hora" vs expiry de produção) vão para a doc de deploy/homologação na Task 13
Task 10: fix round 1/5 dispatched
Task 10: fix round 1/5 (commits 5fe33ce..cd679cf) — amr real do convite é 'otp' (não existe 'invite'); conferido pelo controlador
Ruling: 'otp' também cobre magic link/OTP por e-mail → além do amr otp, exigir que, se o usuário já tem fator MFA verificado (nextLevel aal2), a sessão esteja em aal2 — convidado novo não tem fator, então não é afetado — custo se errado: dono com MFA que perdeu a senha usa recuperação normal
Task 10: fix round 2/5 dispatched
Task 10: fix round 2/5 (all addressed; commits cd679cf..6cbb3ca; podeDefinirSenha = amr otp + MFA já cumprido se houver fator; conferido pelo controlador; e2e 7/7)
Task 10: minor (deferred → Task 13 docs): scanner de link corporativo consome token no GET; "1 hora" deve casar com expiry de e-mail OTP em produção; template e Site URL de produção configurados no dashboard
Task 10: complete (commits 61846d6..6cbb3ca, review clean)
Task 11: dispatched (base 6cbb3ca, sonnet)
Task 11: implemented (commit 6afbfa5), dispatching review (opus — RLS/concorrência)
Task 11: review (opus) — spec ✅, quality Approved, sem Critical/Important
Ruling: fila "aguardando atendente" ordenada do mais antigo para o mais novo (last_message_at asc) — com >50, quem espera há mais tempo não pode sumir; o plano mandava desc — custo: só ordem. Rótulo continua "última mensagem" (não há coluna de início do handoff; entra na Etapa 06)
Ruling: try/catch com toast.error genérico na ação; testes da lista (ia/encerrada fora, humano dentro, ordem) e do caminho nao_encontrada
Task 11: minor (deferred → Etapa 06): mensagens do lote consumidas em silêncio se a devolução cruzar com commit "humano" do worker; avisar cliente ao devolver
Task 11: fix round 1/5 dispatched
Task 11: fix round 1/5 (all addressed; commits 6afbfa5..f94ca95; conferido pelo controlador). EXPLAIN da fila não rodado — consulta do painel, LIMIT 50, índice por restaurant/estado; revisar no plano 02-C
Task 11: complete (commits 6cbb3ca..f94ca95, review clean)
Task 12: dispatched (base f94ca95, sonnet)
Task 12: implemented (commit 674c9ce), DONE_WITH_CONCERNS — desvios aceitos: FAB z-50 acima da nav z-40; plugin react no projeto unit do vitest; fechar próprio "Fechar" size-11. Conferência visual no navegador fica para o e2e celular da Task 13
Task 12: dispatching review
Task 12: review — spec ✅, quality Needs fixes: 6 Important (moldura 852px corta em notebook; largura no md; input 15px dá zoom no iOS; teclado virtual; safe-area topo; folha de lista role=dialog sem Esc/foco)
Ruling: composer vira <textarea> (Enter envia, Shift+Enter quebra linha, guarda de IME) — o plano mandava <input>, mas o WhatsApp real é multilinha e a spec pede "quase perfeito" — custo: ajuste de testes
Ruling: interactiveWidget 'resizes-content' no viewport global (afeta todo o painel — positivo para formulários também)
Ruling: ícone do WhatsApp com path inline (sem importar o index de 5,2 MB do simple-icons; remover a dependência se ficar sem uso) e conteúdo do simulador via next/dynamic
Task 12: fix round 1/5 dispatched
Task 12: fix round 1/5 (commit a3ce737), dispatching scoped re-review
Task 12: re-review — 6 Important tratados (teclado iOS parcial: interactiveWidget só no Android); 1 novo Important: efeito do ListaSheet depende de onFechar inline → rouba foco a cada render
Task 12: fix round 2/5 dispatched (efeito de foco só na montagem; keyCode 229; indentação; fallback do dynamic)
Task 12: fix round 2/5 (all addressed; commits a3ce737..6d870d3; conferido pelo controlador)
Task 12: minor (deferred → 02-C): teclado virtual no iOS Safari (interactiveWidget não suportado; usar visualViewport); teste do Esc com o Radix real
Task 12: complete (commits f94ca95..6d870d3, review clean)
Task 13: dispatched (base 6d870d3, sonnet)
Task 13: implemented (commit ae9ccdc; pnpm check 422 testes/52 arquivos; e2e celular 14/14), DONE_WITH_CONCERNS
Ruling: PLAN.md cita eb7f2f5 (sha pré-amend, inexistente) → corrigir na leva final para "d10cfff..<último commit>"; desvios aceitos: workers 1 (specs dividem o banco), devIndicators false (badge do Next interceptava clique na nav — só dev)
Task 13: dispatching review
Task 13: review — spec ✅, quality Approved, sem Critical/Important
Task 13: minors levados à leva final: persistência do tema (reload + cookie); sobreposição FAB×nav também a 320px com expect.poll; ai_runs vazio no teste do worker; deploy.md passo 7 (Ignored Build Step como caminho principal); helpers.ts com client lazy
Task 13: complete (commits 6d870d3..ae9ccdc, review clean)
Final review: dispatched (range d10cfff..ae9ccdc, opus)
Final review (opus): sem Critical/Important; lint/typecheck/unit 261/ui 64 verdes. Minors 1–6
Ruling: sessão de convite só define senha se a entrada amr 'otp' tiver ≤ 1 h (timestamp) — fecha troca de senha dias depois; secure_password_change fica como nota no runbook (custo: convidado que demorar >1h precisa de novo convite)
Ruling: card "aguardando atendente" passa a contar aguardando_humano + humano, mesmo critério da lista (título da lista mantido)
Ruling: WA → simulator/colors.ts; senhaNova .max(72); placeholder sem senha concreta; helpers e2e lazy getAdmin/getSql + sql.end; theme arrow-key: só nota
Final fix wave: dispatched (base ae9ccdc, sonnet)
Final fix wave: 7 commits ae9ccdc..3c962d5; pnpm check 427 testes; e2e celular 15/15; dispatching scoped re-review
Final fix wave: re-review — todos os itens tratados, sem Critical/Important; ajustes do controlador 9ec0da2 (teste do simulador pré-carrega o chunk + waitFor; TOLERANCIA_RELOGIO_S) e c40ed6c (PLAN/CLAUDE: faixa d10cfff..9ec0da2)
Plano 02-A: COMPLETO — pnpm check verde em c40ed6c (427 testes / 52 arquivos; build ok); e2e celular 15/15 (última leva)
