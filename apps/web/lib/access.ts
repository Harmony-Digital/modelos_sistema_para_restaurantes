export type StaffRole = 'dono' | 'gerente' | 'atendente'

export function resolveAccess(role: StaffRole | null, aal: string | undefined): 'ok' | 'mfa' | 'forbidden' {
  if (!role) return 'forbidden'
  if (role !== 'atendente' && aal !== 'aal2') return 'mfa'
  return 'ok'
}
