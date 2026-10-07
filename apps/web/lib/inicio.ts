import { rotuloTipoEvento } from '@atd/core/s3'
import type { ImportacaoPainel, PedidoPainel, PrevisaoUnidade, StatusPedido } from '@atd/db'

export function percentual(respondidos: number, validos: number): string {
  if (validos <= 0) return '—'
  return `${Math.round((100 * respondidos) / validos)}%`
}

const dois = (n: number) => String(n).padStart(2, '0')

/** Espera ao vivo: "mm:ss"; de uma hora em diante "h:mm:ss". */
export function cronometro(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const resto = s % 60
  return h > 0 ? `${h}:${dois(m)}:${dois(resto)}` : `${dois(m)}:${dois(resto)}`
}

/** Pontos do mini-gráfico (`polyline`) numa caixa largura × altura; y cresce para baixo. Série constante fica no chão. */
export function pontosDoGrafico(valores: readonly number[], largura: number, altura: number): string {
  if (valores.length === 0) return ''
  const serie = valores.length === 1 ? [valores[0]!, valores[0]!] : valores
  const min = Math.min(...serie)
  const faixa = Math.max(...serie) - min
  const passo = largura / (serie.length - 1)
  const arred = (n: number) => Math.round(n * 100) / 100
  return serie.map((v, i) => `${arred(i * passo)},${arred(faixa === 0 ? altura : altura - ((v - min) / faixa) * altura)}`).join(' ')
}

/** Agenda do dia, filtrada por unidade (formato da Agenda única, decisão 4 do plano). */
export const hrefAvisosDoDia = (dia: string, unitId: string) => `/agenda?dia=${dia}&unidade=${encodeURIComponent(unitId)}`
/** Pedido de evento aberto ao lado na Agenda do dia dele. */
export const hrefPedido = (p: { id: string; data: string }) => `/agenda?dia=${p.data}&pedido=${encodeURIComponent(p.id)}`

export type LinhaAgendaHoje =
  | { tipo: 'aviso'; id: string; hora: string | null; titulo: string; detalhe: string; unidade: string; simulado: boolean; href: string }
  | { tipo: 'evento'; id: string; hora: null; titulo: string; detalhe: string; unidade: string; simulado: boolean; href: string; status: StatusPedido }

const STATUS_ATIVOS: readonly StatusPedido[] = ['novo', 'em_contato', 'confirmado']
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "20:00", "20h", "12h30", "por volta das 19h" ⇒ minutos do dia; sem horário legível ⇒ null. */
function minutosDe(horario: string | null): number | null {
  const m = horario?.match(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  return h < 24 && min < 60 ? h * 60 + min : null
}

/**
 * Agenda de hoje do Início: avisos de presença ativos (por horário; sem horário depois) e, em seguida, pedidos de
 * evento do dia que ainda valem (novo, em contato, confirmado). Cada linha leva à Agenda já no item.
 */
export function agendaDeHoje(previsao: readonly PrevisaoUnidade[], pedidos: readonly PedidoPainel[], hoje: string): LinhaAgendaHoje[] {
  const avisos = previsao.flatMap((u) => u.avisos
    .filter((a) => a.status === 'confirmada')
    .map((a) => ({
      tipo: 'aviso' as const, id: a.id, hora: a.horarioAprox, titulo: a.pessoas === 1 ? '1 pessoa' : `${a.pessoas} pessoas`,
      detalhe: a.nome ?? 'Sem nome', unidade: u.unidade, simulado: a.simulado, href: hrefAvisosDoDia(hoje, u.unitId),
      ordem: minutosDe(a.horarioAprox) ?? Number.MAX_SAFE_INTEGER,
    })))
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ ordem: _ordem, ...linha }) => linha)
  const eventos = pedidos
    .filter((p) => p.data === hoje && STATUS_ATIVOS.includes(p.status))
    .map((p) => ({
      tipo: 'evento' as const, id: p.id, hora: null, status: p.status,
      titulo: `${maiuscula(rotuloTipoEvento(p.tipo, p.tipoTexto))} · ${p.convidados} convidados`,
      detalhe: p.nome ?? 'Sem nome', unidade: p.unidade, simulado: p.simulado, href: hrefPedido(p),
    }))
  return [...avisos, ...eventos]
}

/** A tela de leitura desiste depois de 10 min sem nenhuma mudança salva: daí em diante a importação está parada. */
const PARADA_MS = 10 * 60_000

/** Importações lendo (enviado/processando, já sem receber arquivos) sem mudança há mais de 10 min. */
export function importacoesParadas<T extends Pick<ImportacaoPainel, 'status' | 'recebendo' | 'atualizadoEm'>>(lista: readonly T[], agora: Date): T[] {
  return lista.filter((i) =>
    (i.status === 'enviado' || i.status === 'processando') && !i.recebendo && agora.getTime() - new Date(i.atualizadoEm).getTime() > PARADA_MS)
}
