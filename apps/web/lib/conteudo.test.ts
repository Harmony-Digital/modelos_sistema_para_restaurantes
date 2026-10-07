import { describe, expect, it } from 'vitest'
import { abaDoConteudo, hrefDoConteudoAntigo, hrefDasRespostasAntigas } from './conteudo'
import { alvosDaTela, urlImportacao, urlImportarAlvo } from './importacao'

const IMP = '11111111-1111-4111-8111-000000000001'

describe('importação: entrada em cada tela', () => {
  it('cardápio e informações abrem o importador na própria aba; horários e espaços em Unidades', () => {
    expect(urlImportarAlvo('cardapio')).toBe('/conteudo?aba=cardapio&importar=1')
    expect(urlImportarAlvo('informacoes')).toBe('/conteudo?aba=informacoes&importar=1')
    expect(urlImportarAlvo('horarios')).toBe('/unidades/importar?alvo=horarios')
    expect(urlImportarAlvo('espacos')).toBe('/unidades/importar?alvo=espacos')
  })
  it('uma importação abre na tela do seu alvo', () => {
    expect(urlImportacao(IMP, 'cardapio')).toBe(`/conteudo?aba=cardapio&importar=1&imp=${IMP}`)
    expect(urlImportacao(IMP, 'espacos')).toBe(`/unidades/importar?alvo=espacos&imp=${IMP}`)
  })
  it('a mesma tela importa os alvos dela (Unidades: horários e espaços)', () => {
    expect(alvosDaTela('cardapio')).toEqual(['cardapio'])
    expect(alvosDaTela('informacoes')).toEqual(['informacoes'])
    expect(alvosDaTela('horarios')).toEqual(['horarios', 'espacos'])
    expect(alvosDaTela('espacos')).toEqual(['horarios', 'espacos'])
  })
})

describe('Conteúdo: abas', () => {
  it('três abas; sem aba ou aba desconhecida abre o Cardápio', () => {
    expect(abaDoConteudo('informacoes')).toBe('informacoes')
    expect(abaDoConteudo('mensagens')).toBe('mensagens')
    expect(abaDoConteudo(undefined)).toBe('cardapio')
    expect(abaDoConteudo('xyz')).toBe('cardapio')
  })
})

describe('Conteúdo: endereços antigos', () => {
  it('?aba=importar vai para o Cardápio com o importador aberto (ou para a tela do alvo pedido)', () => {
    expect(hrefDoConteudoAntigo({ aba: 'importar' })).toBe('/conteudo?aba=cardapio&importar=1')
    expect(hrefDoConteudoAntigo({ aba: 'importar', alvo: 'informacoes' })).toBe('/conteudo?aba=informacoes&importar=1')
    expect(hrefDoConteudoAntigo({ aba: 'importar', alvo: 'horarios' })).toBe('/unidades/importar?alvo=horarios')
    expect(hrefDoConteudoAntigo({ aba: 'importar', alvo: 'bobagem' })).toBe('/conteudo?aba=cardapio&importar=1')
  })
  it('?aba=importar&imp= preserva a importação (a tela confere o alvo dela); imp inválido some', () => {
    expect(hrefDoConteudoAntigo({ aba: 'importar', imp: IMP })).toBe(`/conteudo?aba=cardapio&importar=1&imp=${IMP}`)
    expect(hrefDoConteudoAntigo({ aba: 'importar', alvo: 'espacos', imp: IMP })).toBe(`/unidades/importar?alvo=espacos&imp=${IMP}`)
    expect(hrefDoConteudoAntigo({ aba: 'importar', imp: 'x' })).toBe('/conteudo?aba=cardapio&importar=1')
  })
  it('Cardápio → Importar (Etapa 05) também abre o importador do cardápio', () => {
    expect(hrefDoConteudoAntigo({ aba: 'cardapio', sub: 'importar' })).toBe('/conteudo?aba=cardapio&importar=1')
    expect(hrefDoConteudoAntigo({ aba: 'cardapio', sub: 'importar', imp: IMP })).toBe(`/conteudo?aba=cardapio&importar=1&imp=${IMP}`)
  })
  it('?aba=sem-resposta vai para Informações (onde ficam as pendências)', () => {
    expect(hrefDoConteudoAntigo({ aba: 'sem-resposta' })).toBe('/conteudo?aba=informacoes')
  })
  it('endereços novos ficam como estão', () => {
    expect(hrefDoConteudoAntigo({})).toBeNull()
    expect(hrefDoConteudoAntigo({ aba: 'cardapio', sub: 'itens' })).toBeNull()
    expect(hrefDoConteudoAntigo({ aba: 'informacoes', importar: '1' })).toBeNull()
    expect(hrefDoConteudoAntigo({ aba: 'mensagens' })).toBeNull()
  })
})

describe('/respostas antigo', () => {
  it('sem aba vai para Mensagens; com aba repassa (e o Conteúdo resolve as antigas)', () => {
    expect(hrefDasRespostasAntigas({})).toBe('/conteudo?aba=mensagens')
    expect(hrefDasRespostasAntigas({ aba: 'sem-resposta' })).toBe('/conteudo?aba=sem-resposta')
    expect(hrefDasRespostasAntigas({ aba: 'cardapio', sub: 'arquivos' })).toBe('/conteudo?aba=cardapio&sub=arquivos')
  })
})
