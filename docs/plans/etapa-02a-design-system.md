# Etapa 02-A — Design system, layout e acesso: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** painel com o design system Harmony (escuro padrão, claro opcional), navegação de celular, componentes de formulário com validação exata, telas de acesso (login, MFA, **definir senha** do convite), **devolver à IA** e a **casca visual do simulador de WhatsApp** — base para os planos 02-B e 02-C.

**Architecture:** tokens CSS em `apps/web/app/globals.css` mapeados ao Tailwind v4 (`@theme inline`) no formato do shadcn/ui; tema por cookie lido no layout raiz (sem "piscar"); componentes de formulário próprios sobre React Hook Form + Zod em `apps/web/components/form/`; layout do painel em `apps/web/components/shell/`; simulador em `apps/web/components/simulator/` com estado local (o pipeline real é ligado no 02-C). Testes de componentes em Vitest + Testing Library (jsdom); fluxos em Playwright com viewport de celular.

**Tech Stack:** Next.js 16.3.8, React 19.3, Tailwind v4.3, tw-animate-css 1.4, shadcn 4.21.2 (estilo `new-york`), radix-ui 1.6, lucide-react 1.52, sonner 2.0, react-hook-form 7.89, @hookform/resolvers 5.9 (Zod 4), simple-icons 16.34, Vitest 5 + @testing-library/react 16.3 + user-event 14.6 + jest-dom 7 + jsdom 30 + @vitejs/plugin-react 6.1, Playwright 1.63, Supabase Auth (`verifyOtp` token_hash).

**Spec:** [docs/specs/2026-10-05-etapa-02-s1-design.md](../specs/2026-10-05-etapa-02-s1-design.md) (§4 Painel, §5 Design system, §8 plano 02-A). Base: [PRD.md](../../PRD.md) + adendo da Etapa 02; regras de trabalho em [CLAUDE.md](../../CLAUDE.md).

## Global Constraints

- Branch de trabalho: `etapa-02-s1`. Commits em português no imperativo, terminando com exatamente `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. CLAUDE.md e AGENTS.md sempre idênticos.
- **Tema escuro é o padrão**; claro via `data-theme="light"` no `<html>`; escolha persistida no cookie `atd-tema` (`escuro` | `claro`).
- Paleta (spec §5.1), exatamente estes hex. Escuro: fundo `#0F1322`, cartão `#1A2036`, texto `#C9CCD6`, secundário `#8E94A6`, primária `#F28C1D` com texto `#151A2D`, borda de controle `#6B7186`, divisória `#2B3040`, anel de foco `#F28C1D`, link `#F7B265`, sucesso `#4ADE80`, erro `#F87171`, aviso `#FBBF24`, info `#7DB3F5`. Claro: fundo `#FAF8F4`, cartão `#FFFEFB`, texto `#151A2D`, secundário `#4A5061`, primária `#F28C1D` com texto `#151A2D`, borda de controle `#8A8377`, divisória `#E7E2D9`, **anel de foco `#9E5306`** (o laranja reprova no claro: 2,3:1), link `#9E5306`, sucesso `#1F7A4D`, erro `#B42318` (texto branco), aviso `#8A5A00`, info `#1D4E89`.
- Laranja **nunca** com texto branco e nunca como texto sobre fundo claro. Todo par texto/fundo ≥ 4,5:1; bordas de controle, foco e ícones ≥ 3:1 (testado em `apps/web/design/contrast.test.ts`).
- Fontes: Sora (títulos/números), DM Sans (corpo/formulários), JetBrains Mono (técnico) via `next/font/google`. Raios 8/14/22px. Movimento ≤ 200ms com `cubic-bezier(.22,1,.36,1)` e `prefers-reduced-motion` respeitado.
- Alvos de toque ≥ 44×44px. Foco sempre visível. Datas `dd/mm/aaaa`, horas `HH:mm` (24h).
- Rótulo sempre visível (nunca só placeholder); placeholder = exemplo real começando com "Ex.:".
- Validação: primeiro ao sair do campo (`mode: 'onTouched'`), depois a cada tecla (`reValidateMode: 'onChange'`); no envio inválido, foco no primeiro campo inválido + `ErrorSummary` com links. Mesmo schema Zod no cliente e no servidor; erro do servidor no campo certo.
- Acessibilidade: `aria-invalid`, `aria-describedby` (ajuda + erro), erros com `role="alert"`/`aria-live`; botão do olho com `aria-pressed` e rótulo "Mostrar senha"/"Ocultar senha".
- Toda Server Action do painel chama `requireStaff` (CLAUDE.md); toda mutação do painel grava `audit_log` na mesma transação (PRD §7.12).
- Nada de dado pessoal em log (CLAUDE.md). Nenhuma nova dependência além das listadas no Tech Stack.

## Review Focus

1. **Tema sem "piscar":** usuário com cookie `atd-tema=claro` recarrega qualquer página ⇒ primeira pintura já clara (o atributo vem do servidor). Teste em Task 2 (`theme.test.ts`) e E2E em Task 13 (`painel.spec.ts › tema`).
2. **Olho da senha + envio:** usuário deixa a senha visível e envia o formulário ⇒ o campo volta a ser `type="password"` (não fica exposta ao voltar/erro). Teste em Task 4 (`password-input.test.tsx › volta a ocultar ao enviar`).
3. **Erro do servidor no campo certo:** login com senha errada ⇒ mensagem no formulário (não um alerta genérico solto) e foco no campo de senha; `?erro=sem-acesso` também aparece. Teste em Task 9 (`login-form.test.tsx`).
4. **Link de convite expirado ou reutilizado:** `/auth/confirm` com token inválido ⇒ página de erro clara com o que fazer (pedir novo convite), nunca tela branca nem loop. Teste em Task 10 (`confirm-route.test.ts › token inválido`).
5. **Devolver à IA concorrente:** dois atendentes devolvem a mesma conversa quase ao mesmo tempo, ou ela já foi devolvida ⇒ uma única linha de auditoria, sem erro para o segundo ("já estava com a IA"). Teste em Task 11 (`return-to-ai.db.test.ts › idempotente`).

---

## Mapa de arquivos

```
apps/web/
├── components.json                          configuração do shadcn (new-york, CSS vars)
├── app/
│   ├── globals.css                          tokens + temas + base (substitui o atual)
│   ├── layout.tsx                           fontes + data-theme do cookie + Toaster
│   ├── (auth)/login/page.tsx · login-form.tsx
│   ├── (auth)/mfa/page.tsx                  restyle com os componentes
│   ├── (auth)/definir-senha/page.tsx · definir-senha-form.tsx · actions.ts
│   ├── auth/confirm/route.ts                verifyOtp(token_hash) → next
│   ├── auth/erro/page.tsx                   link inválido/expirado
│   ├── (painel)/layout.tsx                  AppShell (TopBar + BottomNav + Simulator)
│   ├── (painel)/page.tsx                    Início (status + aguardando atendente)
│   ├── (painel)/unidades/page.tsx           estado vazio (conteúdo no 02-C)
│   ├── (painel)/respostas/page.tsx          estado vazio (conteúdo no 02-C)
│   ├── (painel)/mais/page.tsx · theme-form.tsx
│   └── (painel)/actions.ts                  signOut, setTheme, returnToAi
├── components/
│   ├── ui/                                  primitivos shadcn (button, card, badge, skeleton, sheet, dialog, switch, sonner)
│   ├── form/                                Field, TextInput, Textarea, PasswordInput, TimeInput, DateInput,
│   │                                         PhoneInput, Select, TagInput, SwitchField, SubmitButton, ErrorSummary,
│   │                                         use-zod-form.ts, server-errors.ts, messages.ts, index.ts
│   ├── shell/                               app-shell.tsx, top-bar.tsx, bottom-nav.tsx, empty-state.tsx
│   ├── conversations/awaiting-human.tsx     lista + botão "Devolver à IA"
│   └── simulator/                           launcher.tsx, phone-frame.tsx, whatsapp-chat.tsx, bubbles.tsx, types.ts
├── design/tokens.ts · design/contrast.ts · design/contrast.test.ts
├── lib/utils.ts (cn) · lib/theme.ts
└── test/setup.ts                            jest-dom + cleanup
packages/db/src/conversations-panel.ts       listAwaitingHuman, returnToAi
supabase/templates/invite.html                link com token_hash → /auth/confirm
```

---

### Task 1: Testes de componentes (Vitest + Testing Library + jsdom)

**Files:**
- Modify: `vitest.config.ts` (novo projeto `ui`), `apps/web/package.json` (devDependencies)
- Create: `apps/web/test/setup.ts`, `apps/web/test/smoke.test.tsx`

**Interfaces:**
- Produces: projeto Vitest `ui` que roda `apps/web/**/*.test.tsx` em jsdom com `@testing-library/jest-dom` e alias `@/` → `apps/web/`; script raiz `pnpm test:ui`; projeto `unit` passa a incluir **todos** os `apps/web/**/*.test.ts` (design, lib, components), exceto `*.db.test.ts`.

- [ ] **Step 1: Dependências**

Run:
```bash
pnpm --filter @atd/web add -D @testing-library/react@^16.3.3 @testing-library/user-event@^14.6.7 @testing-library/dom@^10.4.2 @testing-library/jest-dom@^7.0.1 jsdom@^30.1.2 @vitejs/plugin-react@^6.1.2
```

- [ ] **Step 2: Projeto `ui` no Vitest**

Em `vitest.config.ts`, importar `react` de `@vitejs/plugin-react` e `fileURLToPath` de `node:url`, e acrescentar ao array `projects`:
```ts
      {
        plugins: [react()],
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) } },
        test: {
          name: 'ui',
          include: ['apps/web/**/*.test.tsx'],
          exclude: ['**/node_modules/**'],
          environment: 'jsdom',
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
```
No projeto `unit` existente, trocar `'apps/web/lib/**/*.test.ts'` por `'apps/web/**/*.test.ts'` (o `exclude` de `**/*.db.test.ts` continua) e acrescentar o mesmo alias `@` (`resolve.alias`) para os testes `.ts` que importam `@/...`.
Em `package.json` (raiz), `scripts`: `"test:ui": "vitest run --project ui"`. O `pnpm test` (sem projeto) roda unit + db + ui.

`apps/web/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())
```

- [ ] **Step 3: Teste de fumaça (vermelho → verde)**

`apps/web/test/smoke.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('ambiente de UI', () => {
  it('renderiza JSX no jsdom com jest-dom', () => {
    render(<button aria-pressed="false">Olá</button>)
    expect(screen.getByRole('button', { name: 'Olá' })).toHaveAttribute('aria-pressed', 'false')
  })
})
```
Run (antes do Step 2): `pnpm vitest run apps/web/test/smoke.test.tsx` → FAIL (JSX/ambiente). Depois: `pnpm test:ui` → `1 passed`.

- [ ] **Step 4: Verificar e commitar**

Run: `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:ui`

```bash
git add -A
git commit -m "Adiciona testes de componentes com Testing Library e jsdom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tokens, temas, fontes e contraste verificado

**Files:**
- Create: `apps/web/design/tokens.ts`, `apps/web/design/contrast.ts`, `apps/web/design/contrast.test.ts`, `apps/web/lib/theme.ts`, `apps/web/lib/theme.test.ts`
- Modify: `apps/web/app/globals.css` (substituir), `apps/web/app/layout.tsx`

**Interfaces:**
- Produces:
  - `themes: Record<'escuro' | 'claro', ThemeTokens>` e `contrastPairs(theme): { nome: string; texto: string; fundo: string; minimo: 3 | 4.5 }[]` em `design/tokens.ts`.
  - `contrastRatio(a: string, b: string): number` em `design/contrast.ts`.
  - `THEME_COOKIE = 'atd-tema'`, `type Tema = 'escuro' | 'claro'`, `parseTema(v: string | undefined): Tema` (padrão `'escuro'`), `dataThemeFor(t: Tema): 'dark' | 'light'` em `lib/theme.ts`.
  - Classes Tailwind disponíveis para os próximos tasks: `bg-background text-foreground bg-card text-muted-foreground bg-primary text-primary-foreground border-border border-input ring-ring text-link text-success text-warning text-info text-destructive font-display font-sans font-mono rounded-sm|md|lg`.

- [ ] **Step 1: Testes que falham**

`apps/web/design/contrast.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast.ts'
import { contrastPairs, themes } from './tokens.ts'

describe('contraste WCAG', () => {
  it('fórmula confere com valores conhecidos', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(contrastRatio('#151A2D', '#F28C1D')).toBeCloseTo(7.02, 1)
  })

  for (const tema of ['escuro', 'claro'] as const) {
    for (const p of contrastPairs(tema)) {
      it(`${tema}: ${p.nome} ≥ ${p.minimo}:1`, () => {
        expect(contrastRatio(p.texto, p.fundo)).toBeGreaterThanOrEqual(p.minimo)
      })
    }
  }

  it('globals.css usa exatamente os hex dos tokens', () => {
    const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8').toLowerCase()
    for (const tema of Object.values(themes)) {
      for (const hex of Object.values(tema)) expect(css).toContain(hex.toLowerCase())
    }
  })
})
```

`apps/web/lib/theme.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { dataThemeFor, parseTema } from './theme.ts'

describe('tema', () => {
  it('padrão é escuro', () => {
    expect(parseTema(undefined)).toBe('escuro')
    expect(parseTema('qualquer')).toBe('escuro')
  })
  it('respeita claro', () => {
    expect(parseTema('claro')).toBe('claro')
    expect(dataThemeFor('claro')).toBe('light')
    expect(dataThemeFor('escuro')).toBe('dark')
  })
})
```
Run: `pnpm vitest run apps/web/design apps/web/lib/theme.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 2: Tokens e contraste**

`apps/web/design/tokens.ts`:
```ts
export type ThemeTokens = {
  background: string; foreground: string; card: string; muted: string; mutedForeground: string
  primary: string; primaryForeground: string; secondary: string; destructive: string; destructiveForeground: string
  border: string; input: string; ring: string; link: string; success: string; warning: string; info: string
}

export const themes: Record<'escuro' | 'claro', ThemeTokens> = {
  escuro: {
    background: '#0F1322', foreground: '#C9CCD6', card: '#1A2036', muted: '#151A2D', mutedForeground: '#8E94A6',
    primary: '#F28C1D', primaryForeground: '#151A2D', secondary: '#2B3040', destructive: '#F87171',
    destructiveForeground: '#0F1322', border: '#2B3040', input: '#6B7186', ring: '#F28C1D', link: '#F7B265',
    success: '#4ADE80', warning: '#FBBF24', info: '#7DB3F5',
  },
  claro: {
    background: '#FAF8F4', foreground: '#151A2D', card: '#FFFEFB', muted: '#F3F0EA', mutedForeground: '#4A5061',
    primary: '#F28C1D', primaryForeground: '#151A2D', secondary: '#F3F0EA', destructive: '#B42318',
    destructiveForeground: '#FFFFFF', border: '#E7E2D9', input: '#8A8377', ring: '#9E5306', link: '#9E5306',
    success: '#1F7A4D', warning: '#8A5A00', info: '#1D4E89',
  },
}

export function contrastPairs(tema: 'escuro' | 'claro') {
  const t = themes[tema]
  const texto = (nome: string, a: string, b: string) => ({ nome, texto: a, fundo: b, minimo: 4.5 as const })
  const ui = (nome: string, a: string, b: string) => ({ nome, texto: a, fundo: b, minimo: 3 as const })
  return [
    texto('texto/fundo', t.foreground, t.background),
    texto('texto/cartão', t.foreground, t.card),
    texto('secundário/fundo', t.mutedForeground, t.background),
    texto('secundário/cartão', t.mutedForeground, t.card),
    texto('texto do botão primário', t.primaryForeground, t.primary),
    texto('texto/botão secundário', t.foreground, t.secondary),
    texto('texto do botão destrutivo', t.destructiveForeground, t.destructive),
    texto('erro/cartão', t.destructive, t.card),
    texto('link/fundo', t.link, t.background),
    texto('link/cartão', t.link, t.card),
    texto('sucesso/cartão', t.success, t.card),
    texto('aviso/cartão', t.warning, t.card),
    texto('info/cartão', t.info, t.card),
    ui('borda de controle/fundo', t.input, t.background),
    ui('borda de controle/cartão', t.input, t.card),
    ui('foco/fundo', t.ring, t.background),
    ui('foco/cartão', t.ring, t.card),
  ]
}
```

`apps/web/design/contrast.ts`:
```ts
function channel(c: number) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** Razão de contraste WCAG 2.x entre duas cores hex (#RRGGBB). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
```

`apps/web/lib/theme.ts`:
```ts
export const THEME_COOKIE = 'atd-tema'
export type Tema = 'escuro' | 'claro'

export function parseTema(v: string | undefined): Tema {
  return v === 'claro' ? 'claro' : 'escuro'
}

export function dataThemeFor(t: Tema): 'dark' | 'light' {
  return t === 'claro' ? 'light' : 'dark'
}
```

- [ ] **Step 3: `globals.css` (substituir o arquivo inteiro)**

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Tema escuro (padrão) — paleta Harmony Digital, contraste medido em design/contrast.test.ts */
:root,
[data-theme="dark"] {
  color-scheme: dark;
  --background: #0F1322;
  --foreground: #C9CCD6;
  --card: #1A2036;
  --card-foreground: #C9CCD6;
  --popover: #1A2036;
  --popover-foreground: #C9CCD6;
  --primary: #F28C1D;
  --primary-foreground: #151A2D;
  --secondary: #2B3040;
  --secondary-foreground: #C9CCD6;
  --muted: #151A2D;
  --muted-foreground: #8E94A6;
  --accent: #2B3040;
  --accent-foreground: #C9CCD6;
  --destructive: #F87171;
  --destructive-foreground: #0F1322;
  --border: #2B3040;
  --input: #6B7186;
  --ring: #F28C1D;
  --link: #F7B265;
  --success: #4ADE80;
  --warning: #FBBF24;
  --info: #7DB3F5;
  --radius: 14px;
}

[data-theme="light"] {
  color-scheme: light;
  --background: #FAF8F4;
  --foreground: #151A2D;
  --card: #FFFEFB;
  --card-foreground: #151A2D;
  --popover: #FFFEFB;
  --popover-foreground: #151A2D;
  --primary: #F28C1D;
  --primary-foreground: #151A2D;
  --secondary: #F3F0EA;
  --secondary-foreground: #151A2D;
  --muted: #F3F0EA;
  --muted-foreground: #4A5061;
  --accent: #F3F0EA;
  --accent-foreground: #151A2D;
  --destructive: #B42318;
  --destructive-foreground: #FFFFFF;
  --border: #E7E2D9;
  --input: #8A8377;
  --ring: #9E5306;
  --link: #9E5306;
  --success: #1F7A4D;
  --warning: #8A5A00;
  --info: #1D4E89;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-link: var(--link);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --radius-sm: 8px;
  --radius-md: var(--radius);
  --radius-lg: 22px;
  --font-sans: var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-sora), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), ui-monospace, monospace;
  --ease-out: cubic-bezier(.22, 1, .36, 1);
}

@layer base {
  * { @apply border-border; }
  html { -webkit-text-size-adjust: 100%; }
  body { @apply bg-background text-foreground font-sans antialiased; }
  h1, h2, h3 { @apply font-display; }
  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  a { color: var(--link); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```
Instalar a dependência de animação usada pelos primitivos: `pnpm --filter @atd/web add tw-animate-css@^1.4.0`.

- [ ] **Step 4: Layout raiz com fontes e tema do cookie**

`apps/web/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { DM_Sans, JetBrains_Mono, Sora } from 'next/font/google'
import { dataThemeFor, parseTema, THEME_COOKIE } from '@/lib/theme'
import './globals.css'

const sora = Sora({ subsets: ['latin'], display: 'swap', variable: '--font-sora' })
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains' })

export const metadata: Metadata = { title: 'Atendimento IA', robots: { index: false, follow: false } }
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0F1322' },
    { media: '(prefers-color-scheme: light)', color: '#FAF8F4' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="pt-BR" data-theme={dataThemeFor(tema)} className={`${sora.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
```
(O atributo vem do servidor: a primeira pintura já está no tema certo.)

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm vitest run apps/web/design apps/web/lib/theme.test.ts && pnpm --filter @atd/web build`
Expected: todos os pares passam (escuro e claro), globals.css em sincronia; build OK.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Adiciona tokens da Harmony com tema escuro padrão, fontes e verificação de contraste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Primitivos de UI (shadcn) estilizados pelos tokens

**Files:**
- Create: `apps/web/components.json`, `apps/web/lib/utils.ts`, `apps/web/components/ui/{button,card,badge,skeleton,sheet,dialog,switch,sonner}.tsx` (via CLI), `apps/web/components/ui/button.test.tsx`
- Modify: `apps/web/package.json` (dependências instaladas pela CLI), `apps/web/app/layout.tsx` (Toaster)

**Interfaces:**
- Produces: `cn(...inputs)`; `Button` com variantes `default` (laranja + texto navy), `secondary`, `outline`, `ghost`, `destructive`, `link` e tamanhos `default` (h-11 = 44px), `sm`, `lg`, `icon` (44×44); `Card*`, `Badge`, `Skeleton`, `Sheet*` (lado `bottom` para formulários no celular), `Dialog*`, `Switch`, `Toaster` (sonner) com `toast` de `sonner`.

- [ ] **Step 1: Configuração do shadcn**

`apps/web/components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```

Run (em `apps/web`):
```bash
pnpm dlx shadcn@4.21.2 add button card badge skeleton sheet dialog switch sonner --yes
```
A CLI cria `lib/utils.ts` e os arquivos em `components/ui/` e instala `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `sonner`. **Conferir que ela NÃO alterou `app/globals.css`**; se alterou, restaurar com `git checkout apps/web/app/globals.css` (os tokens da Task 2 são a fonte de verdade; o teste de contraste falha se forem trocados). Se a CLI pedir `next-themes` para o `sonner`, remover o `useTheme` do `components/ui/sonner.tsx` e passar `theme` por prop (o tema já vem do `data-theme`).

- [ ] **Step 2: Ajustar o `Button` ao design system**

Em `components/ui/button.tsx`, ajustar o `cva` para:
- base: `inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`;
- `default`: `bg-primary text-primary-foreground hover:brightness-95` (texto **navy**, nunca branco);
- `secondary`: `bg-secondary text-secondary-foreground hover:brightness-110`;
- `outline`: `border border-input bg-transparent hover:bg-accent`;
- `destructive`: `bg-destructive text-destructive-foreground`;
- `link`: `text-link underline-offset-4 hover:underline`;
- tamanhos: `default: h-11 px-4`, `sm: h-9 px-3` (uso só em desktop/denso), `lg: h-12 px-6 text-base`, `icon: size-11`.

- [ ] **Step 3: Teste que falha → passa**

`apps/web/components/ui/button.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('primário usa fundo laranja com texto navy e altura de toque de 44px', () => {
    render(<Button>Salvar</Button>)
    const b = screen.getByRole('button', { name: 'Salvar' })
    expect(b.className).toMatch(/bg-primary/)
    expect(b.className).toMatch(/text-primary-foreground/)
    expect(b.className).toMatch(/h-11/)
  })
  it('ícone tem 44×44', () => {
    render(<Button size="icon" aria-label="Fechar">x</Button>)
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toMatch(/size-11/)
  })
})
```
Run: `pnpm vitest run apps/web/components/ui/button.test.tsx` → PASS após o Step 2.

- [ ] **Step 4: Toaster no layout**

Em `app/layout.tsx`, dentro de `<body>` após `{children}`: `<Toaster position="top-center" theme={tema === 'claro' ? 'light' : 'dark'} richColors closeButton />` (import de `@/components/ui/sonner`).

- [ ] **Step 5: Verificar e commitar**

Run: `pnpm lint && pnpm typecheck && pnpm test:ui && pnpm vitest run apps/web/design && pnpm --filter @atd/web build`

```bash
git add -A
git commit -m "Adiciona primitivos shadcn estilizados pelos tokens e toasts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Formulários — base (Field, TextInput, PasswordInput, validação, resumo de erros)

**Files:**
- Create: `apps/web/lib/validation.ts`, `apps/web/lib/validation.test.ts`, `apps/web/lib/action-result.ts`
- Create: `apps/web/components/form/{field.tsx,text-input.tsx,textarea.tsx,password-input.tsx,submit-button.tsx,error-summary.tsx,use-zod-form.ts,server-errors.ts,index.ts}`
- Test: `apps/web/components/form/password-input.test.tsx`, `apps/web/components/form/form-behavior.test.tsx`
- Modify: `apps/web/package.json` (`react-hook-form@^7.89.0`, `@hookform/resolvers@^5.9.1`)

**Interfaces:**
- Produces:
  - `lib/validation.ts` (usado no cliente **e** no servidor): `email`, `senhaNova` (≥ 12 caracteres, com letra e número), `senhaLogin` (obrigatória), `hora` (`HH:mm` 00:00–23:59), `dataBr` (dd/mm/aaaa válida → string ISO `YYYY-MM-DD`), `telefoneBr` (10–11 dígitos → só dígitos), `texto(min, max, rotulo)`; mensagens em português que dizem **como corrigir**.
  - `lib/action-result.ts`: `type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; fieldErrors?: Record<string, string>; formError?: string }`; `fieldErrorsFromZod(err: z.ZodError): Record<string, string>` (primeira mensagem por campo).
  - `useZodForm(schema, opts?)` — `useForm` com `zodResolver`, `mode: 'onTouched'`, `reValidateMode: 'onChange'`, `shouldFocusError: true`.
  - `applyServerErrors(form, result)` — para cada `fieldErrors[name]` chama `form.setError(name, { type: 'server', message })`, foca o primeiro; `formError` vai para `form.setError('root.server', …)`.
  - `<Field id label hint? error? required? className?>{(controlProps) => ReactNode}</Field>` — `controlProps = { id, 'aria-invalid', 'aria-describedby', 'aria-required' }`; mostra rótulo (fica em `text-link` quando o grupo tem foco), ajuda e erro (`role="alert"`, ícone).
  - `TextInput`, `Textarea` (forwardRef, `invalid` derivado de `aria-invalid`), `PasswordInput` (olho com `aria-pressed` + "Mostrar senha"/"Ocultar senha"; volta a ocultar no `submit` do formulário), `SubmitButton pending? children pendingText?`, `ErrorSummary errors: { id: string; label: string; message: string }[]` + `useErrorSummary(form, labels: Record<string, string>)`.

- [ ] **Step 1: Dependências**

Run: `pnpm --filter @atd/web add react-hook-form@^7.89.0 @hookform/resolvers@^5.9.1`

- [ ] **Step 2: Testes que falham**

`apps/web/lib/validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { dataBr, email, hora, senhaNova, telefoneBr } from './validation.ts'

describe('validação compartilhada', () => {
  it('e-mail com mensagem de correção', () => {
    const r = email.safeParse('maria@')
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('Digite um e-mail completo, como nome@empresa.com.br')
  })
  it('senha nova exige 12 caracteres com letra e número', () => {
    expect(senhaNova.safeParse('curta1').success).toBe(false)
    expect(senhaNova.safeParse('somenteletrasaqui').success).toBe(false)
    expect(senhaNova.safeParse('Restaurante2026').success).toBe(true)
  })
  it.each([['11:30', true], ['23:59', true], ['24:00', false], ['9:00', false], ['11h30', false]])('hora %s', (v, ok) => {
    expect(hora.safeParse(v).success).toBe(ok)
  })
  it('data brasileira válida vira ISO; inválida explica', () => {
    expect(dataBr.parse('12/10/2026')).toBe('2026-10-12')
    const r = dataBr.safeParse('31/02/2026')
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('Data inexistente. Use dd/mm/aaaa, como 12/10/2026')
  })
  it('telefone com DDD normaliza dígitos', () => {
    expect(telefoneBr.parse('(61) 99999-8888')).toBe('61999998888')
    expect(telefoneBr.safeParse('9999-8888').success).toBe(false)
  })
})
```

`apps/web/components/form/password-input.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('olho mostra e oculta a senha', async () => {
    const user = userEvent.setup()
    render(<label>Senha<PasswordInput defaultValue="segredo123" /></label>)
    const input = screen.getByLabelText('Senha', { exact: true }) as HTMLInputElement
    const olho = screen.getByRole('button', { name: 'Mostrar senha' })
    expect(input.type).toBe('password')
    expect(olho).toHaveAttribute('aria-pressed', 'false')
    await user.click(olho)
    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Ocultar senha' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Ocultar senha' }))
    expect(input.type).toBe('password')
  })

  it('volta a ocultar ao enviar o formulário', async () => {
    const user = userEvent.setup()
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <label>Senha<PasswordInput defaultValue="segredo123" /></label>
        <button type="submit">Entrar</button>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect((screen.getByLabelText('Senha', { exact: true }) as HTMLInputElement).type).toBe('password')
  })

  it('o botão do olho não envia o formulário', async () => {
    const user = userEvent.setup()
    let enviou = false
    render(
      <form onSubmit={(e) => { e.preventDefault(); enviou = true }}>
        <label>Senha<PasswordInput /></label>
      </form>,
    )
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(enviou).toBe(false)
  })
})
```

`apps/web/components/form/form-behavior.test.tsx` (formulário de exemplo que usa só a API pública dos componentes):
```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { email, texto } from '@/lib/validation'
import { applyServerErrors, ErrorSummary, Field, SubmitButton, TextInput, useErrorSummary, useZodForm } from './index'

const schema = z.object({ nome: texto(2, 80, 'Nome da unidade'), contato: email })
const LABELS = { nome: 'Nome da unidade', contato: 'E-mail de contato' }

function Exemplo({ servidor }: { servidor?: { fieldErrors?: Record<string, string>; formError?: string } }) {
  const form = useZodForm(schema, { defaultValues: { nome: '', contato: '' } })
  const summary = useErrorSummary(form, LABELS)
  const { errors } = form.formState
  return (
    <form noValidate onSubmit={form.handleSubmit(() => { if (servidor) applyServerErrors(form, { ok: false, ...servidor }) })}>
      <ErrorSummary errors={summary} />
      <Field id="nome" label={LABELS.nome} hint="Como o cliente chama a unidade" error={errors.nome?.message} required>
        {(a) => <TextInput {...a} placeholder="Ex.: Asa Sul" {...form.register('nome')} />}
      </Field>
      <Field id="contato" label={LABELS.contato} error={errors.contato?.message} required>
        {(a) => <TextInput {...a} type="email" placeholder="Ex.: gerente@restaurante.com.br" {...form.register('contato')} />}
      </Field>
      <SubmitButton>Salvar</SubmitButton>
    </form>
  )
}

describe('comportamento dos formulários', () => {
  it('rótulo, ajuda e erro ligados ao campo (acessibilidade)', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    const nome = screen.getByLabelText(/Nome da unidade/)
    expect(nome).toHaveAttribute('aria-required', 'true')
    expect(nome).toHaveAccessibleDescription(/Como o cliente chama a unidade/)
    await user.click(nome)
    await user.tab() // sai do campo vazio
    expect(nome).toHaveAttribute('aria-invalid', 'true')
    expect(nome).toHaveAccessibleDescription(/Informe Nome da unidade/)
    expect(screen.getByRole('alert', { name: '' })).toHaveTextContent('Informe Nome da unidade')
  })

  it('depois do primeiro erro, valida a cada tecla e o erro some ao corrigir', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    const nome = screen.getByLabelText(/Nome da unidade/)
    await user.click(nome)
    await user.tab()
    expect(nome).toHaveAttribute('aria-invalid', 'true')
    await user.type(nome, 'As')
    expect(nome).toHaveAttribute('aria-invalid', 'false')
  })

  it('envio inválido: resumo com links e foco no primeiro campo errado', async () => {
    const user = userEvent.setup()
    render(<Exemplo />)
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    const resumo = screen.getByRole('region', { name: /Corrija 2 campos/ })
    expect(within(resumo).getByRole('link', { name: /Nome da unidade/ })).toHaveAttribute('href', '#nome')
    expect(within(resumo).getByRole('link', { name: /E-mail de contato/ })).toHaveAttribute('href', '#contato')
    expect(screen.getByLabelText(/Nome da unidade/)).toHaveFocus()
  })

  it('erro do servidor aparece no campo certo e recebe foco', async () => {
    const user = userEvent.setup()
    render(<Exemplo servidor={{ fieldErrors: { contato: 'Este e-mail já está em uso' } }} />)
    await user.type(screen.getByLabelText(/Nome da unidade/), 'Asa Sul')
    await user.type(screen.getByLabelText(/E-mail de contato/), 'a@b.com.br')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    const contato = screen.getByLabelText(/E-mail de contato/)
    expect(contato).toHaveAttribute('aria-invalid', 'true')
    expect(contato).toHaveAccessibleDescription(/Este e-mail já está em uso/)
    expect(contato).toHaveFocus()
  })
})
```
Run: `pnpm vitest run apps/web/lib/validation.test.ts && pnpm test:ui` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementação**

`apps/web/lib/validation.ts`:
```ts
import { z } from 'zod'

export const email = z
  .string()
  .trim()
  .min(1, 'Informe o e-mail')
  .pipe(z.email('Digite um e-mail completo, como nome@empresa.com.br'))

export const senhaLogin = z.string().min(1, 'Informe a senha')

export const senhaNova = z
  .string()
  .min(12, 'Use pelo menos 12 caracteres')
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /\d/.test(v), 'Misture letras e números (ex.: Restaurante2026)')

export const hora = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato 24h HH:mm, como 11:30')

export const dataBr = z
  .string()
  .trim()
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Use dd/mm/aaaa, como 12/10/2026')
  .transform((v, ctx) => {
    const [d, m, y] = v.split('/').map(Number) as [number, number, number]
    const dt = new Date(Date.UTC(y, m - 1, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      ctx.addIssue({ code: 'custom', message: 'Data inexistente. Use dd/mm/aaaa, como 12/10/2026' })
      return z.NEVER
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  })

export const telefoneBr = z
  .string()
  .transform((v) => v.replace(/\D/g, ''))
  .refine((v) => v.length === 10 || v.length === 11, 'Informe DDD + número, como (61) 99999-8888')

export function texto(min: number, max: number, rotulo: string) {
  return z
    .string()
    .trim()
    .min(1, `Informe ${rotulo}`)
    .min(min, `${rotulo} precisa ter pelo menos ${min} caracteres`)
    .max(max, `${rotulo} pode ter no máximo ${max} caracteres`)
}
```

`apps/web/lib/action-result.ts`:
```ts
import { z } from 'zod'

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; fieldErrors?: Record<string, string>; formError?: string }

export function fieldErrorsFromZod(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path.join('.')
    if (key && !(key in out)) out[key] = issue.message
  }
  return out
}
```

`apps/web/components/form/use-zod-form.ts`:
```ts
'use client'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type FieldValues, type UseFormProps } from 'react-hook-form'
import type { z } from 'zod'

export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  opts: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, 'resolver'> = {},
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    ...opts,
  })
}
```
(Se a tipagem genérica do `zodResolver` com Zod 4 exigir ajuste, mantenha a assinatura pública e ajuste só os genéricos internos — documente no relatório.)

`apps/web/components/form/server-errors.ts`:
```ts
'use client'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { ActionResult } from '@/lib/action-result'

export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, result: ActionResult<unknown>) {
  if (result.ok) return
  const entries = Object.entries(result.fieldErrors ?? {})
  entries.forEach(([name, message], i) => {
    form.setError(name as Path<T>, { type: 'server', message }, { shouldFocus: i === 0 })
  })
  if (result.formError) form.setError('root.server', { type: 'server', message: result.formError })
}
```

`apps/web/components/form/field.tsx`:
```tsx
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ControlProps = {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
  'aria-required': boolean | undefined
}

export function Field(props: {
  id: string
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  className?: string
  children: (control: ControlProps) => React.ReactNode
}) {
  const hintId = props.hint ? `${props.id}-ajuda` : undefined
  const errorId = props.error ? `${props.id}-erro` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('group flex flex-col gap-1.5', props.className)} data-invalid={props.error ? '' : undefined}>
      <label
        htmlFor={props.id}
        className="text-sm font-medium text-foreground transition-colors duration-150 group-focus-within:text-link group-data-[invalid]:text-destructive"
      >
        {props.label}
        {props.required && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
      </label>
      {props.children({
        id: props.id,
        'aria-invalid': Boolean(props.error),
        'aria-describedby': describedBy,
        'aria-required': props.required || undefined,
      })}
      {props.hint && (
        <p id={hintId} className="text-sm text-muted-foreground">{props.hint}</p>
      )}
      {props.error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-destructive">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {props.error}
        </p>
      )}
    </div>
  )
}
```

`apps/web/components/form/text-input.tsx`:
```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const controlClass =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-base text-foreground placeholder:text-muted-foreground ' +
  'transition-[box-shadow,border-color] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:shadow-lg ' +
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, className)} {...props} />
  },
)
```
(`text-base` = 16px evita o zoom automático do iOS ao focar.)

`apps/web/components/form/textarea.tsx`:
```tsx
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 4, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(controlClass, 'h-auto min-h-24 py-2.5', className)} {...props} />
  },
)
```

`apps/web/components/form/password-input.tsx`:
```tsx
'use client'
import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const PasswordInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const [visivel, setVisivel] = useState(false)
    const inner = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => inner.current!, [])

    useEffect(() => {
      const form = inner.current?.form
      if (!form) return
      const ocultar = () => setVisivel(false)
      form.addEventListener('submit', ocultar)
      return () => form.removeEventListener('submit', ocultar)
    }, [])

    return (
      <div className="relative">
        <input ref={inner} type={visivel ? 'text' : 'password'} className={cn(controlClass, 'pr-12', className)} {...props} />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-pressed={visivel}
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {visivel ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
        </button>
      </div>
    )
  },
)
```

`apps/web/components/form/submit-button.tsx`:
```tsx
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SubmitButton(props: { pending?: boolean; pendingText?: string; children: React.ReactNode; className?: string }) {
  return (
    <Button type="submit" disabled={props.pending} aria-busy={props.pending || undefined} className={props.className}>
      {props.pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
      {props.pending ? (props.pendingText ?? 'Salvando…') : props.children}
    </Button>
  )
}
```

`apps/web/components/form/error-summary.tsx`:
```tsx
'use client'
import { AlertTriangle } from 'lucide-react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

export type SummaryItem = { id: string; label: string; message: string }

export function useErrorSummary<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, labels: Record<string, string>): SummaryItem[] {
  const { errors, submitCount } = form.formState
  if (submitCount === 0) return []
  return Object.entries(labels)
    .map(([id, label]) => ({ id, label, message: (errors as Record<string, { message?: string } | undefined>)[id]?.message ?? '' }))
    .filter((e) => e.message)
}

export function ErrorSummary({ errors }: { errors: SummaryItem[] }) {
  if (errors.length === 0) return null
  const titulo = errors.length === 1 ? 'Corrija 1 campo' : `Corrija ${errors.length} campos`
  return (
    <section aria-label={titulo} className="rounded-md border border-destructive bg-card p-4">
      <h2 className="mb-2 flex items-center gap-2 font-sans text-sm font-semibold text-destructive">
        <AlertTriangle aria-hidden="true" className="size-4" /> {titulo}
      </h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              className="text-link underline-offset-4 hover:underline"
              onClick={(ev) => { ev.preventDefault(); document.getElementById(e.id)?.focus() }}
            >
              {e.label}: {e.message}
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
```
(Uma `<section>` com `aria-label` tem o papel `region`, como o teste espera.)

`apps/web/components/form/index.ts`:
```ts
export { Field, type ControlProps } from './field'
export { TextInput, controlClass } from './text-input'
export { Textarea } from './textarea'
export { PasswordInput } from './password-input'
export { SubmitButton } from './submit-button'
export { ErrorSummary, useErrorSummary, type SummaryItem } from './error-summary'
export { useZodForm } from './use-zod-form'
export { applyServerErrors } from './server-errors'
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run apps/web/lib/validation.test.ts && pnpm test:ui`
Expected: todos passam. Se o teste "rótulo, ajuda e erro" achar mais de um `alert`, refine a consulta para o erro do campo `nome` (`getByText('Informe Nome da unidade')` + `toHaveAttribute('role','alert')`), sem remover nenhuma asserção.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Adiciona componentes de formulário com olho na senha, erros por campo e resumo de erros

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Formulários — campos especializados (hora, data, telefone, seleção, etiquetas, chave)

**Files:**
- Create: `apps/web/components/form/masks.ts`, `apps/web/components/form/masks.test.ts`
- Create: `apps/web/components/form/{masked-input.tsx,time-input.tsx,date-input.tsx,phone-input.tsx,select.tsx,tag-input.tsx,switch-field.tsx}`
- Test: `apps/web/components/form/special-inputs.test.tsx`
- Modify: `apps/web/components/form/index.ts`

**Interfaces:**
- Consumes: `controlClass`, `Field`/`ControlProps` (Task 4); `Switch` (Task 3).
- Produces:
  - `maskHora(v): string` ("1130" → "11:30"), `maskData(v)` ("12102026" → "12/10/2026"), `maskTelefone(v)` ("61999998888" → "(61) 99999-8888"; 10 dígitos → "(61) 3333-4444").
  - `TimeInput`, `DateInput`, `PhoneInput` — inputs de texto com máscara ao digitar, `inputMode="numeric"`, `autoComplete` adequado; repassam `ref`/props (compatíveis com `register`).
  - `Select` — `<select>` nativo estilizado (melhor no celular: abre o seletor do sistema).
  - `TagInput value: string[] onChange(next) placeholder? max?` — Enter ou vírgula adiciona; Backspace com campo vazio remove a última; ignora vazio e duplicado (sem diferenciar maiúsculas/acentos); cada etiqueta tem botão "Remover <tag>".
  - `SwitchField id label hint? checked onCheckedChange disabled?`.

- [ ] **Step 1: Testes que falham**

`apps/web/components/form/masks.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { maskData, maskHora, maskTelefone } from './masks.ts'

describe('máscaras', () => {
  it.each([['1', '1'], ['11', '11'], ['113', '11:3'], ['1130', '11:30'], ['11:30', '11:30'], ['113099', '11:30']])('hora %s → %s', (a, b) => {
    expect(maskHora(a)).toBe(b)
  })
  it.each([['12', '12'], ['121', '12/1'], ['12102026', '12/10/2026'], ['12/10/2026', '12/10/2026']])('data %s → %s', (a, b) => {
    expect(maskData(a)).toBe(b)
  })
  it.each([['61', '(61'], ['619', '(61) 9'], ['61999998888', '(61) 99999-8888'], ['6133334444', '(61) 3333-4444']])('telefone %s → %s', (a, b) => {
    expect(maskTelefone(a)).toBe(b)
  })
})
```

`apps/web/components/form/special-inputs.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PhoneInput, TagInput, TimeInput } from './index'

describe('campos especializados', () => {
  it('hora recebe a máscara ao digitar e abre teclado numérico', async () => {
    const user = userEvent.setup()
    render(<label>Abre<TimeInput /></label>)
    const input = screen.getByLabelText('Abre')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    await user.type(input, '1130')
    expect(input).toHaveValue('11:30')
  })

  it('telefone formata com DDD', async () => {
    const user = userEvent.setup()
    render(<label>Telefone<PhoneInput /></label>)
    await user.type(screen.getByLabelText('Telefone'), '61999998888')
    expect(screen.getByLabelText('Telefone')).toHaveValue('(61) 99999-8888')
  })

  function Tags() {
    const [v, setV] = useState<string[]>(['Asa Sul'])
    return <label>Apelidos<TagInput value={v} onChange={setV} placeholder="Ex.: a do lago" /></label>
  }

  it('etiquetas: Enter e vírgula adicionam, duplicado é ignorado, Backspace remove', async () => {
    const user = userEvent.setup()
    render(<Tags />)
    const input = screen.getByLabelText('Apelidos')
    await user.type(input, 'lago{Enter}')
    await user.type(input, 'centro,')
    await user.type(input, 'asa sul{Enter}')
    expect(screen.getAllByRole('button', { name: /^Remover/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remover Asa Sul',
      'Remover lago',
      'Remover centro',
    ])
    await user.type(input, '{Backspace}')
    expect(screen.queryByRole('button', { name: 'Remover centro' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remover lago' }))
    expect(screen.getAllByRole('button', { name: /^Remover/ })).toHaveLength(1)
  })
})
```
Run: `pnpm vitest run apps/web/components/form/masks.test.ts && pnpm test:ui` → FAIL.

- [ ] **Step 2: Implementação**

`apps/web/components/form/masks.ts`:
```ts
const digits = (v: string) => v.replace(/\D/g, '')

export function maskHora(v: string): string {
  const d = digits(v).slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`
}

export function maskData(v: string): string {
  const d = digits(v).slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

export function maskTelefone(v: string): string {
  const d = digits(v).slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  const corte = d.length === 11 ? 5 : 4
  return `(${ddd}) ${resto.slice(0, corte)}${resto.length > corte ? '-' + resto.slice(corte) : ''}`
}
```

`apps/web/components/form/masked-input.tsx` (base compartilhada — evita repetir a lógica nos três campos):
```tsx
'use client'
import { forwardRef } from 'react'
import { TextInput } from './text-input'

type Props = React.InputHTMLAttributes<HTMLInputElement> & { mask: (v: string) => string }

export const MaskedInput = forwardRef<HTMLInputElement, Props>(function MaskedInput({ mask, onChange, ...props }, ref) {
  return (
    <TextInput
      ref={ref}
      inputMode="numeric"
      {...props}
      onChange={(e) => {
        e.target.value = mask(e.target.value)
        onChange?.(e)
      }}
    />
  )
})
```

`time-input.tsx`, `date-input.tsx`, `phone-input.tsx`:
```tsx
'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskHora } from './masks'

export const TimeInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TimeInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskHora} maxLength={5} placeholder="Ex.: 11:30" autoComplete="off" {...props} />
})
```
```tsx
'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskData } from './masks'

export const DateInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function DateInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskData} maxLength={10} placeholder="Ex.: 12/10/2026" autoComplete="off" {...props} />
})
```
```tsx
'use client'
import { forwardRef } from 'react'
import { MaskedInput } from './masked-input'
import { maskTelefone } from './masks'

export const PhoneInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PhoneInput(props, ref) {
  return <MaskedInput ref={ref} mask={maskTelefone} maxLength={15} inputMode="tel" placeholder="Ex.: (61) 99999-8888" autoComplete="tel-national" {...props} />
})
```

`apps/web/components/form/select.tsx`:
```tsx
import { ChevronDown } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './text-input'

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(controlClass, 'appearance-none pr-10', className)} {...props}>{children}</select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    )
  },
)
```

`apps/web/components/form/tag-input.tsx`:
```tsx
'use client'
import { X } from 'lucide-react'
import { forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
}

export const TagInput = forwardRef<HTMLInputElement, Props>(function TagInput({ value, onChange, max = 20, className, ...props }, ref) {
  const [rascunho, setRascunho] = useState('')
  const adicionar = (bruto: string) => {
    const tag = bruto.trim()
    if (!tag || value.length >= max || value.some((v) => norm(v) === norm(tag))) return setRascunho('')
    onChange([...value, tag])
    setRascunho('')
  }
  return (
    <div
      className={cn(
        'flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5',
        'focus-within:ring-2 focus-within:ring-ring has-[[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-sm bg-secondary py-1 pl-2 pr-1 text-sm text-secondary-foreground">
          {tag}
          <button
            type="button"
            aria-label={`Remover ${tag}`}
            onClick={() => onChange(value.filter((v) => v !== tag))}
            className="flex size-6 items-center justify-center rounded-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={rascunho}
        onChange={(e) => {
          const v = e.target.value
          if (v.endsWith(',')) adicionar(v.slice(0, -1))
          else setRascunho(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); adicionar(rascunho) }
          if (e.key === 'Backspace' && rascunho === '' && value.length > 0) onChange(value.slice(0, -1))
        }}
        onBlur={() => adicionar(rascunho)}
        className="min-w-32 flex-1 bg-transparent px-1 py-1.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
        {...props}
      />
    </div>
  )
})
```

`apps/web/components/form/switch-field.tsx`:
```tsx
'use client'
import { Switch } from '@/components/ui/switch'

export function SwitchField(props: { id: string; label: string; hint?: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  const hintId = props.hint ? `${props.id}-ajuda` : undefined
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div>
        <label htmlFor={props.id} className="text-sm font-medium">{props.label}</label>
        {props.hint && <p id={hintId} className="text-sm text-muted-foreground">{props.hint}</p>}
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onCheckedChange} disabled={props.disabled} aria-describedby={hintId} />
    </div>
  )
}
```

`apps/web/components/form/index.ts` — acrescentar:
```ts
export { TimeInput } from './time-input'
export { DateInput } from './date-input'
export { PhoneInput } from './phone-input'
export { Select } from './select'
export { TagInput } from './tag-input'
export { SwitchField } from './switch-field'
export { maskData, maskHora, maskTelefone } from './masks'
```

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run apps/web/components/form && pnpm test:ui && pnpm lint && pnpm typecheck`
Expected: todos passam.

```bash
git add -A
git commit -m "Adiciona campos de hora, data, telefone, seleção, etiquetas e chave com máscaras

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Estrutura do painel — barra superior, navegação inferior e estados vazios

**Files:**
- Create: `apps/web/components/shell/{app-shell.tsx,top-bar.tsx,bottom-nav.tsx,empty-state.tsx}`, `apps/web/components/shell/bottom-nav.test.tsx`
- Create: `apps/web/app/(painel)/unidades/page.tsx`, `apps/web/app/(painel)/respostas/page.tsx`
- Modify: `apps/web/app/(painel)/layout.tsx`

**Interfaces:**
- Consumes: `requireStaff` (`apps/web/lib/dal.ts`), `Button` (Task 3).
- Produces:
  - `AppShell({ children })` — conteúdo com espaço inferior para a navegação (`pb-[calc(4.5rem+env(safe-area-inset-bottom))]`), `BottomNav`, e um slot fixo para o simulador (Task 12 encaixa o `SimulatorLauncher` aqui).
  - `TopBar({ title, subtitle?, action? })` — topo fixo com fundo `bg-background/90 backdrop-blur`, título em `font-display`; `action` é o botão principal da tela.
  - `BottomNav()` — 4 itens: `/` Início (`House`), `/unidades` Unidades (`Store`), `/respostas` Respostas (`MessageSquareText`), `/mais` Mais (`Menu`); item ativo com `aria-current="page"`, cor `text-primary` e barra indicadora; cada item ≥ 44px de altura, ícone + rótulo.
  - `EmptyState({ icon, title, description, action? })`.

- [ ] **Step 1: Teste que falha**

`apps/web/components/shell/bottom-nav.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const pathname = vi.hoisted(() => ({ value: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.value }))

import { BottomNav } from './bottom-nav'

describe('BottomNav', () => {
  it('mostra os 4 destinos com rótulo', () => {
    render(<BottomNav />)
    for (const nome of ['Início', 'Unidades', 'Respostas', 'Mais']) {
      expect(screen.getByRole('link', { name: nome })).toBeInTheDocument()
    }
  })
  it('marca o item ativo, inclusive em subpáginas', () => {
    pathname.value = '/unidades/123'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Unidades' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })
  it('Início só fica ativo na raiz', () => {
    pathname.value = '/'
    render(<BottomNav />)
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page')
  })
})
```
Run: `pnpm vitest run apps/web/components/shell` → FAIL.

- [ ] **Step 2: Implementação**

`apps/web/components/shell/bottom-nav.tsx`:
```tsx
'use client'
import { House, Menu, MessageSquareText, Store } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ITENS = [
  { href: '/', label: 'Início', icon: House },
  { href: '/unidades', label: 'Unidades', icon: Store },
  { href: '/respostas', label: 'Respostas', icon: MessageSquareText },
  { href: '/mais', label: 'Mais', icon: Menu },
] as const

export function BottomNav() {
  const path = usePathname()
  const ativo = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'))
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {ITENS.map(({ href, label, icon: Icon }) => {
          const on = ativo(href)
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150',
                  on ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {on && <span aria-hidden="true" className="absolute top-0 h-0.5 w-10 rounded-full bg-primary" />}
                <Icon aria-hidden="true" className="size-6" strokeWidth={on ? 2.25 : 1.75} />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

`apps/web/components/shell/top-bar.tsx`:
```tsx
export function TopBar(props: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-xl items-center justify-between gap-3 px-4 pt-[env(safe-area-inset-top)]">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{props.title}</h1>
          {props.subtitle && <p className="truncate text-sm text-muted-foreground">{props.subtitle}</p>}
        </div>
        {props.action}
      </div>
    </header>
  )
}
```

`apps/web/components/shell/empty-state.tsx`:
```tsx
import type { LucideIcon } from 'lucide-react'

export function EmptyState(props: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  const Icon = props.icon
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
        <Icon aria-hidden="true" className="size-6" />
      </span>
      <h2 className="text-lg font-semibold text-foreground">{props.title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{props.description}</p>
      {props.action}
    </div>
  )
}
```

`apps/web/components/shell/app-shell.tsx`:
```tsx
import { BottomNav } from './bottom-nav'

export function AppShell(props: { children: React.ReactNode; floating?: React.ReactNode }) {
  return (
    <div className="min-h-dvh pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      {props.children}
      {props.floating}
      <BottomNav />
    </div>
  )
}
```

`apps/web/app/(painel)/layout.tsx`:
```tsx
import { AppShell } from '@/components/shell/app-shell'
import { requireStaff } from '@/lib/dal'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()
  return <AppShell>{children}</AppShell>
}
```

`apps/web/app/(painel)/unidades/page.tsx`:
```tsx
import { Store } from 'lucide-react'
import { EmptyState } from '@/components/shell/empty-state'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export default async function UnidadesPage() {
  await requireStaff()
  return (
    <>
      <TopBar title="Unidades" subtitle="Endereços, horários e exceções" />
      <main className="mx-auto max-w-xl px-4 py-6">
        <EmptyState
          icon={Store}
          title="Cadastro de unidades em preparação"
          description="Aqui você vai cadastrar endereço, horários e feriados de cada unidade — é o que a IA usa para responder os clientes."
        />
      </main>
    </>
  )
}
```
`apps/web/app/(painel)/respostas/page.tsx`: igual, com `MessageSquareText`, título "Respostas", subtítulo "O que a IA sabe e o que falta", e texto "Aqui você vai ver as perguntas que a IA ainda não sabe responder e cadastrar as respostas."

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run apps/web/components/shell && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`

```bash
git add -A
git commit -m "Adiciona estrutura do painel com barra superior, navegação inferior e estados vazios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tela Mais — aparência (escuro/claro) e sair

**Files:**
- Create: `apps/web/app/(painel)/mais/page.tsx`, `apps/web/app/(painel)/mais/theme-form.tsx`, `apps/web/app/(painel)/mais/theme-form.test.tsx`
- Modify: `apps/web/app/(painel)/actions.ts` (acrescentar `setTheme`)

**Interfaces:**
- Consumes: `THEME_COOKIE`, `parseTema`, `Tema` (Task 2); `requireStaff`.
- Produces: Server Action `setTheme(formData: FormData): Promise<void>` — valida `tema ∈ {escuro, claro}` com Zod, grava cookie `atd-tema` (`maxAge` 1 ano, `sameSite: 'lax'`, `secure` em produção, `httpOnly: true`, `path: '/'`) e `revalidatePath('/', 'layout')`; valor inválido é ignorado (sem erro para o usuário).

- [ ] **Step 1: Teste que falha (componente)**

`apps/web/app/(painel)/mais/theme-form.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeForm } from './theme-form'

describe('ThemeForm', () => {
  it('mostra o tema atual marcado e envia a troca', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async (_fd: FormData) => {})
    render(<ThemeForm atual="escuro" action={action} />)
    expect(screen.getByRole('radio', { name: /Escuro/ })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: /Claro/ }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(action.mock.calls[0]![0].get('tema')).toBe('claro')
  })
})
```
Run: `pnpm vitest run "apps/web/app/(painel)/mais"` → FAIL.

- [ ] **Step 2: Implementação**

`apps/web/app/(painel)/mais/theme-form.tsx`:
```tsx
'use client'
import { Moon, Sun } from 'lucide-react'
import { useRef } from 'react'
import type { Tema } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPCOES: { valor: Tema; label: string; hint: string; icon: typeof Moon }[] = [
  { valor: 'escuro', label: 'Escuro', hint: 'Padrão — confortável à noite', icon: Moon },
  { valor: 'claro', label: 'Claro', hint: 'Melhor sob luz forte', icon: Sun },
]

export function ThemeForm(props: { atual: Tema; action: (fd: FormData) => void | Promise<void> }) {
  const form = useRef<HTMLFormElement>(null)
  return (
    <form ref={form} action={props.action}>
      <fieldset className="grid grid-cols-2 gap-3">
        <legend className="mb-2 text-sm font-medium text-foreground">Aparência</legend>
        {OPCOES.map(({ valor, label, hint, icon: Icon }) => (
          <label
            key={valor}
            className={cn(
              'flex min-h-20 cursor-pointer flex-col gap-1 rounded-md border bg-card p-3 transition-colors',
              'has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              'border-input',
            )}
          >
            <input
              type="radio"
              name="tema"
              value={valor}
              defaultChecked={props.atual === valor}
              onChange={() => form.current?.requestSubmit()}
              className="sr-only"
            />
            <span className="flex items-center gap-2 font-semibold text-foreground"><Icon aria-hidden="true" className="size-4" />{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </label>
        ))}
      </fieldset>
    </form>
  )
}
```

Em `apps/web/app/(painel)/actions.ts`, acrescentar:
```ts
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireStaff } from '@/lib/dal'
import { THEME_COOKIE } from '@/lib/theme'

export async function setTheme(formData: FormData) {
  await requireStaff()
  const tema = z.enum(['escuro', 'claro']).safeParse(formData.get('tema'))
  if (!tema.success) return
  ;(await cookies()).set(THEME_COOKIE, tema.data, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
  revalidatePath('/', 'layout')
}
```

`apps/web/app/(painel)/mais/page.tsx`:
```tsx
import { LogOut } from 'lucide-react'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { parseTema, THEME_COOKIE } from '@/lib/theme'
import { setTheme, signOut } from '../actions'
import { ThemeForm } from './theme-form'

export const dynamic = 'force-dynamic'

const PAPEL = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' } as const

export default async function MaisPage() {
  const session = await requireStaff()
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <>
      <TopBar title="Mais" subtitle={`Você entrou como ${PAPEL[session.role]}`} />
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-6">
        <ThemeForm atual={tema} action={setTheme} />
        <section aria-labelledby="conta" className="flex flex-col gap-3">
          <h2 id="conta" className="text-sm font-medium text-foreground">Conta</h2>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full justify-start"><LogOut aria-hidden="true" className="size-4" /> Sair</Button>
          </form>
        </section>
      </main>
    </>
  )
}
```

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run "apps/web/app/(painel)/mais" && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`

```bash
git add -A
git commit -m "Adiciona tela Mais com troca de tema escuro/claro e saída

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Início redesenhada com o design system

**Files:**
- Modify: `apps/web/app/(painel)/page.tsx`
- Create: `apps/web/components/home/stat-card.tsx`, `apps/web/components/home/stat-card.test.tsx`

**Interfaces:**
- Consumes: `getPanelStatus` (`@atd/db`), `requireStaff`, `TopBar`.
- Produces: `StatCard({ label, value, hint?, tone?: 'neutro' | 'ok' | 'alerta' })` — número grande em `font-display`, `aria-label` combinando rótulo e valor; a página Início passa a ter: status da IA (Online/Offline com ponto e texto, nunca só cor), conversas abertas, gasto de IA hoje (só dono/gerente, formato `US$ 0,0123` pt-BR) e o espaço da seção "Aguardando atendente" (preenchido na Task 11).

- [ ] **Step 1: Teste que falha**

`apps/web/components/home/stat-card.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatCard } from './stat-card'

describe('StatCard', () => {
  it('expõe rótulo e valor juntos para leitor de tela', () => {
    render(<StatCard label="Conversas abertas" value="12" hint="3 aguardando atendente" />)
    expect(screen.getByRole('group', { name: 'Conversas abertas: 12' })).toBeInTheDocument()
    expect(screen.getByText('3 aguardando atendente')).toBeInTheDocument()
  })
  it('estado de alerta não depende só de cor', () => {
    render(<StatCard label="IA" value="Offline" tone="alerta" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'IA: Offline' }).querySelector('[data-tone="alerta"] svg')).not.toBeNull()
  })
})
```
Run: `pnpm vitest run apps/web/components/home` → FAIL.

- [ ] **Step 2: Implementação**

`apps/web/components/home/stat-card.tsx`:
```tsx
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatCard(props: { label: string; value: string; hint?: string; tone?: 'neutro' | 'ok' | 'alerta' }) {
  const tone = props.tone ?? 'neutro'
  return (
    <div role="group" aria-label={`${props.label}: ${props.value}`} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{props.label}</span>
      <span data-tone={tone} className={cn('flex items-center gap-2 font-display text-3xl font-semibold tracking-tight',
        tone === 'ok' && 'text-success', tone === 'alerta' && 'text-destructive', tone === 'neutro' && 'text-foreground')}>
        {tone === 'ok' && <CheckCircle2 aria-hidden="true" className="size-6" />}
        {tone === 'alerta' && <AlertTriangle aria-hidden="true" className="size-6" />}
        {props.value}
      </span>
      {props.hint && <span className="text-sm text-muted-foreground">{props.hint}</span>}
    </div>
  )
}
```

`apps/web/app/(painel)/page.tsx`:
```tsx
import { getPanelStatus } from '@atd/db'
import { StatCard } from '@/components/home/stat-card'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

const ONLINE_MS = 60_000
const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })

export default async function InicioPage() {
  const session = await requireStaff()
  const s = await getPanelStatus(getDb(), session.claims)
  const online = s.workerLastSeen !== null && Date.now() - s.workerLastSeen.getTime() < ONLINE_MS
  return (
    <>
      <TopBar title="Início" subtitle="Como está o atendimento agora" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="IA" value={online ? 'Online' : 'Offline'} tone={online ? 'ok' : 'alerta'} hint={online ? 'Respondendo clientes' : 'Verifique o worker'} />
          <StatCard label="Conversas abertas" value={String(s.conversasAbertas)} hint={`${s.aguardandoHumano} aguardando atendente`} />
          {session.role !== 'atendente' && (
            <StatCard label="Gasto de IA hoje" value={usd.format(Number(s.gastoIaHojeUsd ?? 0))} />
          )}
        </div>
        {/* Task 11: <AwaitingHuman /> */}
      </main>
    </>
  )
}
```
(O comentário é substituído pela seção real na Task 11; o e2e existente de "Conversas abertas"/"Gasto de IA hoje" continua válido.)

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run apps/web/components/home && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`

```bash
git add -A
git commit -m "Redesenha a tela Início com cartões de status no design system

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Login e MFA com os componentes de formulário

**Files:**
- Create: `apps/web/app/(auth)/login/login-form.tsx`, `apps/web/app/(auth)/login/login-form.test.tsx`, `apps/web/components/auth/auth-card.tsx`
- Modify: `apps/web/app/(auth)/login/page.tsx`, `apps/web/app/(auth)/mfa/page.tsx`, `apps/web/e2e/auth.spec.ts` (seletores `exact`)

**Interfaces:**
- Consumes: `Field`, `TextInput`, `PasswordInput`, `SubmitButton`, `useZodForm`, `email`, `senhaLogin` (Tasks 4); `createClient` de `@/lib/supabase/client`.
- Produces:
  - `AuthCard({ title, description?, children })` — cartão centralizado com o logotipo em texto "Atendimento IA" e acento laranja, largura máx. `sm`.
  - `LoginForm({ semAcesso: boolean })` — campos "E-mail" e "Senha" (com olho); falha de login ⇒ erro **no campo Senha** ("E-mail ou senha incorretos. Confira e tente de novo.") com foco nele; `semAcesso` ⇒ aviso no topo do formulário ("Este usuário não tem acesso ao painel. Fale com o dono do restaurante."); sucesso ⇒ `router.replace('/')` + `router.refresh()`.
  - MFA: campo "Código de 6 dígitos" (`inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=6`, máscara só dígitos); erro de código no campo; QR com `alt="QR code do autenticador"` preservado.

- [ ] **Step 1: Teste que falha**

`apps/web/app/(auth)/login/login-form.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.hoisted(() => vi.fn())
const replace = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signInWithPassword: signIn } }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }))

import { LoginForm } from './login-form'

beforeEach(() => { signIn.mockReset(); replace.mockReset() })

describe('LoginForm', () => {
  it('valida antes de chamar o Supabase', async () => {
    const user = userEvent.setup()
    render(<LoginForm semAcesso={false} />)
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(signIn).not.toHaveBeenCalled()
    expect(screen.getByLabelText('E-mail', { exact: false })).toHaveFocus()
  })

  it('senha errada: erro no campo Senha com foco nele', async () => {
    const user = userEvent.setup()
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    render(<LoginForm semAcesso={false} />)
    await user.type(screen.getByLabelText(/E-mail/), 'dono@restaurante.com.br')
    await user.type(screen.getByLabelText(/^Senha/), 'errada123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    const senha = screen.getByLabelText(/^Senha/)
    expect(senha).toHaveAttribute('aria-invalid', 'true')
    expect(senha).toHaveAccessibleDescription(/E-mail ou senha incorretos/)
    expect(senha).toHaveFocus()
    expect(replace).not.toHaveBeenCalled()
  })

  it('sucesso navega para o painel', async () => {
    const user = userEvent.setup()
    signIn.mockResolvedValue({ error: null })
    render(<LoginForm semAcesso={false} />)
    await user.type(screen.getByLabelText(/E-mail/), 'dono@restaurante.com.br')
    await user.type(screen.getByLabelText(/^Senha/), 'Restaurante2026')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(signIn).toHaveBeenCalledWith({ email: 'dono@restaurante.com.br', password: 'Restaurante2026' })
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('sem acesso: aviso visível no formulário', () => {
    render(<LoginForm semAcesso />)
    expect(screen.getByRole('alert')).toHaveTextContent('Este usuário não tem acesso ao painel')
  })
})
```
Run: `pnpm vitest run "apps/web/app/(auth)/login"` → FAIL.

- [ ] **Step 2: Implementação**

`apps/web/components/auth/auth-card.tsx`:
```tsx
export function AuthCard(props: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 font-display text-lg font-semibold text-foreground">
          Atendimento <span className="text-primary">IA</span>
        </p>
        <div className="rounded-lg border border-border bg-card p-6 shadow-xl">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h1>
          {props.description && <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>}
          <div className="mt-6">{props.children}</div>
        </div>
      </div>
    </main>
  )
}
```

`apps/web/app/(auth)/login/login-form.tsx`:
```tsx
'use client'
import { AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { Field, PasswordInput, SubmitButton, TextInput, useZodForm } from '@/components/form'
import { createClient } from '@/lib/supabase/client'
import { email, senhaLogin } from '@/lib/validation'

const schema = z.object({ email, senha: senhaLogin })

export function LoginForm({ semAcesso }: { semAcesso: boolean }) {
  const router = useRouter()
  const form = useZodForm(schema, { defaultValues: { email: '', senha: '' } })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ email, senha }) => {
    const { error } = await createClient().auth.signInWithPassword({ email, password: senha })
    if (error) {
      form.setError('senha', { type: 'server', message: 'E-mail ou senha incorretos. Confira e tente de novo.' }, { shouldFocus: true })
      return
    }
    router.replace('/')
    router.refresh()
  })

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {semAcesso && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-warning p-3 text-sm text-warning">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Este usuário não tem acesso ao painel. Fale com o dono do restaurante.
        </p>
      )}
      <Field id="email" label="E-mail" error={errors.email?.message} required>
        {(a) => <TextInput {...a} type="email" autoComplete="email" placeholder="Ex.: gerente@restaurante.com.br" {...form.register('email')} />}
      </Field>
      <Field id="senha" label="Senha" error={errors.senha?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="current-password" placeholder="Sua senha" {...form.register('senha')} />}
      </Field>
      <SubmitButton pending={isSubmitting} pendingText="Entrando…" className="w-full">Entrar</SubmitButton>
    </form>
  )
}
```

`apps/web/app/(auth)/login/page.tsx`:
```tsx
import { AuthCard } from '@/components/auth/auth-card'
import { LoginForm } from './login-form'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams
  return (
    <AuthCard title="Entrar no painel" description="Use o e-mail do convite que você recebeu.">
      <LoginForm semAcesso={erro === 'sem-acesso'} />
    </AuthCard>
  )
}
```
(Lendo `searchParams` no servidor, o `Suspense` em volta de `useSearchParams` deixa de ser necessário.)

MFA (`apps/web/app/(auth)/mfa/page.tsx`): manter toda a lógica atual (listFactors, unenroll de não verificados, enroll, challenge, verify) e trocar só a apresentação:
- envolver em `<AuthCard title="Verificação em duas etapas" description="Para proteger os dados do restaurante, donos e gerentes usam um app autenticador.">`;
- o campo vira `Field id="codigo" label="Código de 6 dígitos" hint="Abra o app autenticador e digite o código atual" error={erro}` com `TextInput inputMode="numeric" autoComplete="one-time-code" maxLength={6}` e `onChange` que mantém só dígitos;
- erro de código ("Código inválido ou expirado. Confira o código atual no app.") passa a ser o `error` do `Field` (com foco no campo), não um parágrafo solto;
- botão `SubmitButton` "Confirmar" (pendente: "Verificando…");
- QR (`alt="QR code do autenticador"`) dentro de um quadro branco com padding (QR precisa de fundo claro mesmo no tema escuro), seguido da chave em `font-mono`.

`apps/web/e2e/auth.spec.ts`: trocar `page.getByLabel('Senha')` por `page.getByLabel('Senha', { exact: true })` (o botão do olho se chama "Mostrar senha") e `page.getByLabel('E-mail')` por `page.getByLabel('E-mail', { exact: true })`.

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run "apps/web/app/(auth)" && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`
E2E (ambiente como na Etapa 01): `pnpm --filter @atd/web e2e` → 4 passam.

```bash
git add -A
git commit -m "Redesenha login e MFA com os componentes de formulário e erro no campo certo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Convite → "Definir senha"

**Files:**
- Create: `supabase/templates/invite.html`
- Modify: `supabase/config.toml` (`[auth.email.template.invite]`), `apps/web/proxy.ts` (`PUBLIC_PATHS`)
- Create: `apps/web/lib/auth-confirm.ts`, `apps/web/lib/auth-confirm.test.ts`, `apps/web/app/auth/confirm/route.ts`, `apps/web/app/auth/erro/page.tsx`
- Create: `apps/web/app/(auth)/definir-senha/page.tsx`, `definir-senha-form.tsx`, `definir-senha-form.test.tsx`, `actions.ts`
- Create: `apps/web/e2e/convite.spec.ts`

**Interfaces:**
- Consumes: `senhaNova` (Task 4), `ActionResult`, `fieldErrorsFromZod`, `applyServerErrors`, `AuthCard` (Task 9).
- Produces:
  - `safeNext(next: string | null): string` — aceita só caminhos internos (`/x…`), recusa `//host`, `/\host`, esquemas e vazio ⇒ `'/'`.
  - `confirmEmailLink(verify: (p: { token_hash: string; type: 'invite' }) => Promise<{ error: unknown }>, url: URL): Promise<string>` — devolve o destino do redirect: `safeNext(next)` se `type=invite` e `verify` sem erro; senão `'/auth/erro?motivo=link'`.
  - `GET /auth/confirm` (Route Handler) usando `createClient()` (server) e `confirmEmailLink`.
  - `/auth/erro` — explica que o link expirou ou já foi usado e orienta a pedir novo convite ao dono.
  - `/definir-senha` — exige sessão (vinda do `verifyOtp`); campos "Nova senha" e "Confirme a senha" (ambos com olho); Server Action `definirSenha(prev, formData): Promise<ActionResult>` valida no servidor com o mesmo schema e chama `supabase.auth.updateUser({ password })`; sucesso ⇒ `redirect('/')` (dono/gerente seguem para `/mfa` pelo `requireStaff`).

- [ ] **Step 1: Testes que falham**

`apps/web/lib/auth-confirm.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest'
import { confirmEmailLink, safeNext } from './auth-confirm.ts'

describe('safeNext', () => {
  it.each([
    ['/definir-senha', '/definir-senha'],
    ['/unidades?x=1', '/unidades?x=1'],
    [null, '/'],
    ['', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
  ])('%s → %s', (v, esperado) => {
    expect(safeNext(v)).toBe(esperado)
  })
})

describe('confirmEmailLink', () => {
  const url = (q: string) => new URL(`http://localhost:3000/auth/confirm?${q}`)

  it('token válido de convite vai para o next seguro', async () => {
    const verify = vi.fn(async () => ({ error: null }))
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=invite&next=/definir-senha'))).toBe('/definir-senha')
    expect(verify).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' })
  })
  it('token inválido ou expirado vai para a página de erro', async () => {
    const verify = vi.fn(async () => ({ error: new Error('expired') }))
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=invite&next=/definir-senha'))).toBe('/auth/erro?motivo=link')
  })
  it('sem token ou com tipo não suportado nem chama o Supabase', async () => {
    const verify = vi.fn(async () => ({ error: null }))
    expect(await confirmEmailLink(verify, url('type=invite'))).toBe('/auth/erro?motivo=link')
    expect(await confirmEmailLink(verify, url('token_hash=abc&type=magiclink'))).toBe('/auth/erro?motivo=link')
    expect(verify).not.toHaveBeenCalled()
  })
})
```

`apps/web/app/(auth)/definir-senha/definir-senha-form.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DefinirSenhaForm } from './definir-senha-form'

describe('DefinirSenhaForm', () => {
  it('senhas diferentes: erro no campo de confirmação', async () => {
    const user = userEvent.setup()
    const action = vi.fn()
    render(<DefinirSenhaForm action={action} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'Restaurante2026')
    await user.type(screen.getByLabelText(/^Confirme a senha/), 'Restaurante2025')
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    const confirma = screen.getByLabelText(/^Confirme a senha/)
    expect(confirma).toHaveAttribute('aria-invalid', 'true')
    expect(confirma).toHaveAccessibleDescription(/As senhas não conferem/)
    expect(action).not.toHaveBeenCalled()
  })

  it('senha fraca explica a regra no campo', async () => {
    const user = userEvent.setup()
    render(<DefinirSenhaForm action={vi.fn()} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'curta')
    await user.tab()
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(/pelo menos 12 caracteres/)
  })

  it('erro do servidor aparece no campo da nova senha', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ ok: false as const, fieldErrors: { senha: 'Escolha uma senha diferente da anterior' } }))
    render(<DefinirSenhaForm action={action} />)
    await user.type(screen.getByLabelText(/^Nova senha/), 'Restaurante2026')
    await user.type(screen.getByLabelText(/^Confirme a senha/), 'Restaurante2026')
    await user.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(/Escolha uma senha diferente/)
  })
})
```
Run: `pnpm vitest run apps/web/lib/auth-confirm.test.ts "apps/web/app/(auth)/definir-senha"` → FAIL.

- [ ] **Step 2: Lógica do link**

`apps/web/lib/auth-confirm.ts`:
```ts
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}

const ERRO = '/auth/erro?motivo=link'

export async function confirmEmailLink(
  verify: (p: { token_hash: string; type: 'invite' }) => Promise<{ error: unknown }>,
  url: URL,
): Promise<string> {
  const token_hash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type')
  if (!token_hash || type !== 'invite') return ERRO
  const { error } = await verify({ token_hash, type })
  return error ? ERRO : safeNext(url.searchParams.get('next'))
}
```

`apps/web/app/auth/confirm/route.ts`:
```ts
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { confirmEmailLink } from '@/lib/auth-confirm'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const destino = await confirmEmailLink((p) => supabase.auth.verifyOtp(p), new URL(request.url))
  redirect(destino)
}
```

`apps/web/app/auth/erro/page.tsx`:
```tsx
import { AuthCard } from '@/components/auth/auth-card'

export default function AuthErroPage() {
  return (
    <AuthCard title="Link inválido ou expirado" description="Links de convite valem por 1 hora e só podem ser usados uma vez.">
      <p className="text-sm text-foreground">Peça ao dono do restaurante um novo convite e abra o link mais recente do seu e-mail.</p>
      <a href="/login" className="mt-6 inline-block text-sm font-semibold">Ir para o login</a>
    </AuthCard>
  )
}
```

`apps/web/proxy.ts`: `PUBLIC_PATHS = ['/login', '/privacidade', '/auth/confirm', '/auth/erro']` (o `/definir-senha` **não** é público: precisa da sessão criada pelo `verifyOtp`).

- [ ] **Step 3: Tela e ação de definir senha**

`apps/web/app/(auth)/definir-senha/schema.ts`:
```ts
import { z } from 'zod'
import { senhaNova } from '@/lib/validation'

export const definirSenhaSchema = z
  .object({ senha: senhaNova, confirmacao: z.string().min(1, 'Repita a senha') })
  .refine((v) => v.senha === v.confirmacao, { path: ['confirmacao'], message: 'As senhas não conferem. Digite a mesma senha nos dois campos.' })
```

`apps/web/app/(auth)/definir-senha/actions.ts`:
```ts
'use server'
import { redirect } from 'next/navigation'
import { fieldErrorsFromZod, type ActionResult } from '@/lib/action-result'
import { createClient } from '@/lib/supabase/server'
import { definirSenhaSchema } from './schema'

export async function definirSenha(input: { senha: string; confirmacao: string }): Promise<ActionResult> {
  const parsed = definirSenhaSchema.safeParse(input)
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFromZod(parsed.error) }
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims?.sub) redirect('/auth/erro?motivo=link')
  const { error } = await supabase.auth.updateUser({ password: parsed.data.senha })
  if (error) {
    const msg = /different from the old/i.test(error.message)
      ? 'Escolha uma senha diferente da anterior'
      : /weak|pwned|short/i.test(error.message)
        ? 'Senha considerada fraca. Use mais caracteres, misturando letras e números.'
        : null
    return msg ? { ok: false, fieldErrors: { senha: msg } } : { ok: false, formError: 'Não foi possível salvar a senha. Tente novamente.' }
  }
  redirect('/')
}
```
(Server Action pública por natureza: valida no servidor e exige sessão; nunca confia no cliente.)

`apps/web/app/(auth)/definir-senha/definir-senha-form.tsx`:
```tsx
'use client'
import { AlertTriangle } from 'lucide-react'
import { applyServerErrors, Field, PasswordInput, SubmitButton, useZodForm } from '@/components/form'
import type { ActionResult } from '@/lib/action-result'
import { definirSenhaSchema } from './schema'

export function DefinirSenhaForm(props: { action: (input: { senha: string; confirmacao: string }) => Promise<ActionResult> | void }) {
  const form = useZodForm(definirSenhaSchema, { defaultValues: { senha: '', confirmacao: '' } })
  const { errors, isSubmitting } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    const result = await props.action(values)
    if (result && !result.ok) applyServerErrors(form, result)
  })
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {errors.root?.server?.message && (
        <p role="alert" className="flex items-start gap-2 text-sm font-medium text-destructive">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4" />{errors.root.server.message}
        </p>
      )}
      <Field id="senha" label="Nova senha" hint="Pelo menos 12 caracteres, misturando letras e números" error={errors.senha?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" placeholder="Ex.: Restaurante2026" {...form.register('senha')} />}
      </Field>
      <Field id="confirmacao" label="Confirme a senha" error={errors.confirmacao?.message} required>
        {(a) => <PasswordInput {...a} autoComplete="new-password" placeholder="Digite a mesma senha" {...form.register('confirmacao')} />}
      </Field>
      <SubmitButton pending={isSubmitting} className="w-full">Salvar senha</SubmitButton>
    </form>
  )
}
```

`apps/web/app/(auth)/definir-senha/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { AuthCard } from '@/components/auth/auth-card'
import { createClient } from '@/lib/supabase/server'
import { definirSenha } from './actions'
import { DefinirSenhaForm } from './definir-senha-form'

export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  const { data } = await (await createClient()).auth.getClaims()
  if (!data?.claims?.sub) redirect('/login')
  return (
    <AuthCard title="Crie sua senha" description="Você foi convidado para o painel de atendimento. Defina uma senha para entrar.">
      <DefinirSenhaForm action={definirSenha} />
    </AuthCard>
  )
}
```

- [ ] **Step 4: Modelo de e-mail do convite**

`supabase/templates/invite.html`:
```html
<h2>Você foi convidado para o painel de atendimento</h2>
<p>Para criar sua senha e acessar o painel, abra o link abaixo. Ele vale por 1 hora e só pode ser usado uma vez.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha">Criar minha senha</a></p>
<p>Se você não esperava este convite, ignore este e-mail.</p>
```
`supabase/config.toml` — descomentar/criar:
```toml
[auth.email.template.invite]
subject = "Convite para o painel de atendimento"
content_path = "./supabase/templates/invite.html"
```
Reiniciar o Supabase local (`pnpm db:stop && pnpm db:start`) para aplicar o modelo.

- [ ] **Step 5: E2E do convite**

`apps/web/e2e/convite.spec.ts` (gera o link pelo Admin API, sem depender do e-mail; usa a mesma conexão `sql` e o padrão de usuários `@teste.local` do `auth.spec.ts`):
```ts
import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const sql = postgres(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')

test.afterAll(async () => {
  await sql`delete from auth.users where email like '%@teste.local'`
  await sql.end()
})

test('convite leva a definir senha e depois ao painel (atendente)', async ({ page }) => {
  const email = `convite-${Date.now()}@teste.local`
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email })
  if (error) throw error
  const [r] = await sql`select id from restaurants limit 1`
  await sql`insert into staff (user_id, restaurant_id, nome, papel) values (${data.user.id}, ${r!.id}, 'Atendente', 'atendente')`

  await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite&next=/definir-senha`)
  await expect(page).toHaveURL(/\/definir-senha$/)
  await page.getByLabel('Nova senha', { exact: true }).fill('Restaurante2026')
  await page.getByLabel('Confirme a senha', { exact: true }).fill('Restaurante2026')
  await page.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
})

test('link inválido mostra a página de erro', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=invalido&type=invite&next=/definir-senha')
  await expect(page.getByRole('heading', { name: 'Link inválido ou expirado' })).toBeVisible()
})
```

- [ ] **Step 6: Rodar, verificar e commitar**

Run: `pnpm vitest run apps/web/lib/auth-confirm.test.ts && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build && pnpm --filter @atd/web e2e`

```bash
git add -A
git commit -m "Adiciona fluxo de convite com definir senha e página de link inválido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: "Devolver à IA"

**Files:**
- Create: `packages/db/src/conversations-panel.ts`, `packages/db/src/conversations-panel.db.test.ts`
- Modify: `packages/db/src/index.ts`, `apps/web/app/(painel)/actions.ts`, `apps/web/app/(painel)/page.tsx`
- Create: `apps/web/components/conversations/awaiting-human.tsx`, `apps/web/components/conversations/awaiting-human.test.tsx`

**Interfaces:**
- Consumes: `withUserContext`, `JwtClaims` (Etapa 01); `conversations`, `customers`, `auditLog` (schema).
- Produces:
  - `type AwaitingItem = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date }`
  - `listAwaitingHuman(db: Db, claims: JwtClaims): Promise<AwaitingItem[]>` — conversas do restaurante do usuário em `aguardando_humano` ou `humano`, mais recentes primeiro, máx. 50 (RLS decide o que aparece).
  - `type ReturnResult = 'devolvida' | 'ja_estava' | 'nao_encontrada'`
  - `returnToAi(db: Db, claims: JwtClaims, conversationId: string): Promise<ReturnResult>` — numa transação com o contexto do usuário: `UPDATE conversations SET estado='ia', atendente_id=NULL WHERE id=$1 AND estado IN ('aguardando_humano','humano') RETURNING id, restaurant_id`; se atualizou, insere `audit_log` (`ator_tipo='staff'`, `ator_id=claims.sub`, `acao='conversa.devolvida_ia'`, `entidade='conversation'`); se não, distingue "existe e já está com a IA" de "não encontrada/sem acesso".
  - Server Action `returnToAiAction(conversationId: string): Promise<{ resultado: ReturnResult }>` (valida UUID com Zod; `requireStaff`; `revalidatePath('/')`).
  - `AwaitingHuman({ itens, action })` — lista com nome do perfil (ou "Cliente sem nome"), tempo relativo ("há 5 min") e botão "Devolver à IA" por item; toast de sucesso "Conversa devolvida à IA" ou informativo "Esta conversa já estava com a IA".

- [ ] **Step 1: Testes de banco que falham**

`packages/db/src/conversations-panel.db.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb, seedRestaurant, seedStaff } from './test-utils.ts'
import { listAwaitingHuman, returnToAi } from './conversations-panel.ts'
import { auditLog, conversations, customers } from './schema/index.ts'

const { db, sql } = getTestDb()
beforeEach(() => resetDb(sql))
afterAll(() => sql.end())

const claims = (sub: string, aal: 'aal1' | 'aal2' = 'aal1') => ({ sub, role: 'authenticated' as const, aal })

async function conversaAguardando(restaurantId: string, nome = 'Maria') {
  const [c] = await db.insert(customers).values({ restaurantId, waIdHash: crypto.randomUUID(), telefoneCifrado: 'x', nomePerfil: nome }).returning()
  const [conv] = await db.insert(conversations).values({ restaurantId, customerId: c!.id, estado: 'aguardando_humano' }).returning()
  return conv!.id
}

describe('devolver à IA', () => {
  it('lista as conversas aguardando atendente do próprio restaurante', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    await conversaAguardando(a.restaurantId, 'Maria')
    await conversaAguardando(b.restaurantId, 'Outro restaurante')
    const itens = await listAwaitingHuman(db, claims(atendente))
    expect(itens.map((i) => i.nome)).toEqual(['Maria'])
  })

  it('devolve, audita e fica com a IA', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const id = await conversaAguardando(restaurantId)
    expect(await returnToAi(db, claims(atendente), id)).toBe('devolvida')
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id))
    expect(conv!.estado).toBe('ia')
    const audit = await db.select().from(auditLog)
    expect(audit.map((x) => [x.acao, x.atorTipo, x.atorId, x.entidadeId])).toEqual([['conversa.devolvida_ia', 'staff', atendente, id]])
  })

  it('idempotente: a segunda devolução não audita de novo', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId, papel: 'atendente' })
    const id = await conversaAguardando(restaurantId)
    const r = await Promise.all([returnToAi(db, claims(atendente), id), returnToAi(db, claims(atendente), id)])
    expect(r.sort()).toEqual(['devolvida', 'ja_estava'])
    expect(await db.select().from(auditLog)).toHaveLength(1)
  })

  it('conversa de outro restaurante não é encontrada (RLS)', async () => {
    const a = await seedRestaurant(db)
    const b = await seedRestaurant(db)
    const atendente = await seedStaff(db, sql, { restaurantId: a.restaurantId, papel: 'atendente' })
    const deB = await conversaAguardando(b.restaurantId)
    expect(await returnToAi(db, claims(atendente), deB)).toBe('nao_encontrada')
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, deB))
    expect(conv!.estado).toBe('aguardando_humano')
  })

  it('dono sem MFA não consegue devolver', async () => {
    const { restaurantId } = await seedRestaurant(db)
    const dono = await seedStaff(db, sql, { restaurantId, papel: 'dono' })
    const id = await conversaAguardando(restaurantId)
    expect(await returnToAi(db, claims(dono, 'aal1'), id)).toBe('nao_encontrada')
    expect(await returnToAi(db, claims(dono, 'aal2'), id)).toBe('devolvida')
  })
})
```
Run: `pnpm vitest run --project db packages/db/src/conversations-panel.db.test.ts` → FAIL.

- [ ] **Step 2: Implementação (banco)**

`packages/db/src/conversations-panel.ts`:
```ts
import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from './client.ts'
import { withUserContext, type JwtClaims } from './rls.ts'
import { auditLog, conversations, customers } from './schema/index.ts'

export type AwaitingItem = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date }
export type ReturnResult = 'devolvida' | 'ja_estava' | 'nao_encontrada'

const COM_HUMANO = ['aguardando_humano', 'humano'] as const

export function listAwaitingHuman(db: Db, claims: JwtClaims): Promise<AwaitingItem[]> {
  return withUserContext(db, claims, async (tx) => {
    const rows = await tx
      .select({ id: conversations.id, nome: customers.nomePerfil, estado: conversations.estado, desde: conversations.lastMessageAt })
      .from(conversations)
      .innerJoin(customers, eq(customers.id, conversations.customerId))
      .where(inArray(conversations.estado, [...COM_HUMANO]))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(50)
    return rows as AwaitingItem[]
  })
}

export function returnToAi(db: Db, claims: JwtClaims, conversationId: string): Promise<ReturnResult> {
  return withUserContext(db, claims, async (tx) => {
    const [row] = await tx
      .update(conversations)
      .set({ estado: 'ia', atendenteId: null })
      .where(and(eq(conversations.id, conversationId), inArray(conversations.estado, [...COM_HUMANO])))
      .returning({ id: conversations.id, restaurantId: conversations.restaurantId })
    if (row) {
      await tx.insert(auditLog).values({
        restaurantId: row.restaurantId,
        atorId: claims.sub,
        atorTipo: 'staff',
        acao: 'conversa.devolvida_ia',
        entidade: 'conversation',
        entidadeId: row.id,
      })
      return 'devolvida'
    }
    const [existe] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId))
    return existe ? 'ja_estava' : 'nao_encontrada'
  })
}
```
`packages/db/src/index.ts` — acrescentar `export * from './conversations-panel.ts'`.

Run: `pnpm vitest run --project db packages/db/src/conversations-panel.db.test.ts` → 5 passam. (O `UPDATE` só toca `estado`/`atendente_id`, as colunas que o papel `authenticated` pode alterar desde a migration 0006; o `updated_at` vem do trigger.)

- [ ] **Step 3: Componente e ação**

`apps/web/components/conversations/awaiting-human.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AwaitingHuman } from './awaiting-human'

const item = { id: '11111111-1111-4111-8111-111111111111', nome: 'Maria', estado: 'aguardando_humano' as const, desde: new Date(Date.now() - 5 * 60_000) }

describe('AwaitingHuman', () => {
  it('estado vazio quando ninguém espera', () => {
    render(<AwaitingHuman itens={[]} action={vi.fn()} />)
    expect(screen.getByText('Ninguém aguardando atendente')).toBeInTheDocument()
  })
  it('devolve e confirma com toast', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ resultado: 'devolvida' as const }))
    render(<AwaitingHuman itens={[item]} action={action} />)
    expect(screen.getByText('Maria')).toBeInTheDocument()
    expect(screen.getByText(/há 5 min/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Devolver à IA a conversa de Maria' }))
    expect(action).toHaveBeenCalledWith(item.id)
    expect(toast.success).toHaveBeenCalledWith('Conversa devolvida à IA')
  })
  it('já estava com a IA: informa sem erro', async () => {
    const user = userEvent.setup()
    render(<AwaitingHuman itens={[item]} action={vi.fn(async () => ({ resultado: 'ja_estava' as const }))} />)
    await user.click(screen.getByRole('button', { name: /Devolver à IA/ }))
    expect(toast.info).toHaveBeenCalledWith('Esta conversa já estava com a IA')
  })
})
```

`apps/web/components/conversations/awaiting-human.tsx`:
```tsx
'use client'
import { Bot, UserRound } from 'lucide-react'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Item = { id: string; nome: string | null; estado: 'aguardando_humano' | 'humano'; desde: Date }
type Resultado = 'devolvida' | 'ja_estava' | 'nao_encontrada'

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
function haQuanto(d: Date) {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60_000)
  if (min < 60) return rtf.format(-Math.max(min, 1), 'minute')
  const h = Math.round(min / 60)
  return h < 24 ? rtf.format(-h, 'hour') : rtf.format(-Math.round(h / 24), 'day')
}

export function AwaitingHuman(props: { itens: Item[]; action: (id: string) => Promise<{ resultado: Resultado }> }) {
  const [pending, start] = useTransition()
  if (props.itens.length === 0) {
    return (
      <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
        <h2 id="aguardando" className="text-base font-semibold">Aguardando atendente</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ninguém aguardando atendente</p>
      </section>
    )
  }
  return (
    <section aria-labelledby="aguardando" className="rounded-lg border border-border bg-card p-4">
      <h2 id="aguardando" className="text-base font-semibold">Aguardando atendente</h2>
      <ul className="mt-3 divide-y divide-border">
        {props.itens.map((c) => {
          const nome = c.nome ?? 'Cliente sem nome'
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary"><UserRound aria-hidden="true" className="size-5" /></span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{nome}</p>
                  <p className="text-sm text-muted-foreground">{c.estado === 'humano' ? 'Em atendimento' : 'Pediu atendente'} · {haQuanto(c.desde)}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                disabled={pending}
                aria-label={`Devolver à IA a conversa de ${nome}`}
                onClick={() => start(async () => {
                  const { resultado } = await props.action(c.id)
                  if (resultado === 'devolvida') toast.success('Conversa devolvida à IA')
                  else if (resultado === 'ja_estava') toast.info('Esta conversa já estava com a IA')
                  else toast.error('Conversa não encontrada')
                })}
              >
                <Bot aria-hidden="true" className="size-4" /> Devolver à IA
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

Em `apps/web/app/(painel)/actions.ts`, acrescentar:
```ts
import { returnToAi, type ReturnResult } from '@atd/db'
import { getDb } from '@/lib/server/db'

export async function returnToAiAction(conversationId: string): Promise<{ resultado: ReturnResult }> {
  const session = await requireStaff()
  const id = z.uuid().safeParse(conversationId)
  if (!id.success) return { resultado: 'nao_encontrada' }
  const resultado = await returnToAi(getDb(), session.claims, id.data)
  revalidatePath('/')
  return { resultado }
}
```
Em `apps/web/app/(painel)/page.tsx`, trocar o comentário da Task 8 por:
```tsx
        <AwaitingHuman itens={await listAwaitingHuman(getDb(), session.claims)} action={returnToAiAction} />
```
(com os imports de `AwaitingHuman`, `listAwaitingHuman` e `returnToAiAction`).

- [ ] **Step 4: Rodar, verificar e commitar**

Run: `pnpm vitest run --project db packages/db/src/conversations-panel.db.test.ts && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`

```bash
git add -A
git commit -m "Adiciona devolver à IA com auditoria e lista de quem aguarda atendente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Simulador de WhatsApp — casca visual

**Files:**
- Create: `apps/web/components/simulator/{types.ts,whatsapp-icon.tsx,bubbles.tsx,whatsapp-chat.tsx,phone-frame.tsx,launcher.tsx,use-local-simulator.ts}`
- Test: `apps/web/components/simulator/whatsapp-chat.test.tsx`, `apps/web/components/simulator/launcher.test.tsx`, `apps/web/components/simulator/colors.test.ts`
- Modify: `apps/web/app/(painel)/layout.tsx` (encaixa o launcher), `apps/web/package.json` (`simple-icons@^16.34.0`)

**Interfaces:**
- Produces (contrato que o plano 02-C liga ao pipeline real — **não mudar nomes sem atualizar a spec**):
  - `types.ts`:
    ```ts
    export type SimStatus = 'enviando' | 'enviada' | 'entregue' | 'lida'
    export type SimMessage =
      | { id: string; de: 'cliente' | 'restaurante'; tipo: 'texto'; texto: string; hora: string; status?: SimStatus }
      | { id: string; de: 'restaurante'; tipo: 'lista'; texto: string; botao: string; secoes: { titulo: string; itens: { id: string; titulo: string; descricao?: string }[] }[]; hora: string }
      | { id: string; de: 'restaurante'; tipo: 'localizacao'; nome: string; endereco: string; lat: number; lng: number; hora: string }
      | { id: string; de: 'sistema'; tipo: 'aviso'; texto: string }
    ```
  - `WhatsAppChat({ restaurante, mensagens, digitando, onEnviar(texto), onEscolher(mensagemId, itemId, titulo) })` — apresentação pura, sem estado de conversa.
  - `PhoneFrame({ children })` — moldura de iPhone 17 a partir de `md`; tela cheia abaixo disso.
  - `SimulatorLauncher({ restaurante })` — botão flutuante verde no canto inferior direito (acima da barra de navegação) com o ícone do WhatsApp e `aria-label="Abrir simulador de WhatsApp"`; abre um `Dialog` com título acessível "Simulador de WhatsApp".
  - `useLocalSimulator()` — estado local da 02-A: `mensagens`, `enviar(texto)` (acrescenta balão do cliente: `enviando` → `entregue`), `escolher(...)` (acrescenta a escolha como balão do cliente) e um aviso fixo de sistema "Simulação visual — as respostas da IA serão ligadas na próxima etapa (02-C)". O 02-C troca este hook pelo que fala com o pipeline, sem mudar `WhatsAppChat`.
  - Cores do simulador (WhatsApp escuro): fundo `#0B141A`, cabeçalho/compositor `#202C33`, balão do cliente `#005C4B`, balão do restaurante `#202C33`, texto `#E9EDEF`, metadados `#8696A0`, ✓✓ lida `#53BDEB`, botão enviar/FAB `#25D366` (ícone `#0B141A` sobre ele).

- [ ] **Step 1: Testes que falham**

`apps/web/components/simulator/colors.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/design/contrast'
import { WA } from './whatsapp-chat'

describe('cores do simulador (AA)', () => {
  it.each([
    ['texto no balão do cliente', WA.texto, WA.balaoCliente, 4.5],
    ['texto no balão do restaurante', WA.texto, WA.balaoRestaurante, 4.5],
    ['metadados no fundo', WA.meta, WA.fundo, 4.5],
    ['ícone no botão verde', WA.fundo, WA.verde, 3],
  ])('%s', (_n, a, b, min) => {
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(min)
  })
})
```

`apps/web/components/simulator/whatsapp-chat.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SimMessage } from './types'
import { WhatsAppChat } from './whatsapp-chat'

const base = { restaurante: 'Casa Teste', digitando: false, onEnviar: vi.fn(), onEscolher: vi.fn() }

describe('WhatsAppChat', () => {
  it('cabeçalho, mensagens em ordem e região que anuncia novas mensagens', () => {
    const mensagens: SimMessage[] = [
      { id: '1', de: 'cliente', tipo: 'texto', texto: 'abre domingo?', hora: '10:01', status: 'lida' },
      { id: '2', de: 'restaurante', tipo: 'texto', texto: 'Abrimos domingo das 11h30 às 16h.', hora: '10:01' },
    ]
    render(<WhatsAppChat {...base} mensagens={mensagens} />)
    expect(screen.getByRole('heading', { name: 'Casa Teste' })).toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()
    const log = screen.getByRole('log')
    expect(within(log).getAllByRole('article').map((a) => a.textContent)).toEqual([
      expect.stringContaining('abre domingo?'),
      expect.stringContaining('Abrimos domingo das 11h30 às 16h.'),
    ])
    expect(screen.getByLabelText('Lida')).toBeInTheDocument()
  })

  it('mostra "digitando…" no cabeçalho', () => {
    render(<WhatsAppChat {...base} mensagens={[]} digitando />)
    expect(screen.getByText('digitando…')).toBeInTheDocument()
  })

  it('envia com Enter e com o botão; não envia vazio', async () => {
    const user = userEvent.setup()
    const onEnviar = vi.fn()
    render(<WhatsAppChat {...base} mensagens={[]} onEnviar={onEnviar} />)
    const campo = screen.getByRole('textbox', { name: 'Mensagem' })
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    await user.type(campo, 'oi{Enter}')
    await user.type(campo, 'tem estacionamento?')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(onEnviar.mock.calls).toEqual([['oi'], ['tem estacionamento?']])
    expect(campo).toHaveValue('')
  })

  it('lista interativa abre as opções e devolve a escolha', async () => {
    const user = userEvent.setup()
    const onEscolher = vi.fn()
    const lista: SimMessage = {
      id: 'l1', de: 'restaurante', tipo: 'lista', texto: 'Qual unidade?', botao: 'Ver unidades', hora: '10:02',
      secoes: [{ titulo: 'Unidades', itens: [{ id: 'u1', titulo: 'Asa Sul', descricao: 'SCLS 404' }, { id: 'u2', titulo: 'Lago Sul' }] }],
    }
    render(<WhatsAppChat {...base} mensagens={[lista]} onEscolher={onEscolher} />)
    await user.click(screen.getByRole('button', { name: 'Ver unidades' }))
    const opcoes = screen.getByRole('dialog', { name: 'Ver unidades' })
    await user.click(within(opcoes).getByRole('button', { name: /Asa Sul/ }))
    expect(onEscolher).toHaveBeenCalledWith('l1', 'u1', 'Asa Sul')
  })

  it('localização mostra endereço e abre no Maps com as coordenadas', () => {
    const loc: SimMessage = { id: 'p1', de: 'restaurante', tipo: 'localizacao', nome: 'Casa Teste — Asa Sul', endereco: 'SCLS 404 Bloco C', lat: -15.8267, lng: -47.9218, hora: '10:03' }
    render(<WhatsAppChat {...base} mensagens={[loc]} />)
    expect(screen.getByText('SCLS 404 Bloco C')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir no Maps/ })).toHaveAttribute('href', 'https://www.google.com/maps?q=-15.8267,-47.9218')
  })
})
```

`apps/web/components/simulator/launcher.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SimulatorLauncher } from './launcher'

describe('SimulatorLauncher', () => {
  it('abre o simulador com foco no campo de mensagem e fecha com Esc', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    expect(screen.getByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Simulador de WhatsApp' })).toBeNull()
  })

  it('na 02-A, mensagem enviada vira balão do cliente e aparece o aviso de simulação visual', async () => {
    const user = userEvent.setup()
    render(<SimulatorLauncher restaurante="Casa Teste" />)
    await user.click(screen.getByRole('button', { name: 'Abrir simulador de WhatsApp' }))
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'abre domingo?{Enter}')
    expect(screen.getByText('abre domingo?')).toBeInTheDocument()
    expect(screen.getByText(/Simulação visual/)).toBeInTheDocument()
  })
})
```
Run: `pnpm vitest run apps/web/components/simulator` → FAIL.

- [ ] **Step 2: Implementação**

Run: `pnpm --filter @atd/web add simple-icons@^16.34.0`

`apps/web/components/simulator/whatsapp-icon.tsx` (glifo oficial do pacote `simple-icons`, só para indicar a integração):
```tsx
import { siWhatsapp } from 'simple-icons'

export function WhatsAppIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className} fill="currentColor">
      <path d={siWhatsapp.path} />
    </svg>
  )
}
```

`apps/web/components/simulator/bubbles.tsx`:
```tsx
'use client'
import { Check, CheckCheck, Clock3, List, MapPin } from 'lucide-react'
import { useState } from 'react'
import type { SimMessage, SimStatus } from './types'

export const WA = {
  fundo: '#0B141A', barra: '#202C33', balaoCliente: '#005C4B', balaoRestaurante: '#202C33',
  texto: '#E9EDEF', meta: '#8696A0', lida: '#53BDEB', verde: '#25D366',
} as const

function Status({ s }: { s?: SimStatus }) {
  if (!s) return null
  if (s === 'enviando') return <Clock3 aria-label="Enviando" className="size-3.5" />
  if (s === 'enviada') return <Check aria-label="Enviada" className="size-4" />
  return <CheckCheck aria-label={s === 'lida' ? 'Lida' : 'Entregue'} className="size-4" style={{ color: s === 'lida' ? WA.lida : WA.meta }} />
}

function Hora({ hora, status }: { hora: string; status?: SimStatus }) {
  return (
    <span className="ml-2 inline-flex translate-y-1 items-center gap-1 float-right text-[11px]" style={{ color: WA.meta }}>
      {hora}<Status s={status} />
    </span>
  )
}

export function Bubble(props: { m: SimMessage; onEscolher: (mensagemId: string, itemId: string, titulo: string) => void }) {
  const { m } = props
  const [listaAberta, setListaAberta] = useState(false)
  if (m.tipo === 'aviso') {
    return (
      <p className="mx-auto my-2 max-w-[85%] rounded-lg px-3 py-1.5 text-center text-xs" style={{ background: '#182229', color: WA.meta }}>
        {m.texto}
      </p>
    )
  }
  const doCliente = m.de === 'cliente'
  return (
    <article
      className={`relative my-1 max-w-[82%] rounded-lg px-2.5 py-1.5 text-[15px] leading-snug shadow-sm ${doCliente ? 'ml-auto rounded-tr-none' : 'mr-auto rounded-tl-none'}`}
      style={{ background: doCliente ? WA.balaoCliente : WA.balaoRestaurante, color: WA.texto }}
    >
      {m.tipo === 'texto' && (<p className="whitespace-pre-wrap break-words">{m.texto}<Hora hora={m.hora} status={m.status} /></p>)}

      {m.tipo === 'localizacao' && (
        <div className="w-60">
          <div className="flex h-28 items-center justify-center rounded-md" style={{ background: '#2A3942' }}>
            <MapPin aria-hidden="true" className="size-8" style={{ color: '#F15C6D' }} />
          </div>
          <p className="mt-1.5 font-medium">{m.nome}</p>
          <p className="text-sm" style={{ color: WA.meta }}>{m.endereco}</p>
          <a
            href={`https://www.google.com/maps?q=${m.lat},${m.lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block text-sm font-medium"
            style={{ color: WA.lida }}
          >
            Abrir no Maps
          </a>
          <Hora hora={m.hora} />
        </div>
      )}

      {m.tipo === 'lista' && (
        <div className="w-64">
          <p className="whitespace-pre-wrap">{m.texto}<Hora hora={m.hora} /></p>
          <button
            type="button"
            onClick={() => setListaAberta(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 border-t pt-2 text-[15px] font-medium"
            style={{ borderColor: '#2A3942', color: WA.lida }}
          >
            <List aria-hidden="true" className="size-4" />{m.botao}
          </button>
          {listaAberta && (
            <div role="dialog" aria-label={m.botao} className="fixed inset-x-0 bottom-0 z-10 rounded-t-2xl p-4" style={{ background: WA.barra }}>
              {m.secoes.map((sec) => (
                <section key={sec.titulo}>
                  <h3 className="mb-2 text-sm font-semibold" style={{ color: '#00A884' }}>{sec.titulo}</h3>
                  <ul>
                    {sec.itens.map((it) => (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => { setListaAberta(false); props.onEscolher(m.id, it.id, it.titulo) }}
                          className="flex min-h-12 w-full flex-col items-start justify-center border-b py-2 text-left"
                          style={{ borderColor: '#2A3942', color: WA.texto }}
                        >
                          <span>{it.titulo}</span>
                          {it.descricao && <span className="text-sm" style={{ color: WA.meta }}>{it.descricao}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}
```

`apps/web/components/simulator/whatsapp-chat.tsx`:
```tsx
'use client'
import { ArrowLeft, MoreVertical, Phone, SendHorizontal, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Bubble, WA } from './bubbles'
import type { SimMessage } from './types'

export { WA }

export function WhatsAppChat(props: {
  restaurante: string
  mensagens: SimMessage[]
  digitando: boolean
  onEnviar: (texto: string) => void
  onEscolher: (mensagemId: string, itemId: string, titulo: string) => void
}) {
  const [texto, setTexto] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => { fim.current?.scrollIntoView?.({ block: 'end' }) }, [props.mensagens.length, props.digitando])

  const enviar = () => {
    const t = texto.trim()
    if (!t) return
    props.onEnviar(t)
    setTexto('')
  }

  return (
    <div className="flex h-full flex-col" style={{ background: WA.fundo, color: WA.texto }}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-2" style={{ background: WA.barra }}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full text-sm font-semibold" style={{ background: '#6B7C85' }}>
          {props.restaurante.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium leading-tight" style={{ color: WA.texto }}>{props.restaurante}</h2>
          <p className="text-xs" style={{ color: WA.meta }}>{props.digitando ? 'digitando…' : 'online'}</p>
        </div>
        <Video aria-hidden="true" className="size-5" /><Phone aria-hidden="true" className="ml-3 size-5" /><MoreVertical aria-hidden="true" className="ml-2 size-5" />
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversa"
        className="flex-1 overflow-y-auto px-3 py-2"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      >
        <p className="mx-auto mb-2 w-fit rounded-md px-2 py-1 text-xs" style={{ background: '#182229', color: WA.meta }}>Hoje</p>
        {props.mensagens.map((m) => <Bubble key={m.id} m={m} onEscolher={props.onEscolher} />)}
        <div ref={fim} />
      </div>

      <form
        className="flex shrink-0 items-end gap-2 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => { e.preventDefault(); enviar() }}
      >
        <input
          aria-label="Mensagem"
          placeholder="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          autoFocus
          className="h-11 flex-1 rounded-full px-4 text-[15px] outline-none placeholder:opacity-80"
          style={{ background: WA.barra, color: WA.texto }}
        />
        <button
          type="submit"
          aria-label="Enviar"
          disabled={!texto.trim()}
          className="flex size-11 items-center justify-center rounded-full disabled:opacity-60"
          style={{ background: WA.verde, color: WA.fundo }}
        >
          <SendHorizontal aria-hidden="true" className="size-5" />
        </button>
      </form>
    </div>
  )
}
```

`apps/web/components/simulator/phone-frame.tsx`:
```tsx
'use client'
import { BatteryFull, SignalHigh, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'

function agora() {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date())
}

/** iPhone 17 (393×852 pt) a partir de md; tela cheia no celular. */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const [hora, setHora] = useState(agora)
  useEffect(() => { const t = setInterval(() => setHora(agora()), 30_000); return () => clearInterval(t) }, [])
  return (
    <div className="relative h-dvh w-full md:h-[852px] md:w-[393px] md:rounded-[55px] md:border-[12px] md:border-black md:shadow-2xl md:ring-1 md:ring-white/10 overflow-hidden">
      <div aria-hidden="true" className="hidden md:flex absolute inset-x-0 top-0 z-20 h-12 items-center justify-between px-7 text-[15px] font-semibold text-white">
        <span>{hora}</span>
        <span className="absolute left-1/2 top-2.5 h-[34px] w-[124px] -translate-x-1/2 rounded-full bg-black" />
        <span className="flex items-center gap-1.5"><SignalHigh className="size-4" /><Wifi className="size-4" /><BatteryFull className="size-5" /></span>
      </div>
      <div className="h-full md:pt-12 md:pb-6">{children}</div>
      <span aria-hidden="true" className="hidden md:block absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/80" />
    </div>
  )
}
```

`apps/web/components/simulator/use-local-simulator.ts`:
```ts
'use client'
import { useCallback, useState } from 'react'
import type { SimMessage } from './types'

const AVISO: SimMessage = { id: 'aviso-02a', de: 'sistema', tipo: 'aviso', texto: 'Simulação visual — as respostas da IA serão ligadas na próxima etapa (02-C).' }
const hora = () => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date())

export function useLocalSimulator() {
  const [mensagens, setMensagens] = useState<SimMessage[]>([AVISO])
  const enviar = useCallback((texto: string) => {
    const id = crypto.randomUUID()
    setMensagens((ms) => [...ms, { id, de: 'cliente', tipo: 'texto', texto, hora: hora(), status: 'enviando' }])
    setTimeout(() => setMensagens((ms) => ms.map((m) => (m.id === id && m.tipo === 'texto' ? { ...m, status: 'entregue' } : m))), 300)
  }, [])
  const escolher = useCallback((_mensagemId: string, _itemId: string, titulo: string) => enviar(titulo), [enviar])
  return { mensagens, digitando: false, enviar, escolher }
}
```

`apps/web/components/simulator/launcher.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PhoneFrame } from './phone-frame'
import { useLocalSimulator } from './use-local-simulator'
import { WhatsAppChat, WA } from './whatsapp-chat'
import { WhatsAppIcon } from './whatsapp-icon'

export function SimulatorLauncher({ restaurante }: { restaurante: string }) {
  const [aberto, setAberto] = useState(false)
  const sim = useLocalSimulator()
  return (
    <>
      <button
        type="button"
        aria-label="Abrir simulador de WhatsApp"
        onClick={() => setAberto(true)}
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex size-14 items-center justify-center rounded-full shadow-xl transition-transform duration-150 ease-out hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ background: WA.verde, color: WA.fundo }}
      >
        <WhatsAppIcon className="size-7" />
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent
          className="h-dvh max-h-dvh w-full max-w-none border-0 bg-transparent p-0 shadow-none md:h-auto md:w-auto md:max-w-fit"
          onOpenAutoFocus={(e) => {
            // foco direto no campo de mensagem (não no primeiro link/botão do histórico)
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input[aria-label="Mensagem"]')?.focus()
          }}
        >
          <DialogTitle className="sr-only">Simulador de WhatsApp</DialogTitle>
          <DialogDescription className="sr-only">Converse como se fosse um cliente. Nenhuma mensagem é enviada pelo WhatsApp de verdade.</DialogDescription>
          <PhoneFrame>
            <WhatsAppChat restaurante={restaurante} mensagens={sim.mensagens} digitando={sim.digitando} onEnviar={sim.enviar} onEscolher={sim.escolher} />
          </PhoneFrame>
        </DialogContent>
      </Dialog>
    </>
  )
}
```
(Se o `DialogContent` do shadcn trouxer um botão de fechar visível que conflite com a moldura, posicione-o fora da moldura no desktop e no topo da tela cheia no celular, mantendo `aria-label="Fechar"`.)

`apps/web/app/(painel)/layout.tsx` — buscar o nome do restaurante para o cabeçalho do simulador e encaixar o launcher:
```tsx
import { getSingleRestaurantId, schema } from '@atd/db'
import { eq } from 'drizzle-orm'
import { AppShell } from '@/components/shell/app-shell'
import { SimulatorLauncher } from '@/components/simulator/launcher'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()
  const db = getDb()
  const [r] = await db.select({ nome: schema.restaurants.nome }).from(schema.restaurants)
    .where(eq(schema.restaurants.id, await getSingleRestaurantId(db)))
  return <AppShell floating={<SimulatorLauncher restaurante={r?.nome ?? 'Restaurante'} />}>{children}</AppShell>
}
```

- [ ] **Step 3: Rodar, verificar e commitar**

Run: `pnpm vitest run apps/web/components/simulator && pnpm test:ui && pnpm lint && pnpm typecheck && pnpm --filter @atd/web build`
Expected: todos passam. Conferir manualmente (`pnpm --filter @atd/web dev`): no desktop a moldura aparece centralizada; com DevTools em 390px o simulador abre em tela cheia.

```bash
git add -A
git commit -m "Adiciona casca visual do simulador de WhatsApp com moldura de iPhone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Fechamento — E2E de celular, pendências da Etapa 01 e documentação

**Files:**
- Modify: `apps/web/playwright.config.ts` (projeto `celular`), `apps/web/e2e/auth.spec.ts`
- Create: `apps/web/e2e/painel.spec.ts`
- Modify: `apps/worker/src/jobs/process-conversation.db.test.ts` (caso adiado da Task 16 da Etapa 01)
- Modify: `docs/homologacao/etapa-01.md`, `docs/runbooks/deploy.md`, `PLAN.md`, `CLAUDE.md`, `AGENTS.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–12.

- [ ] **Step 1: Playwright com viewport de celular**

`apps/web/playwright.config.ts` — acrescentar `projects`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', locale: 'pt-BR' },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000/login', reuseExistingServer: true, timeout: 120_000 },
})
```

`apps/web/e2e/painel.spec.ts` (mesmos utilitários de criação de usuário do `auth.spec.ts` — extraia `criarMembro`/`entrar` para `apps/web/e2e/helpers.ts` e use nos dois arquivos):
```ts
import { expect, test } from '@playwright/test'
import { criarMembro, entrar, sql } from './helpers'

test.afterAll(async () => {
  await sql`delete from auth.users where email like '%@teste.local'`
})

test('tema: cookie claro chega na primeira resposta e a troca funciona', async ({ page, context }) => {
  await context.addCookies([{ name: 'atd-tema', value: 'claro', url: 'http://localhost:3000' }])
  const resp = await page.goto('/login')
  expect(await resp!.text()).toContain('data-theme="light"')
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await page.getByRole('link', { name: 'Mais' }).click()
  await page.getByText('Escuro', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('navegação inferior leva às 4 seções', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  for (const [link, titulo] of [['Unidades', 'Unidades'], ['Respostas', 'Respostas'], ['Mais', 'Mais'], ['Início', 'Início']] as const) {
    await page.getByRole('link', { name: link }).click()
    await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible()
  }
})

test('devolver à IA tira a conversa da fila', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  const [r] = await sql`select id from restaurants limit 1`
  const [c] = await sql`insert into customers (restaurant_id, wa_id_hash, telefone_cifrado, nome_perfil)
    values (${r!.id}, ${'e2e-' + Date.now()}, 'x', 'Cliente E2E') returning id`
  await sql`insert into conversations (restaurant_id, customer_id, estado) values (${r!.id}, ${c!.id}, 'aguardando_humano')`
  await entrar(page, email, senha)
  await page.getByRole('button', { name: 'Devolver à IA a conversa de Cliente E2E' }).click()
  await expect(page.getByText('Conversa devolvida à IA')).toBeVisible()
  const [conv] = await sql`select estado from conversations where customer_id = ${c!.id}`
  expect(conv!.estado).toBe('ia')
})

test('simulador abre em tela cheia no celular e mostra a mensagem enviada', async ({ page }) => {
  const { email, senha } = await criarMembro('atendente')
  await entrar(page, email, senha)
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  const dialog = page.getByRole('dialog', { name: 'Simulador de WhatsApp' })
  await expect(dialog).toBeVisible()
  await page.getByRole('textbox', { name: 'Mensagem' }).fill('abre domingo?')
  await page.keyboard.press('Enter')
  await expect(dialog.getByText('abre domingo?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('formulário: erro no campo certo e olho da senha', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByLabel('E-mail', { exact: true })).toBeFocused()
  await page.getByLabel('Senha', { exact: true }).fill('segredo123')
  await page.getByRole('button', { name: 'Mostrar senha' }).click()
  await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute('type', 'text')
})
```
Limpeza: o teste de "devolver à IA" apaga o cliente criado no fim (`delete from customers where nome_perfil = 'Cliente E2E'`).

- [ ] **Step 2: Caso adiado do worker (Etapa 01, Task 16)**

Em `apps/worker/src/jobs/process-conversation.db.test.ts`, acrescentar um caso usando os utilitários já existentes no arquivo (`setup`, `receive`, `fakeWa`, `deps` e o LLM falso): **primeira chamada** de triagem retorna `ok: false`, `retryable: true`, **com** `usage.costUsd = '0.000200'`; **segunda chamada lança** `new Error('falha de rede')`. Esperado: `processConversation` rejeita com o erro original; nos contadores de orçamento `reservado = '0.000000'` e `gasto = '0.000200'` (o gasto da primeira chamada é contabilizado pela compensação). Se o LLM falso atual não suportar "lançar na N-ésima chamada", estenda-o com um passo de script `'lancar'` (sem mudar os casos existentes).

- [ ] **Step 3: Pendências de documentação da Etapa 01**

- `docs/homologacao/etapa-01.md`, passo 9: o caminho principal passa a ser o **convite real** (`/auth/confirm` → "Crie sua senha"); a alternativa pela Admin API fica como plano B e usa `updateUserById(id, { password, email_confirm: true })`.
- `docs/runbooks/deploy.md`:
  - em **Release regular**: desligar o deploy automático de produção da `main` na Vercel (Project → Settings → Environments → Production: desativar "Auto-assign Custom Production Domains", ou usar Ignored Build Step para `main`); produção só por **Promote** depois da migration;
  - em **Supabase** (produção e staging): Site URL = domínio do painel; Redirect URLs incluindo `https://<domínio>/auth/confirm`; **Email Templates → Invite user** com o mesmo HTML de `supabase/templates/invite.html`.

- [ ] **Step 4: Verificação completa**

Run: `pnpm db:migrate && pnpm check && pnpm --filter @atd/web e2e`
Expected: lint, typecheck, unit + db + ui verdes, build OK, E2E (projeto `celular`) verdes. Anotar as contagens.

- [ ] **Step 5: PLAN e "Onde paramos"**

- `PLAN.md`, Etapa 02: marcar `[x] Plano 02-A` com data e intervalo de commits; nas pendências da Etapa 01, marcar as duas de documentação e a "página para definir senha".
- "Onde paramos" em `PLAN.md` e `CLAUDE.md` (próximo: plano 02-B); `cp CLAUDE.md AGENTS.md`.

```bash
git add -A
git commit -m "Fecha o plano 02-A com E2E de celular e pendências da Etapa 01

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
