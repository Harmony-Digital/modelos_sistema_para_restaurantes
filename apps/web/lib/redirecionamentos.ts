/**
 * Endereços antigos do painel → telas novas (permanentes; o Next repassa a query string).
 * A ordem importa: a primeira regra que casa vence, então as específicas vêm antes do `/mais/:resto*`.
 */
export const REDIRECIONAMENTOS = [
  { source: '/mais/gastos', destination: '/gestao/gastos', permanent: true },
  { source: '/mais/equipe', destination: '/gestao/equipe', permanent: true },
  { source: '/mais/privacidade', destination: '/gestao/privacidade', permanent: true },
  { source: '/mais/atendimento-humano', destination: '/ajustes#atendimento-humano', permanent: true },
  { source: '/mais/:resto*', destination: '/ajustes', permanent: true },
] as const
