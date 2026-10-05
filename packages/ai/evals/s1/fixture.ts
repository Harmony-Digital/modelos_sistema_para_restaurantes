import type { ContextoS1, FatoS1, Turno, UnidadeS1 } from '@atd/core'

const almoco = { abre: '11:30', fecha: '15:00' }
const jantar = { abre: '18:00', fecha: '23:00' }
const jantarTarde = { abre: '18:00', fecha: '02:00' }
const todoDia = (t: Turno) => Array.from({ length: 7 }, () => [t])
const unidade = (p: Partial<UnidadeS1> & Pick<UnidadeS1, 'id' | 'nome'>): UnidadeS1 => ({
  apelidos: [], ordem: 0, endereco: null, bairro: null, cidade: null, uf: null, lat: null, lng: null, mapsUrl: null,
  semanal: [[], [], [], [], [], [], []], excecoes: {}, ...p,
})

export const ASA_SUL = unidade({
  id: 'u-asa-sul', nome: 'Asa Sul', apelidos: ['204 sul'], ordem: 1,
  endereco: 'SCLS 404 Bloco C', bairro: 'Asa Sul', cidade: 'Brasília', uf: 'DF',
  lat: -15.8136, lng: -47.896, mapsUrl: 'https://maps.app.goo.gl/asasul',
  // seg fechada; ter–qui almoço+jantar; sex–sáb jantar até 2h; dom 11h30–16h
  semanal: [[{ abre: '11:30', fecha: '16:00' }], [], [almoco, jantar], [almoco, jantar], [almoco, jantar], [almoco, jantarTarde], [almoco, jantarTarde]],
  excecoes: { '2026-12-25': { fechado: true, turnos: [], motivo: 'Natal' } },
})
export const ASA_NORTE = unidade({
  id: 'u-asa-norte', nome: 'Asa Norte', ordem: 2,
  endereco: 'SCLN 302 Bloco B', bairro: 'Asa Norte', cidade: 'Brasília', uf: 'DF',
  lat: -15.7801, lng: -47.8829, mapsUrl: 'https://maps.app.goo.gl/asanorte',
  semanal: todoDia({ abre: '11:00', fecha: '23:00' }),
  excecoes: { '2026-12-24': { fechado: false, turnos: [{ abre: '11:00', fecha: '18:00' }], motivo: 'Véspera de Natal' } },
})
const almocoLago = { abre: '12:00', fecha: '16:00' }
export const LAGO_SUL = unidade({
  id: 'u-lago-sul', nome: 'Lago Sul', ordem: 3,
  endereco: 'SHIS QI 11 Bloco A', bairro: 'Lago Sul', cidade: 'Brasília', uf: 'DF', // sem lat/lng: sem cartão de localização
  semanal: [[almocoLago], [], [almocoLago], [almocoLago], [almocoLago], [almocoLago], [almocoLago]],
})
const noite = { abre: '18:00', fecha: '23:00' }
const diaTodo = { abre: '12:00', fecha: '23:00' }
export const AGUAS_CLARAS = unidade({
  id: 'u-aguas-claras', nome: 'Águas Claras', apelidos: ['AC'], ordem: 4,
  bairro: 'Águas Claras', cidade: 'Brasília', uf: 'DF', // sem endereço: vira lacuna
  semanal: [[diaTodo], [noite], [noite], [noite], [noite], [noite], [diaTodo]],
})

export const FATOS: FatoS1[] = [
  { id: 'f-est', tema: 'Estacionamento', exemplos: ['tem vaga', 'onde estacionar'], texto: 'Temos estacionamento gratuito para clientes em todas as unidades.', unitId: null },
  { id: 'f-wifi', tema: 'Wi-Fi', exemplos: ['senha do wifi', 'internet'], texto: 'A senha do Wi-Fi está no cardápio da mesa.', unitId: 'u-asa-sul' },
  { id: 'f-pet', tema: 'Pet friendly', exemplos: ['aceita cachorro', 'pode levar animal'], texto: 'Aceitamos pets na área externa, com coleira.', unitId: null },
  { id: 'f-musica', tema: 'Música ao vivo', exemplos: ['tem show'], texto: 'Sextas e sábados tem música ao vivo a partir das 20h.', unitId: 'u-asa-norte' },
  { id: 'f-pag', tema: 'Formas de pagamento', exemplos: ['aceita pix', 'cartao', 'vale refeicao'], texto: 'Aceitamos Pix, cartões de crédito e débito e vale-refeição.', unitId: null },
  { id: 'f-acess', tema: 'Acessibilidade', exemplos: ['cadeirante', 'rampa'], texto: 'A unidade tem rampa de acesso e banheiro adaptado.', unitId: 'u-lago-sul' },
]

export const CONTEXTO: ContextoS1 = {
  restaurante: 'Casa Harmonia',
  timezone: 'America/Sao_Paulo',
  politicaFeriado: 'como_domingo',
  unidades: [ASA_SUL, ASA_NORTE, LAGO_SUL, AGUAS_CLARAS],
  fatos: FATOS,
  modelos: {},
}
export const CONTEXTO_PEQUENO: ContextoS1 = { ...CONTEXTO, unidades: [ASA_SUL, ASA_NORTE] }
