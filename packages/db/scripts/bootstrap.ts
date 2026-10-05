import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { addStaff, bootstrapRestaurant, createDb } from '../src/index.ts'

const { values } = parseArgs({
  options: {
    restaurante: { type: 'string' },
    dono: { type: 'string' },
    'nome-dono': { type: 'string' },
    politica: { type: 'string' },
  },
})
if (!values.restaurante || !values.dono || !values['nome-dono']) {
  throw new Error('Uso: bootstrap --restaurante "Nome" --dono email --nome-dono "Nome" [--politica URL]')
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey || !process.env.DATABASE_URL) {
  throw new Error('Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e DATABASE_URL (conexão de administrador)')
}

const { db, sql } = createDb(process.env.DATABASE_URL)
const restaurantId = await bootstrapRestaurant(db, {
  nome: values.restaurante,
  ...(values.politica ? { politicaUrl: values.politica } : {}),
})

const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.inviteUserByEmail(values.dono)
if (error) throw error
await addStaff(db, { userId: data.user.id, restaurantId, nome: values['nome-dono'], papel: 'dono' })
await sql.end()
process.stdout.write(`Restaurante ${restaurantId} pronto; convite enviado para o dono.\n`)
