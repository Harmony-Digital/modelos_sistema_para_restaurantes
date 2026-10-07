import {
  BookOpen, CalendarDays, FlaskConical, House, MessagesSquare, Settings, ShieldCheck, Store, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import type { StaffRole } from './access.ts'

/** Um destino do painel: rota (`href`) ou ação (`acao`, ex.: abrir o simulador sem sair da tela). */
export type ItemNav = {
  id: string
  rotulo: string
  icone: LucideIcon
  href?: string
  acao?: 'simulador'
  /** Sem `papeis`: todos os papéis veem. As páginas continuam conferindo o papel na DAL. */
  papeis?: readonly StaffRole[]
  contador?: 'aguardando'
  /** Outros termos que levam a esta tela na busca rápida (Ctrl+K). */
  palavras?: readonly string[]
}
export type GrupoNav = { id: string; rotulo: string | null; itens: ItemNav[] }

const GESTAO: readonly StaffRole[] = ['dono', 'gerente']
/** O simulador gasta IA real: quem pode abrir (o layout monta o lançador com esta mesma regra). */
export const PAPEIS_SIMULADOR: readonly StaffRole[] = ['dono', 'gerente']

/** Fonte única do menu lateral (≥ lg) e da barra inferior (< lg). */
export const GRUPOS_NAV: readonly GrupoNav[] = [
  { id: 'inicio', rotulo: null, itens: [{ id: 'inicio', rotulo: 'Início', href: '/', icone: House }] },
  {
    id: 'atendimento',
    rotulo: 'Atendimento',
    itens: [
      { id: 'conversas', rotulo: 'Conversas', href: '/conversas', icone: MessagesSquare, contador: 'aguardando' },
      { id: 'agenda', rotulo: 'Agenda', href: '/agenda', icone: CalendarDays, palavras: ['Reservas', 'Eventos'] },
      { id: 'simulador', rotulo: 'Simulador', acao: 'simulador', icone: FlaskConical, papeis: PAPEIS_SIMULADOR },
    ],
  },
  {
    id: 'restaurante',
    rotulo: 'Restaurante',
    itens: [
      { id: 'conteudo', rotulo: 'Conteúdo', href: '/conteudo', icone: BookOpen },
      { id: 'unidades', rotulo: 'Unidades', href: '/unidades', icone: Store },
    ],
  },
  {
    id: 'gestao',
    rotulo: 'Gestão',
    itens: [
      { id: 'gastos', rotulo: 'Gastos', href: '/gestao/gastos', icone: Wallet, papeis: GESTAO },
      { id: 'equipe', rotulo: 'Equipe', href: '/gestao/equipe', icone: Users, papeis: GESTAO },
      { id: 'privacidade', rotulo: 'Privacidade', href: '/gestao/privacidade', icone: ShieldCheck, papeis: GESTAO },
      // tema e conta valem para todos; restaurante e horário humano aparecem conforme o papel dentro da página
      { id: 'ajustes', rotulo: 'Ajustes', href: '/ajustes', icone: Settings },
    ],
  },
]

const pode = (papel: StaffRole) => (i: ItemNav) => !i.papeis || i.papeis.includes(papel)

/** Grupos visíveis para o papel (grupo sem item visível some). */
export function gruposDoMenu(papel: StaffRole): GrupoNav[] {
  return GRUPOS_NAV.map((g) => ({ ...g, itens: g.itens.filter(pode(papel)) })).filter((g) => g.itens.length > 0)
}

const PRINCIPAIS = ['inicio', 'conversas', 'agenda', 'conteudo'] as const

/** Barra inferior (< lg): 4 destinos fixos; o restante vai para a folha "Mais". */
export function navegacaoInferior(papel: StaffRole): { principais: ItemNav[]; mais: ItemNav[] } {
  const itens = gruposDoMenu(papel).flatMap((g) => g.itens)
  return {
    principais: PRINCIPAIS.map((id) => itens.find((i) => i.id === id)).filter((i): i is ItemNav => Boolean(i)),
    mais: itens.filter((i) => !(PRINCIPAIS as readonly string[]).includes(i.id)),
  }
}

/** Início só na raiz; os demais também nas subpáginas (sem confundir `/conversasX`). */
export function itemAtivo(caminho: string, href: string): boolean {
  return href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(href + '/')
}
