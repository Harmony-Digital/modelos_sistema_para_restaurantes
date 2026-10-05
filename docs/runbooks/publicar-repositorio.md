# Publicar o repositório no GitHub (Harmony-Digital)

> Situação em 05/10/2026: o repositório ainda **não existe** no GitHub. A conta usada localmente (`BrunoRaposoo`) não é membro da organização `Harmony-Digital` e não pode criar repositórios nela. Todo o trabalho está commitado localmente e há um backup completo em bundle (abaixo).

## Estado local

| Branch | Conteúdo |
|---|---|
| `main` | Base documental: PRD, PLAN, CLAUDE/AGENTS e plano da Etapa 01 |
| `etapa-01-fundacao` | Implementação completa da Etapa 01 (sobre a `main`), revisada tarefa a tarefa |

A `main` **não** recebeu merge da Etapa 01 de propósito: assim a primeira publicação já gera um Pull Request revisável `etapa-01-fundacao → main`.

Backup: `/home/bruno/harmony/_backups/ia-atendimento-<data>.bundle` (contém todas as branches e todo o histórico). Para conferir: `git bundle verify <arquivo>`.

## 1. Pedir a criação (quem é admin da organização)

Criar **`Harmony-Digital/ia-atendimento`**:
- **Privado.**
- **Vazio** — sem README, sem `.gitignore`, sem licença. (Qualquer arquivo inicial cria um commit que não existe aqui e força merge/rebase na primeira publicação.)
- Dar à conta que vai publicar permissão **Write** (ou Maintain) no repositório.

## 2. Publicar (sem conflito e sem sobrescrever)

```bash
cd /home/bruno/harmony/ia-atendimento
git status                      # precisa estar limpo
git remote add origin https://github.com/Harmony-Digital/ia-atendimento.git
git ls-remote origin            # deve imprimir NADA (repositório vazio)
git push -u origin main
git push -u origin etapa-01-fundacao
```

Regras:
- Se `git ls-remote origin` mostrar qualquer ref, **pare**: alguém inicializou o repositório com arquivos. Não use `--force`. Traga o conteúdo remoto (`git fetch origin`) e decida com o time.
- Nunca usar `git push --force` na `main`.

## 3. Abrir o Pull Request da Etapa 01

```bash
gh pr create --base main --head etapa-01-fundacao \
  --title "Etapa 01 — Fundação" \
  --body-file docs/historico/etapa-01-ledger.md
```
(Ou pela interface do GitHub. O ledger traz cada decisão, revisão e pendência.)

## 4. Depois de publicar

1. Conferir a primeira execução do workflow **CI** (Actions) no PR — ver `docs/runbooks/deploy.md` §10 para os secrets/Environments.
2. Configurar o Environment `production` (aprovação obrigatória, branch `main`) antes de qualquer merge, porque o deploy do worker roda após CI verde na `main`.
3. Proteger a `main`: exigir PR, CI verde e 1 revisão.
4. Apagar o bundle local só depois de confirmar que as duas branches estão no GitHub.

## Se o repositório for criado com outro nome ou em outra conta

Troque só a URL do `git remote add`. O resto do procedimento é igual.
