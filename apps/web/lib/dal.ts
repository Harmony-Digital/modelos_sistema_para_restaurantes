import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getStaffContext, type JwtClaims } from '@atd/db'
import { resolveAccess, type StaffRole } from './access.ts'
import { getDb } from './server/db.ts'
import { createClient } from './supabase/server.ts'

export const requireStaff = cache(async (roles?: StaffRole[]) => {
  const supabase = await createClient()
  let c: { sub?: string; aal?: string; session_id?: string; exp?: number } | undefined
  try {
    const { data } = await supabase.auth.getClaims()
    c = data?.claims
  } catch {
    c = undefined
  }
  if (!c?.sub) redirect('/login')

  const claims: JwtClaims = {
    sub: c.sub,
    role: 'authenticated',
    aal: c.aal === 'aal2' ? 'aal2' : 'aal1',
    session_id: c.session_id,
    exp: c.exp,
  }
  const staff = await getStaffContext(getDb(), claims)
  const access = resolveAccess(staff?.role ?? null, claims.aal)
  if (access === 'forbidden' || !staff) redirect('/login?erro=sem-acesso')
  if (access === 'mfa') redirect('/mfa')
  if (roles && !roles.includes(staff.role)) redirect('/?erro=permissao')
  return { userId: c.sub, role: staff.role, restaurantId: staff.restaurantId, claims }
})
