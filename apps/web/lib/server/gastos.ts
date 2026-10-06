import 'server-only'
import { cache } from 'react'
import { resumoGastos, type JwtClaims } from '@atd/db'
import { getDb } from './db.ts'

/**
 * `resumoGastos` uma vez por request: o layout (faixa de alerta) e o Início (cartões) pedem o mesmo resumo. A chave do
 * cache é o objeto `claims` de `requireStaff()` (também em cache por request).
 */
export const resumoGastosDoRequest = cache((claims: JwtClaims) => resumoGastos(getDb(), claims, new Date()))
