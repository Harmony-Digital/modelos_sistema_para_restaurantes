export function AuthCard(props: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 font-display text-lg font-semibold text-foreground">
          Atendimento <span className="text-link">IA</span>
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
