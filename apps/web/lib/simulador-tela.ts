import { z } from 'zod'
import { agoraLocal, dataValida, diaDaSemana, partesDaData } from '@atd/core/s1'
import type { SimMessage } from '@/components/simulator/types'

export type MensagemTela = {
  id: number
  direcao: 'in' | 'out'
  tipo: 'texto' | 'audio' | 'imagem' | 'documento' | 'localizacao' | 'lista' | 'outro'
  texto: string | null
  payload: unknown
  criadaEm: string
}
export type RespostaSimulador = {
  conversationId: string
  mensagens: MensagemTela[]
  cursor: number
  digitando: boolean
  estado: 'ia' | 'aguardando_humano' | 'humano' | 'encerrada'
  relogioOffsetSegundos: number | null
}
export type DetalheTela = {
  id: number; etapa: string; modelo: string; promptVersion: string; intent: string | null
  resultado: string | null; erro: string | null; costUsd: string; latenciaMs: number | null
  itensValidos: number | null; itensRespondidos: number | null; criadaEm: string
}

export const AVISO_SIMULACAO: SimMessage = {
  id: 'aviso-simulacao', de: 'sistema', tipo: 'aviso',
  texto: 'Simulação: as respostas passam pela IA de verdade (com custo) e nunca são enviadas pelo WhatsApp.',
}
/** O relógio simulado vai até um ano para trás ou para a frente. */
export const MAX_DESLOCAMENTO_SEGUNDOS = 366 * 86_400

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'] as const
const dois = (n: number) => String(n).padStart(2, '0')
const hhmm = (minuto: number) => `${dois(Math.floor(minuto / 60))}:${dois(minuto % 60)}`
// mesmos cortes que o cliente da Meta aplica (packages/whatsapp/src/client.ts)
const cortar = (t: string, max: number) => (t.length <= max ? t : t.slice(0, max))

const lista = z.object({
  botao: z.string(),
  opcoes: z.array(z.object({ id: z.string(), titulo: z.string(), descricao: z.string() })).min(1),
})
const localizacao = z.object({ lat: z.number(), lng: z.number(), nome: z.string(), endereco: z.string() })

function horaDe(criadaEm: string, timezone: string, offsetSegundos: number | null) {
  const instante = new Date(Date.parse(criadaEm) + (offsetSegundos ?? 0) * 1000)
  return hhmm(agoraLocal(instante, timezone).minuto)
}

export function paraSimMessage(m: MensagemTela, timezone: string, offsetSegundos: number | null): SimMessage {
  const id = String(m.id)
  const hora = horaDe(m.criadaEm, timezone, offsetSegundos)
  const texto = m.texto ?? ''
  if (m.direcao === 'in') return { id, de: 'cliente', tipo: 'texto', texto, hora, status: 'lida' }
  if (m.tipo === 'lista') {
    const p = lista.safeParse(m.payload)
    if (p.success) {
      return {
        id, de: 'restaurante', tipo: 'lista', texto: cortar(texto, 1024), botao: cortar(p.data.botao, 20), hora,
        secoes: [{
          titulo: 'Unidades',
          itens: p.data.opcoes.slice(0, 10).map((o) => ({ id: o.id, titulo: cortar(o.titulo, 24), descricao: cortar(o.descricao, 72) })),
        }],
      }
    }
  }
  if (m.tipo === 'localizacao') {
    const p = localizacao.safeParse(m.payload)
    if (p.success) return { id, de: 'restaurante', tipo: 'localizacao', ...p.data, hora }
  }
  return { id, de: 'restaurante', tipo: 'texto', texto, hora }
}

export function avisoDoEstado(estado: RespostaSimulador['estado']): SimMessage | null {
  if (estado === 'aguardando_humano' || estado === 'humano') {
    return {
      id: 'aviso-estado', de: 'sistema', tipo: 'aviso',
      texto: 'Esta conversa foi passada para um atendente. No WhatsApp real, a equipe continuaria por aqui. Toque em "Novo cliente" para recomeçar.',
    }
  }
  if (estado === 'encerrada') {
    return { id: 'aviso-estado', de: 'sistema', tipo: 'aviso', texto: 'Esta conversa foi encerrada. Toque em "Novo cliente" para recomeçar.' }
  }
  return null
}

function diferencaDoFuso(instante: number, timezone: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(instante)).map((p) => [p.type, p.value]),
  )
  return Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute)) - instante
}

/** "2026-10-11T12:00" (campo datetime-local) no fuso do restaurante → instante; null se a data não existe. */
export function instanteDoHorarioLocal(local: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number) as [number, number, number, number, number]
  if (!dataValida(ano, mes, dia) || hora > 23 || minuto > 59) return null
  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto)
  // duas passadas acertam a diferença do fuso mesmo perto de mudança de horário de verão
  let t = alvo
  for (let i = 0; i < 2; i++) t = alvo - diferencaDoFuso(t, timezone)
  return new Date(t)
}

/** Instante → valor do campo datetime-local, no fuso do restaurante. */
export function horarioLocal(instante: Date, timezone: string): string {
  const { data, minuto } = agoraLocal(instante, timezone)
  return `${data}T${hhmm(minuto)}`
}

export function rotuloRelogio(offsetSegundos: number | null, timezone: string, agora: Date): string | null {
  if (offsetSegundos === null) return null
  const { data, minuto } = agoraLocal(new Date(agora.getTime() + offsetSegundos * 1000), timezone)
  const { ano, mes, dia } = partesDaData(data)
  return `Relógio simulado: ${DIAS[diaDaSemana(data)]}, ${dois(dia)}/${dois(mes)}/${ano} ${hhmm(minuto)}`
}
