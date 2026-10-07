import type { DataIso } from '@atd/core/s1'
import { rotuloTipoEvento, type TipoEvento } from '@atd/core/s3'
import type { DadoRetencao, PedidoTitular, ResumoTitular, StatusDsr, StatusPedido, TipoDsr } from '@atd/db'
import { ROTULO_STATUS } from '@/lib/eventos'
import { dataBr } from '@/lib/previsao'

const DIA_MS = 86_400_000
/** Alerta quando faltarem 3 dias ou menos (spec §4). */
export const DIAS_ALERTA_PRAZO = 3

export const ROTULO_TIPO_DSR: Record<TipoDsr, string> = {
  acesso: 'Acesso aos dados',
  exclusao: 'Exclusão dos dados',
  correcao: 'Correção dos dados',
}

export const ROTULO_STATUS_DSR: Record<StatusDsr, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  negado: 'Negado',
}

export const ROTULO_DADO_RETENCAO: Record<DadoRetencao, { titulo: string; descricao: string }> = {
  messages: { titulo: 'Mensagens das conversas', descricao: 'Apagadas depois do prazo.' },
  attendance_notices: { titulo: 'Avisos de presença', descricao: 'Anonimizados depois do prazo (conta a data do aviso).' },
  event_requests: { titulo: 'Pedidos de evento', descricao: 'Anonimizados depois do prazo (conta a data do evento).' },
  ai_runs: { titulo: 'Registros de uso da IA', descricao: 'Apagados depois do prazo.' },
  customers_inativos: { titulo: 'Clientes sem contato', descricao: 'Apagados depois do prazo sem nenhuma interação.' },
  audit_log: { titulo: 'Registro de auditoria', descricao: 'Apagado depois do prazo.' },
}

export const STATUS_EM_ABERTO: readonly StatusDsr[] = ['aberto', 'em_andamento']
export const emAberto = (s: StatusDsr) => STATUS_EM_ABERTO.includes(s)

export type SituacaoPrazo = 'ok' | 'perto' | 'vencido' | 'resolvido'

export function situacaoPrazo(p: Pick<PedidoTitular, 'prazo' | 'status'>, agora: Date): SituacaoPrazo {
  if (!emAberto(p.status)) return 'resolvido'
  const ms = p.prazo.getTime() - agora.getTime()
  if (ms < 0) return 'vencido'
  return Math.ceil(ms / DIA_MS) <= DIAS_ALERTA_PRAZO ? 'perto' : 'ok'
}

/** "Faltam 3 dias", "Falta 1 dia", "Prazo vencido", "Prazo vencido há 2 dias". */
export function textoPrazo(p: Pick<PedidoTitular, 'prazo'>, agora: Date): string {
  const ms = p.prazo.getTime() - agora.getTime()
  if (ms < 0) {
    const dias = Math.floor(-ms / DIA_MS)
    return dias === 0 ? 'Prazo vencido' : `Prazo vencido há ${dias} ${dias === 1 ? 'dia' : 'dias'}`
  }
  const dias = Math.max(1, Math.ceil(ms / DIA_MS))
  return dias === 1 ? 'Falta 1 dia' : `Faltam ${dias} dias`
}

/** Pedidos em aberto perto do prazo (≤ 3 dias) ou vencidos — o alerta do Início. */
export function contarPrazoLgpd(pedidos: readonly Pick<PedidoTitular, 'prazo' | 'status'>[], agora: Date): { perto: number; vencidos: number } {
  let perto = 0
  let vencidos = 0
  for (const p of pedidos) {
    const s = situacaoPrazo(p, agora)
    if (s === 'perto') perto++
    else if (s === 'vencido') vencidos++
  }
  return { perto, vencidos }
}

function dataNoFuso(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

const ROTULO_STATUS_AVISO: Record<string, string> = { confirmada: 'Confirmada', cancelada: 'Cancelada', nao_veio: 'Não veio' }
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** Texto entregue ao titular (copiar/baixar). Nunca inclui telefone nem notas internas. */
export function textoResumo(r: ResumoTitular, timeZone: string): string {
  const linhas = [
    'Resumo dos seus dados pessoais',
    '',
    `Nome no WhatsApp: ${r.nomePerfil?.trim() || 'não informado'}`,
    `Primeira interação: ${dataNoFuso(r.primeiraInteracao, timeZone)}`,
    `Última interação: ${dataNoFuso(r.ultimaInteracao, timeZone)}`,
    `Conversas: ${r.conversas}`,
    `Mensagens: ${r.mensagens}`,
    '',
  ]
  if (r.avisos.length === 0) linhas.push('Avisos de presença: nenhum')
  else {
    linhas.push('Avisos de presença:')
    for (const a of r.avisos) {
      linhas.push(`- ${dataBr(a.data as DataIso)} · ${a.unidade} · ${plural(a.pessoas, 'pessoa', 'pessoas')} · ${ROTULO_STATUS_AVISO[a.status] ?? a.status}`)
    }
  }
  linhas.push('')
  if (r.eventos.length === 0) linhas.push('Pedidos de evento: nenhum')
  else {
    linhas.push('Pedidos de evento:')
    for (const e of r.eventos) {
      const tipo = maiuscula(rotuloTipoEvento(e.tipo as TipoEvento, null))
      const status = ROTULO_STATUS[e.status as StatusPedido] ?? e.status
      linhas.push(`- ${dataBr(e.data as DataIso)} · ${e.unidade} · ${tipo} · ${plural(e.convidados, 'convidado', 'convidados')} · ${status}`)
    }
  }
  linhas.push('')
  if (r.pedidos.length === 0) linhas.push('Pedidos sobre seus dados: nenhum')
  else {
    linhas.push('Pedidos sobre seus dados:')
    for (const p of r.pedidos) linhas.push(`- ${ROTULO_TIPO_DSR[p.tipo]} · ${ROTULO_STATUS_DSR[p.status]} · ${dataNoFuso(p.criadoEm, timeZone)}`)
  }
  return linhas.join('\n') + '\n'
}

/** Nome do .txt sem dado pessoal: `resumo-de-dados-AAAA-MM-DD.txt` no fuso do restaurante. */
export function nomeArquivoResumo(agora: Date, timeZone: string): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora)
  return `resumo-de-dados-${dia}.txt`
}
