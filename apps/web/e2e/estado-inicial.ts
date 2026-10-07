import { closeSql, getSql } from './helpers'

/**
 * Setup global do e2e: as specs contam com o modo demonstração desligado (isolamento do simulador). Guarda o valor de
 * cada restaurante, desliga para a suíte e devolve o teardown que restaura exatamente o estado inicial — quem deixou o
 * modo ligado no banco local (homologação, demonstração) o encontra ligado depois do e2e.
 */
export default async function estadoInicial() {
  const sql = getSql()
  const antes = await sql<{ id: string; modo_demonstracao: boolean }[]>`select id, modo_demonstracao from restaurants`
  await sql`update restaurants set modo_demonstracao = false where modo_demonstracao`
  await closeSql()
  return async () => {
    const s = getSql()
    for (const r of antes) await s`update restaurants set modo_demonstracao = ${r.modo_demonstracao} where id = ${r.id}`
    await closeSql()
  }
}
