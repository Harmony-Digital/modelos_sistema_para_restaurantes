import { LogoRestaurante } from '@/components/shell/logo-restaurante'

export type MarcaLogin = { nome: string; logo: string }

/** `marca`: logo e nome do restaurante (login com um único restaurante); sem ela, o título padrão de sempre. */
export function AuthCard(props: { title: string; description?: string; marca?: MarcaLogin | null; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        {props.marca ? (
          <p className="mb-8 flex min-w-0 items-center gap-2 font-display text-lg font-semibold text-foreground">
            <LogoRestaurante url={props.marca.logo} nome={props.marca.nome} decorativa />
            <span className="min-w-0 truncate">{props.marca.nome}</span>
          </p>
        ) : (
          <p className="mb-8 font-display text-lg font-semibold text-foreground">
            Atendimento <span className="text-link">IA</span>
          </p>
        )}
        <div className="rounded-lg border border-border bg-card p-6 shadow-xl">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{props.title}</h1>
          {props.description && <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>}
          <div className="mt-6">{props.children}</div>
        </div>
      </div>
    </main>
  )
}
