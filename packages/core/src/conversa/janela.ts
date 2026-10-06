/** Janela de 24 h do WhatsApp: resposta livre só enquanto `window_expires_at > now()` (o limite exato já está fora). */
export function dentroDaJanela(janelaAte: Date | null, agora: Date): boolean {
  return janelaAte !== null && janelaAte.getTime() > agora.getTime()
}
