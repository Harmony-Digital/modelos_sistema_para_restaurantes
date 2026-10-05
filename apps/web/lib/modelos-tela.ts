import { formatarEndereco, renderModelo, type ChaveModelo } from '@atd/core/s1'

export type UnidadeExemplo = { nome: string; endereco: string | null; bairro: string | null; cidade: string | null; uf: string | null; mapsUrl: string | null }

export const ROTULOS_MODELO: Record<ChaveModelo, { titulo: string; quando: string }> = {
  aberto_sim: { titulo: 'Aberta agora', quando: 'O cliente pergunta se está aberto e a unidade está aberta.' },
  aberto_nao: { titulo: 'Fechada agora', quando: 'Está fechada e já se sabe quando abre.' },
  aberto_sem_previsao: { titulo: 'Fechada sem previsão', quando: 'Está fechada e não há próxima abertura nos próximos 14 dias.' },
  aberto_varias: { titulo: 'Aberto agora (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  horario_dia: { titulo: 'Horário de um dia', quando: 'O cliente pergunta o horário de hoje, amanhã, domingo, dia 12…' },
  horario_dia_fechado: { titulo: 'Não abre no dia', quando: 'A unidade não abre no dia perguntado.' },
  horario_varias: { titulo: 'Horário de um dia (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  horario_semana: { titulo: 'Horários da semana', quando: 'O cliente pede os horários da semana inteira.' },
  endereco: { titulo: 'Endereço', quando: 'O cliente pergunta onde fica a unidade.' },
  como_chegar: { titulo: 'Como chegar', quando: 'O cliente pede rota ou link do mapa.' },
  endereco_varias: { titulo: 'Endereços (várias unidades)', quando: 'O cliente não disse a unidade e há até 3 unidades.' },
  lista_unidades: { titulo: 'Lista de unidades', quando: 'O cliente pergunta quais unidades existem.' },
  escolher_unidade: { titulo: 'Pedir a unidade', quando: 'Texto da lista enviada quando há mais de 3 unidades.' },
  data_nao_entendida: { titulo: 'Data não entendida', quando: 'A IA não entendeu o dia da pergunta.' },
  lista_expirada: { titulo: 'Lista vencida', quando: 'O cliente toca numa lista antiga (mais de 30 minutos).' },
  lacuna: { titulo: 'Ainda não sabe responder', quando: 'Não há informação cadastrada; a pergunta vai para "Sem resposta".' },
  em_breve: { titulo: 'Serviço em breve', quando: 'Pergunta sobre cardápio, eventos ou aviso de presença (próximas etapas).' },
}

const LINHAS: Partial<Record<ChaveModelo, (nome: string, endereco: string) => string>> = {
  aberto_varias: (n) => `• ${n}: aberta, fecha às 23h\n• Outra unidade: fechada, abre amanhã às 11h30`,
  horario_varias: (n) => `• ${n}: das 11h às 23h\n• Outra unidade: fechada`,
  horario_semana: () => 'Segunda-feira: fechada\nTerça-feira: das 11h30 às 15h e das 18h às 23h\n…',
  endereco_varias: (n, e) => `• ${n}: ${e}\n• Outra unidade: …`,
  lista_unidades: (n) => `• ${n}\n• Outra unidade`,
}

export function exemploDeVariaveis(chave: ChaveModelo, u: UnidadeExemplo | null): Record<string, string> {
  const nome = u?.nome ?? 'Asa Sul'
  const endereco = (u && formatarEndereco(u)) ?? 'SCLS 404 Bloco C, Asa Sul, Brasília/DF'
  return {
    unidade: nome,
    fecha: 'às 23h',
    abre: 'às 11h30',
    quando: chave.startsWith('horario') ? 'Domingo (11/10)' : 'amanhã',
    turnos: 'das 11h30 às 15h e das 18h às 23h',
    linhas: LINHAS[chave]?.(nome, endereco) ?? '',
    endereco,
    mapa: u?.mapsUrl ?? 'https://maps.app.goo.gl/…',
    servico: 'o cardápio',
  }
}

export function previaModelo(chave: ChaveModelo, texto: string, u: UnidadeExemplo | null): string {
  return renderModelo(chave, exemploDeVariaveis(chave, u), { [chave]: texto })
}
