import { describe, expect, it } from 'vitest'
import { ehLinkCurtoMaps, ehLinkGoogleMaps, extrairCoordenadas } from './mapas.ts'

describe('link do Google Maps', () => {
  it('extrai do pino, do @ e dos parâmetros', () => {
    expect(extrairCoordenadas('https://www.google.com/maps/place/Casa/@-15.8100,-47.8900,17z/data=!3d-15.8136123!4d-47.8960456'))
      .toEqual({ lat: -15.813612, lng: -47.896046 })
    expect(extrairCoordenadas('https://www.google.com.br/maps/@-15.8136,-47.896,17z')).toEqual({ lat: -15.8136, lng: -47.896 })
    expect(extrairCoordenadas('https://maps.google.com/?q=-15.78,-47.88')).toEqual({ lat: -15.78, lng: -47.88 })
    expect(extrairCoordenadas('https://www.google.com/maps/search/?api=1&query=-15.78%2C-47.88')).toEqual({ lat: -15.78, lng: -47.88 })
  })
  it('recusa host de fora, http, fora da faixa e link sem coordenada', () => {
    expect(extrairCoordenadas('https://evil.com/maps/@-15.8,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('http://www.google.com/maps/@-15.8,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/maps/@95.0,-47.8,17z')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/maps/place/Casa+Harmonia')).toBeNull()
    expect(extrairCoordenadas('https://www.google.com/search?q=-15.8,-47.8')).toBeNull()
    expect(extrairCoordenadas('não é link')).toBeNull()
  })
  it('link curto é reconhecido mas não lido sem rede', () => {
    expect(ehLinkCurtoMaps('https://maps.app.goo.gl/AbCd123')).toBe(true)
    expect(ehLinkCurtoMaps('https://goo.gl/maps/AbCd123')).toBe(true)
    expect(ehLinkCurtoMaps('https://goo.gl/outra-coisa')).toBe(false)
    expect(ehLinkGoogleMaps('https://maps.app.goo.gl/AbCd123')).toBe(true)
    expect(extrairCoordenadas('https://maps.app.goo.gl/AbCd123')).toBeNull()
    expect(ehLinkGoogleMaps('https://www.google.com/search?q=x')).toBe(false)
  })
})
