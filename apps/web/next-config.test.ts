import { describe, expect, it } from 'vitest'
import config from './next.config'

describe('next.config', () => {
  it('upload de até 20 MB passa pelo proxy e pela Server Action (os dois limites)', () => {
    // proxy.ts cobre /conteudo: sem proxyClientMaxBodySize o corpo é cortado em 10 MB (padrão do Next 16)
    expect(config.experimental?.proxyClientMaxBodySize).toBe('21mb')
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe('21mb')
  })
})
