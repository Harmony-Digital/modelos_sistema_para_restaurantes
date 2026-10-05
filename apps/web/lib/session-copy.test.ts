import { NextResponse } from 'next/server'
import { describe, expect, it } from 'vitest'
import { copySessionTo } from './session-copy.ts'

describe('copySessionTo', () => {
  it('preserva todos os cookies (ex.: token em partes) e cabeçalhos de cache', () => {
    const from = NextResponse.next()
    from.cookies.set('sb-x-auth-token.0', 'a')
    from.cookies.set('sb-x-auth-token.1', 'b')
    from.headers.set('cache-control', 'private, no-store')
    const to = copySessionTo(NextResponse.redirect('http://localhost/login'), from)
    expect(to.cookies.getAll().map((c) => c.name).sort()).toEqual(['sb-x-auth-token.0', 'sb-x-auth-token.1'])
    expect(to.headers.getSetCookie()).toHaveLength(2)
    expect(to.headers.get('cache-control')).toBe('private, no-store')
    expect(to.headers.get('x-middleware-next')).toBeNull()
  })
})
