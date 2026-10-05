import type { NextResponse } from 'next/server'

/** Copia cookies de sessão e cabeçalhos (exceto set-cookie e x-middleware-*) de `from` para `to`. */
export function copySessionTo(to: NextResponse, from: NextResponse) {
  from.cookies.getAll().forEach((c) => to.cookies.set(c))
  from.headers.forEach((v, k) => {
    // set-cookie já foi copiado pela API de cookies; .set() sobrescreveria e deixaria só o último.
    if (k === 'set-cookie' || k.startsWith('x-middleware-')) return
    to.headers.set(k, v)
  })
  return to
}
