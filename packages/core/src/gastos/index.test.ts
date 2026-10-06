import { describe, expect, it } from 'vitest';
import { emReais, formatarUsd, nivelAlerta, percentual } from './index';

describe('nivelAlerta', () => {
  it('0 abaixo do alerta', () => expect(nivelAlerta(7.99, 10, 80)).toBe(0));
  it('80 exatamente no percentual', () => expect(nivelAlerta(8, 10, 80)).toBe(80));
  it('80 com pct configurado diferente', () => expect(nivelAlerta(5, 10, 50)).toBe(80));
  it('100 exatamente no limite', () => expect(nivelAlerta(10, 10, 80)).toBe(100));
  it('100 acima do limite', () => expect(nivelAlerta(12, 10, 80)).toBe(100));
  it('recusa limite zero ou negativo', () => {
    expect(() => nivelAlerta(1, 0, 80)).toThrow();
    expect(() => nivelAlerta(1, -1, 80)).toThrow();
  });
  it('recusa pct fora de 1..100', () => {
    expect(() => nivelAlerta(1, 10, 0)).toThrow();
    expect(() => nivelAlerta(1, 10, 101)).toThrow();
  });
});

describe('percentual', () => {
  it('calcula', () => expect(percentual('2.5', '10')).toBe(25));
  it('passa de 100', () => expect(percentual('15', '10')).toBe(150));
  it('zero gasto', () => expect(percentual('0', '10')).toBe(0));
  it('recusa limite zero', () => expect(() => percentual('1', '0')).toThrow());
  it('recusa entrada inválida', () => expect(() => percentual('abc', '10')).toThrow());
});

describe('emReais', () => {
  it('converte', () => expect(emReais('1.00', '5.5')).toBe('R$ 5,50'));
  it('arredonda ao centavo', () => expect(emReais('0.0123', '5.5')).toBe('R$ 0,07'));
  it('meio centavo sobe', () => expect(emReais('0.0010', '5')).toBe('R$ 0,01'));
  it('milhares', () => expect(emReais('224.4', '5.5')).toBe('R$ 1.234,20'));
  it('zero', () => expect(emReais('0', '5.5')).toBe('R$ 0,00'));
  it('recusa entrada inválida', () => {
    expect(() => emReais('x', '5.5')).toThrow();
    expect(() => emReais('1', '-5')).toThrow();
  });
});

describe('formatarUsd', () => {
  it('4 casas abaixo de 1', () => expect(formatarUsd('0.0123')).toBe('US$ 0,0123'));
  it('2 casas a partir de 1', () => expect(formatarUsd('12.3456')).toBe('US$ 12,35'));
  it('milhares', () => expect(formatarUsd('1234.5')).toBe('US$ 1.234,50'));
  it('zero', () => expect(formatarUsd('0')).toBe('US$ 0,0000'));
  it('recusa inválido', () => expect(() => formatarUsd('')).toThrow());
});
