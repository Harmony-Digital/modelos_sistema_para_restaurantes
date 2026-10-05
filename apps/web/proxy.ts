import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { copySessionTo } from './lib/session-copy.ts'

const PUBLIC_PATHS = ['/login', '/privacidade']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v))
        },
      },
    },
  )
  // Não colocar código entre createServerClient e getClaims (doc do Supabase).
  let hasSession = false
  try {
    const { data } = await supabase.auth.getClaims()
    hasSession = Boolean(data?.claims)
  } catch {
    hasSession = false
  }
  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))
  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Preserva cookies/cabeçalhos de sessão renovados por setAll.
    return copySessionTo(NextResponse.redirect(url), response)
  }
  return response
}

export const config = {
  // O webhook da Meta não passa pelo proxy (não tem sessão; é autenticado por HMAC).
  matcher: ['/((?!api/whatsapp/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
