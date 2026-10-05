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
