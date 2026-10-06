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
  escolher_unidade_aviso: { titulo: 'Pedir a unidade do aviso', quando: 'Texto da lista enviada quando o cliente avisa que vai e não diz a unidade.' },
  data_nao_entendida: { titulo: 'Data não entendida', quando: 'A IA não entendeu o dia da pergunta.' },
  lista_expirada: { titulo: 'Lista vencida', quando: 'O cliente toca numa lista antiga (mais de 30 minutos; 60 na lista de um pedido de evento).' },
  lacuna: { titulo: 'Ainda não sabe responder', quando: 'Não há informação cadastrada; a pergunta vai para "Sem resposta".' },
  em_breve: { titulo: 'Serviço em breve', quando: 'Pergunta sobre o cardápio (próxima etapa).' },
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
  // eventos (Etapa 04)
  evento_registrado: { titulo: 'Pedido de evento recebido', quando: 'O cliente pede um evento e o pedido é registrado para a equipe.' },
  evento_ja_registrado: { titulo: 'Pedido de evento já recebido', quando: 'O cliente pede de novo um evento que já tem pedido em andamento na mesma unidade e data: não duplica.' },
  evento_pergunta_unidade: { titulo: 'Pedir a unidade do evento', quando: 'Texto da lista enviada quando o cliente pede um evento e não diz a unidade.' },
  evento_pergunta_data: { titulo: 'Perguntar a data do evento', quando: 'Falta a data do evento.' },
  evento_pergunta_convidados: { titulo: 'Perguntar quantos convidados', quando: 'Falta o número de convidados.' },
  evento_pergunta_tipo: { titulo: 'Perguntar o tipo do evento', quando: 'Falta o tipo do evento.' },
  evento_data_fora: { titulo: 'Data do evento fora do prazo', quando: 'O evento é para hoje, para antes ou para depois de 1 ano.' },
  evento_convidados_invalido: { titulo: 'Convidados fora do limite', quando: 'O evento é para menos de 1 ou mais de 1000 convidados.' },
  evento_espaco_capacidade: { titulo: 'Espaço não comporta o grupo', quando: 'O espaço escolhido não comporta o número de convidados.' },
  evento_espacos: { titulo: 'Espaços para eventos', quando: 'O cliente pergunta quais espaços existem.' },
  evento_cancelado: { titulo: 'Pedido de evento cancelado', quando: 'O cliente pede para cancelar o pedido de evento.' },
  evento_nao_encontrado: { titulo: 'Nenhum pedido de evento para cancelar', quando: 'O cliente pede para cancelar, mas não tem pedido em andamento.' },
  evento_qual_cancelar: { titulo: 'Qual pedido de evento cancelar', quando: 'O cliente tem vários pedidos e não disse qual cancelar. {exemplo} é uma frase de cancelamento com o primeiro pedido da lista.' },
  evento_confirmado_humano: { titulo: 'Evento já confirmado', quando: 'O cliente quer cancelar um evento confirmado: um atendente assume.' },
  evento_mudanca_humano: { titulo: 'Mudança no pedido de evento', quando: 'O cliente quer mudar um pedido de evento em andamento: a equipe assume e o pedido recebe uma observação.' },
  evento_ja_confirmado_humano: { titulo: 'Já há evento confirmado no dia', quando: 'O cliente pede um evento na unidade e data de um evento já confirmado: um atendente assume.' },
  // cardápio (Etapa 05)
  cardapio_item: { titulo: 'Item do cardápio', quando: 'O cliente pergunta se tem um item ou quanto custa.' },
  cardapio_indisponivel: { titulo: 'Item indisponível na unidade', quando: 'O item existe, mas está indisponível na unidade perguntada.' },
  cardapio_filtro: { titulo: 'Opções por tipo', quando: 'O cliente pergunta por opções veganas, sem glúten, infantis…' },
  cardapio_nao_encontrado: { titulo: 'Item não encontrado', quando: 'O item não está no cardápio; a pergunta vai para "Sem resposta".' },
  cardapio_parecido: { titulo: 'Só item parecido', quando: 'O item pedido não está no cardápio, mas há nomes parecidos: eles são sugeridos (sem preço) e a pergunta vai para "Sem resposta".' },
  cardapio_enviando: { titulo: 'Envio do cardápio', quando: 'Texto que acompanha o arquivo do cardápio.' },
  cardapio_sem_arquivo: { titulo: 'Cardápio sem arquivo', quando: 'O cliente pede o cardápio e não há arquivo cadastrado: vão as categorias com alguns itens.' },
}

const LINHAS: Partial<Record<ChaveModelo, (nome: string, endereco: string) => string>> = {
  aberto_varias: (n) => `• ${n}: aberta, fecha às 23h\n• Outra unidade: fechada, abre amanhã às 11h30`,
  horario_varias: (n) => `• ${n}: das 11h às 23h\n• Outra unidade: fechada`,
  horario_semana: () => 'Segunda-feira: fechada\nTerça-feira: das 11h30 às 15h e das 18h às 23h\n…',
  endereco_varias: (n, e) => `• ${n}: ${e}\n• Outra unidade: …`,
  lista_unidades: (n) => `• ${n}\n• Outra unidade`,
  aviso_qual_cancelar: (n) => `• ${n} — hoje, 2 pessoas\n• Outra unidade — domingo (11/10), 4 pessoas`,
  evento_espacos: (n) => `• Salão (${n}) — 20 a 80 pessoas.\n• Varanda (${n}) — 10 a 30 pessoas.`,
  evento_qual_cancelar: (n) => `• ${n} — sábado (10/10), 40 convidados, aniversário\n• Outra unidade — sexta-feira (20/11), 25 convidados, evento corporativo`,
}

// {quando} no início da frase ("Domingo (11/10), a unidade…") ou no meio ("Anotado: …, domingo (11/10)")
const QUANDO_INICIO: readonly ChaveModelo[] = ['horario_dia', 'horario_dia_fechado', 'horario_varias', 'aviso_unidade_fechada', 'aviso_horario_fora']
const QUANDO_MEIO: readonly ChaveModelo[] = ['aviso_registrado', 'aviso_atualizado', 'aviso_cancelado', 'evento_registrado', 'evento_ja_registrado', 'evento_cancelado']

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
    limite: chave === 'evento_data_fora' ? '05/10/2027' : '04/11',
    exemplo: chave === 'evento_qual_cancelar' ? `cancela o pedido de evento de sábado na unidade ${nome}` : `cancela o aviso de hoje na unidade ${nome}`,
    tipo: 'aniversário',
    convidados: '40 convidados',
    espaco: chave === 'evento_espaco_capacidade' ? 'Varanda' : ', no espaço Salão',
    min: '10',
    max: '30',
    sugestoes: ' Para 40 pessoas, sugiro: Salão.',
    itens: chave === 'cardapio_filtro'
      ? '• **Salada da casa** — R$ 32,00\n• **Risoto de cogumelos** — R$ 48,00'
      : '**Picanha** — Corte grelhado na brasa — R$ 59,90',
    item: '**Picanha**',
    tag: 'veganas',
    categorias: '• **Carnes**: Picanha (R$ 59,90), Fraldinha (R$ 49,00)\n• **Sobremesas**: Pudim (R$ 14,00)',
  }
}

export function previaModelo(chave: ChaveModelo, texto: string, u: UnidadeExemplo | null): string {
  return renderModelo(chave, exemploDeVariaveis(chave, u), { [chave]: texto })
}
