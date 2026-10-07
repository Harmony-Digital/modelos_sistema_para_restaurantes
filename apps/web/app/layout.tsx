import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { dataThemeFor, parseTema, THEME_COOKIE, themeColorFor } from '@/lib/theme'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-plex-sans' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['500', '600'], display: 'swap', variable: '--font-plex-mono' })

export const metadata: Metadata = { title: 'Atendimento IA', robots: { index: false, follow: false } }
export async function generateViewport(): Promise<Viewport> {
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return { width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content', themeColor: themeColorFor(tema) }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <html lang="pt-BR" data-theme={dataThemeFor(tema)} className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh">{children}
        <Toaster position="top-center" theme={tema === 'claro' ? 'light' : 'dark'} richColors closeButton />
      </body>
    </html>
  )
}
