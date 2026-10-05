import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'Atendimento IA', robots: { index: false, follow: false } }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  )
}
