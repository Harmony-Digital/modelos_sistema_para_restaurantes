import { describe, expect, it } from 'vitest'
import { workersQueBloqueiam } from './worker'

describe('guarda do worker do e2e', () => {
  it('ignora o heartbeat do teste de banco do worker (worker-teste); outro worker bloqueia', () => {
    expect(workersQueBloqueiam([{ worker_id: 'worker-teste' }])).toEqual([])
    expect(workersQueBloqueiam([{ worker_id: 'worker-teste' }, { worker_id: 'vps-1234' }])).toEqual(['vps-1234'])
  })
})
