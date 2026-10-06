import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PgBoss } from 'pg-boss'
import { createBoss, enqueueIngest, QUEUES } from './queue.ts'
import { getTestBoss, getTestDb, resetDb, WEB_URL } from './test-utils.ts'

const { sql } = getTestDb()
let boss: PgBoss
beforeAll(async () => { boss = await getTestBoss() })
beforeEach(() => resetDb(sql))
afterAll(async () => { await boss.stop({ graceful: false }); await sql.end() })

const jobs = () => sql<{ singleton_key: string; data: { importacaoId: string } }[]>`
  select singleton_key, data from pgboss.job where name = ${QUEUES.ingest}`

describe('fila document.ingest', () => {
  it('a fila e a DLQ existem; enfileirar a mesma importação duas vezes deixa um job só', async () => {
    const id = randomUUID()
    await enqueueIngest(boss)(id)
    await enqueueIngest(boss)(id)
    expect(await jobs()).toEqual([{ singleton_key: id, data: { importacaoId: id } }])
    const filas = await sql<{ name: string; dead_letter: string | null }[]>`
      select name, dead_letter from pgboss.queue where name in (${QUEUES.ingest}, ${QUEUES.ingestDlq}) order by name`
    expect(filas).toEqual([
      { name: QUEUES.ingest, dead_letter: QUEUES.ingestDlq },
      { name: QUEUES.ingestDlq, dead_letter: null },
    ])
  })

  it('o web (web_app) consegue enfileirar', async () => {
    const web = createBoss(WEB_URL, 'web')
    await web.start()
    try {
      await enqueueIngest(web)(randomUUID())
      expect(await jobs()).toHaveLength(1)
    } finally {
      await web.stop({ graceful: false })
    }
  })
})
