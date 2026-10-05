import type { UnidadePainel } from '@atd/db'
import { maskTelefone } from '@/components/form/masks'
import type { DadosUnidadeForm } from '@/lib/schemas/unidades'

const cepFormatado = (cep: string | null) => (cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : (cep ?? ''))

export function valoresDadosUnidade(u: UnidadePainel): DadosUnidadeForm {
  return {
    nome: u.nome,
    endereco: u.endereco ?? '',
    bairro: u.bairro ?? '',
    cidade: u.cidade ?? '',
    uf: u.uf ?? '',
    cep: cepFormatado(u.cep),
    telefone: u.telefone ? maskTelefone(u.telefone) : '',
    apelidos: u.apelidos,
    mapsUrl: u.mapsUrl ?? '',
    ativo: u.ativo,
  }
}
