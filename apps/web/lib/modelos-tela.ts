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
  em_breve: { titulo: 'Serviço em breve', quando: 'Pergunta sobre cardápio ou eventos (próximas etapas).' },
  aviso_registrado: { titulo: 'Aviso anotado', quando: 'O cliente avisa que vai a uma unidade e o aviso é registrado.' },
  aviso_atualizado: { titulo: 'Aviso atualizado', quando: 'O cliente já tinha aviso na mesma unidade e dia, e ele foi atualizado.' },
  aviso_pessoas: { titulo: 'Perguntar quantas pessoas', quando: 'O cliente avisou que vai, mas não disse para quantas pessoas.' },
  aviso_pessoas_invalido: { titulo: 'Quantidade de pessoas fora do limite', quando: 'O aviso é para menos de 1 ou mais de 60 pessoas.' },
  aviso_data_fora: { titulo: 'Dia fora do prazo', quando: 'O aviso é para antes de hoje ou depois de 30 dias.' },
  aviso_unidade_fechada: { titulo: 'Unidade fechada no dia do aviso', quando: 'A unidade não abre no dia em que o cliente avisou que vai.' },
  aviso_horario_fora: { titulo: 'Horário do aviso fora do funcionamento', quando: 'O horário informado não está dentro dos horários do dia.' },
  aviso_horario_passado: { titulo: 'Horário do aviso já passou', quando: 'O aviso é para hoje num horário que já passou.' },
  aviso_cancelado: { titulo: 'Aviso cancelado', quando: 'O cliente pede para cancelar o aviso.' },
  aviso_nao_encontrado: { titulo: 'Nenhum aviso para cancelar', quando: 'O cliente pede para cancelar, mas não tem aviso ativo.' },
  aviso_qual_cancelar: { titulo: 'Qual aviso cancelar', quando: 'O cliente tem vários avisos e não disse qual cancelar. {exemplo} é uma frase de cancelamento com o primeiro aviso da lista.' },
}

const LINHAS: Partial<Record<ChaveModelo, (nome: string, endereco: string) => string>> = {
  aberto_varias: (n) => `• ${n}: aberta, fecha às 23h\n• Outra unidade: fechada, abre amanhã às 11h30`,
  horario_varias: (n) => `• ${n}: das 11h às 23h\n• Outra unidade: fechada`,
  horario_semana: () => 'Segunda-feira: fechada\nTerça-feira: das 11h30 às 15h e das 18h às 23h\n…',
  endereco_varias: (n, e) => `• ${n}: ${e}\n• Outra unidade: …`,
  lista_unidades: (n) => `• ${n}\n• Outra unidade`,
  aviso_qual_cancelar: (n) => `• ${n} — hoje, 2 pessoas\n• Outra unidade — domingo (11/10), 4 pessoas`,
}

// {quando} no início da frase ("Domingo (11/10), a unidade…") ou no meio ("Anotado: …, domingo (11/10)")
const QUANDO_INICIO: readonly ChaveModelo[] = ['horario_dia', 'horario_dia_fechado', 'horario_varias', 'aviso_unidade_fechada', 'aviso_horario_fora']
const QUANDO_MEIO: readonly ChaveModelo[] = ['aviso_registrado', 'aviso_atualizado', 'aviso_cancelado']

export function exemploDeVariaveis(chave: ChaveModelo, u: UnidadeExemplo | null): Record<string, string> {
  const nome = u?.nome ?? 'Asa Sul'
  const endereco = (u && formatarEndereco(u)) ?? 'SCLS 404 Bloco C, Asa Sul, Brasília/DF'
  return {
    unidade: nome,
    fecha: 'às 23h',
    abre: 'às 11h30',
    quando: QUANDO_INICIO.includes(chave) ? 'Domingo (11/10)' : QUANDO_MEIO.includes(chave) ? 'domingo (11/10)' : 'amanhã',
    turnos: 'das 11h30 às 15h e das 18h às 23h',
    linhas: LINHAS[chave]?.(nome, endereco) ?? '',
    endereco,
    mapa: u?.mapsUrl ?? 'https://maps.app.goo.gl/…',
    servico: 'o cardápio',
    pessoas: '4 pessoas',
    horario: ', por volta das 20h',
    limite: '04/11',
    exemplo: `cancela o aviso de hoje na unidade ${nome}`,
  }
}

export function previaModelo(chave: ChaveModelo, texto: string, u: UnidadeExemplo | null): string {
  return renderModelo(chave, exemploDeVariaveis(chave, u), { [chave]: texto })
}
