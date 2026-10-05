import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { DM_Sans, JetBrains_Mono, Sora } from 'next/font/google'
import { dataThemeFor, parseTema, THEME_COOKIE, themeColorFor } from '@/lib/theme'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const sora = Sora({ subsets: ['latin'], display: 'swap', variable: '--font-sora' })
const dmSans = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-dm-sans' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-jetbrains' })

export const metadata: Metadata = { title: 'Atendimento IA', robots: { index: false, follow: false } }
export async function generateViewport(): Promise<Viewport> {
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: themeColorFor(tema) }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="pt-BR" data-theme={dataThemeFor(tema)} className={`${sora.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">{children}
        <Toaster position="top-center" theme={tema === 'claro' ? 'light' : 'dark'} richColors closeButton />
      </body>
    </html>
  )
}
