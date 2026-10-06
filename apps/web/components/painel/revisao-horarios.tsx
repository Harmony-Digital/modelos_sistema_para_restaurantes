'use client'
import { Plus, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { LIMITES_IMPORTACAO, type RascunhoHorarios } from '@atd/core/importacao'
import { Field, Select, TimeInput } from '@/components/form'
import { AcoesRevisao, ResultadoImportacao, Resumo, useConfirmarImportacao, type UnidadeOpcao } from '@/components/painel/revisao-comum'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RotuloHorario = { unitId: string | null; reconhecida: boolean; acao: 'novo' | 'atualizar' | 'ignorar' | 'escolher_unidade' }
/** `excecoes`: semana vazia, só as datas especiais mudam (sem Novo/Atualiza pela grade) */
type AcaoTela = RotuloHorario['acao'] | 'excecoes'
type Turno = { abre: string; fecha: string }
type DiaEdit = { dia: number; turnos: Turno[]; conflito: boolean; lido: boolean }
type Excecao = RascunhoHorarios['unidades'][number]['excecoes'][number]
type UnidadeEdit = { incluir: boolean; escolha: string; semana: DiaEdit[]; excecoes: Excecao[] }

const DIAS: readonly string[] = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const nomeDia = (d: number) => DIAS[d] ?? ''
const IGNORAR = '__ignorar'
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const ERRO_TURNOS = 'Confira os turnos: hora no formato 11:30 e abertura diferente do fechamento.'
const dataBr = (iso: string) => iso.split('-').reverse().join('/')
const turnosTexto = (ts: Turno[]) => ts.map((t) => `${t.abre}–${t.fecha}`).join(', ')
const turnoValido = (t: Turno) => HORA.test(t.abre) && HORA.test(t.fecha) && t.abre !== t.fecha

/**
 * Revisão de horários (PRD I10), por unidade: grade da semana com turnos editáveis e as datas especiais. Unidade não
 * reconhecida exige escolher a unidade ou ignorar (Review Focus 1); escolher grava o id da unidade no rascunho (a DAL
 * resolve id → slug → nome → apelido) e o Novo/Atualiza vem de `unidadesComHorario`. `semana: []` = a grade não muda,
 * só as exceções ("Só datas especiais"). Dia com `conflito` (fechado × aberto entre arquivos, turnos sobrepostos ou
 * demais) fica destacado até ser editado.
 */
export function RevisaoHorarios(props: {
  id: string
  rascunho: RascunhoHorarios
  rotulos: RotuloHorario[]
  unidades: UnidadeOpcao[]
  /** unidades que já têm grade cadastrada */
  unidadesComHorario: string[]
  podeAplicar: boolean
}) {
  const c = useConfirmarImportacao({ id: props.id, alvo: 'horarios', modo: 'completo' })
  const precisaEscolher = (i: number) => !(props.rotulos[i]?.reconhecida ?? false)
  const [unidades, setUnidades] = useState<UnidadeEdit[]>(() =>
    props.rascunho.unidades.map((u, i) => ({
      incluir: u.incluir,
      escolha: precisaEscolher(i) && !u.incluir ? IGNORAR : '',
      semana: DIAS.map((_, dia) => {
        const d = u.semana.find((x) => x.dia === dia)
        return { dia, turnos: d?.turnos ?? [], conflito: d?.conflito ?? false, lido: d !== undefined }
      }),
      excecoes: u.excecoes,
    })),
  )
  const [mostrarErros, setMostrarErros] = useState(false)
  const mudar = (i: number, f: (u: UnidadeEdit) => UnidadeEdit) => setUnidades((atual) => atual.map((u, x) => (x === i ? f(u) : u)))
  // editar o dia é conferi-lo: tira a marca de conflito (como a capacidade nos espaços)
  const mudarDia = (i: number, dia: number, f: (d: DiaEdit) => DiaEdit) =>
    mudar(i, (u) => ({ ...u, semana: u.semana.map((d) => (d.dia === dia ? { ...f(d), conflito: false } : d)) }))
  const incluida = (i: number, u: UnidadeEdit) => (precisaEscolher(i) ? u.escolha !== IGNORAR : u.incluir)
  const semanaMuda = (i: number) => (props.rascunho.unidades[i]?.semana.length ?? 0) > 0

  const erros = (i: number, u: UnidadeEdit) => {
    const r: { unidade?: string; dias: Set<number> } = { dias: new Set() }
    if (precisaEscolher(i) && u.escolha === '') r.unidade = 'Escolha a unidade ou ignore estes horários.'
    if (semanaMuda(i)) for (const d of u.semana) if (!d.turnos.every(turnoValido)) r.dias.add(d.dia)
    return r
  }
  const temErro = (i: number, u: UnidadeEdit) => {
    const e = erros(i, u)
    return e.unidade !== undefined || e.dias.size > 0
  }

  const nomeDe = (i: number) => {
    const u = props.rascunho.unidades[i]!
    return props.unidades.find((x) => x.id === props.rotulos[i]?.unitId)?.nome ?? u.unidade ?? 'unidade sem nome'
  }
  /** Novo/Atualiza também para a unidade escolhida à mão; null = sem rótulo (ignorada ou ainda sem escolha) */
  const acaoDe = (i: number, u: UnidadeEdit): AcaoTela | null => {
    if (!incluida(i, u)) return null
    if (precisaEscolher(i) && u.escolha === '') return 'escolher_unidade'
    if (!semanaMuda(i)) return 'excecoes'
    if (!precisaEscolher(i)) return props.rotulos[i]?.acao ?? null
    return props.unidadesComHorario.includes(u.escolha) ? 'atualizar' : 'novo'
  }
  const contar = (a: AcaoTela) => unidades.filter((u, i) => acaoDe(i, u) === a).length
  const diasConflito = unidades.reduce((n, u, i) => n + (incluida(i, u) && semanaMuda(i) ? u.semana.filter((d) => d.conflito).length : 0), 0)

  const montar = (): RascunhoHorarios | null => {
    if (unidades.some((u, i) => incluida(i, u) && temErro(i, u))) {
      setMostrarErros(true)
      c.setErroGeral('Confira os campos marcados antes de confirmar.')
      return null
    }
    return {
      unidades: unidades.map((u, i) => {
        const orig = props.rascunho.unidades[i]!
        const inc = incluida(i, u)
        return {
          unidade: precisaEscolher(i) && u.escolha !== '' && u.escolha !== IGNORAR ? u.escolha : orig.unidade,
          // fora do envio, a semana vai como foi lida (válida pelo schema)
          semana: !semanaMuda(i) || !inc
            ? orig.semana
            : u.semana.filter((d) => d.lido || d.turnos.length > 0).map((d) => ({ dia: d.dia, turnos: d.turnos, conflito: d.conflito })),
          excecoes: u.excecoes,
          incluir: inc,
        }
      }),
    }
  }

  if (c.resultado) return <ResultadoImportacao alvo="horarios" modo="completo" r={c.resultado} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Revise os horários antes de confirmar</h2>
        <p className="text-sm text-muted-foreground">
          A IA informa estes horários aos clientes. Confira cada unidade: a semana inteira é substituída pela que estiver aqui.
        </p>
        <Resumo
          partes={[
            [contar('novo'), 'unidade nova', 'unidades novas'], [contar('atualizar'), 'para atualizar', 'para atualizar'],
            [contar('excecoes'), 'só com datas especiais', 'só com datas especiais'],
            [contar('escolher_unidade'), 'com unidade a escolher', 'com unidade a escolher'], [diasConflito, 'dia para conferir', 'dias para conferir'],
          ]}
        />
      </div>
      {unidades.map((u, i) => {
        const nome = nomeDe(i)
        const inc = incluida(i, u)
        const e = mostrarErros && inc ? erros(i, u) : { unidade: undefined, dias: new Set<number>() }
        const acao = acaoDe(i, u)
        const lida = props.rascunho.unidades[i]?.unidade ?? null
        return (
          <section key={i} aria-label={`Horários de ${nome}`} className={cn('flex flex-col gap-3 rounded-lg border border-border bg-card p-4', !inc && 'opacity-60')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 break-words text-base font-semibold text-foreground">{nome}</h3>
              {acao === 'novo' && <Badge>Novo</Badge>}
              {acao === 'atualizar' && <Badge variant="secondary">Atualiza</Badge>}
              {acao === 'excecoes' && <Badge variant="outline">Só datas especiais</Badge>}
            </div>
            {precisaEscolher(i) ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {lida ? `Lido como “${lida}”, que não corresponde a nenhuma unidade.` : 'O arquivo não diz de qual unidade são estes horários.'}
                </p>
                <Field id={`hor-${i}-unidade`} label="Unidade" error={e.unidade} required>
                  {(a) => (
                    <Select {...a} value={u.escolha} onChange={(ev) => mudar(i, (x) => ({ ...x, escolha: ev.target.value }))}>
                      <option value="">Escolha a unidade…</option>
                      {props.unidades.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      <option value={IGNORAR}>Ignorar estes horários</option>
                    </Select>
                  )}
                </Field>
              </>
            ) : (
              <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground">
                <input type="checkbox" className="size-5 accent-primary" checked={u.incluir} onChange={(ev) => mudar(i, (x) => ({ ...x, incluir: ev.target.checked }))} />
                Incluir
              </label>
            )}

            <h4 className="text-sm font-semibold text-foreground">Semana</h4>
            {!semanaMuda(i) ? (
              <p className="text-sm text-muted-foreground">A semana não muda, só as exceções.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {u.semana.map((d) => (
                  <li
                    key={d.dia}
                    role="group"
                    aria-label={nomeDia(d.dia)}
                    data-conflito={d.conflito || undefined}
                    className={cn('flex flex-col gap-2 rounded-md border border-border p-3', d.conflito && 'border-2 border-foreground bg-secondary')}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{nomeDia(d.dia)}</span>
                      {d.turnos.length === 0 && <span className="text-sm text-muted-foreground">Fechado</span>}
                    </div>
                    {d.conflito && (
                      <p className="flex items-start gap-2 text-sm text-foreground">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>Leituras diferentes para este dia (fechado num arquivo e aberto em outro, ou turnos sobrepostos): confira.</span>
                      </p>
                    )}
                    {d.turnos.map((t, ti) => (
                      <div key={ti} className="flex items-end gap-2">
                        <Field id={`hor-${i}-${d.dia}-${ti}-abre`} label={`Abre (turno ${ti + 1})`} className="min-w-0 flex-1">
                          {(a) => (
                            <TimeInput {...a} value={t.abre} onChange={(ev) => mudarDia(i, d.dia, (x) => ({ ...x, turnos: x.turnos.map((y, z) => (z === ti ? { ...y, abre: ev.target.value } : y)) }))} />
                          )}
                        </Field>
                        <Field id={`hor-${i}-${d.dia}-${ti}-fecha`} label={`Fecha (turno ${ti + 1})`} className="min-w-0 flex-1">
                          {(a) => (
                            <TimeInput {...a} value={t.fecha} onChange={(ev) => mudarDia(i, d.dia, (x) => ({ ...x, turnos: x.turnos.map((y, z) => (z === ti ? { ...y, fecha: ev.target.value } : y)) }))} />
                          )}
                        </Field>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover turno ${ti + 1} do ${nomeDia(d.dia).toLowerCase()}`}
                          onClick={() => mudarDia(i, d.dia, (x) => ({ ...x, turnos: x.turnos.filter((_, z) => z !== ti) }))}
                          className="shrink-0"
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                    ))}
                    {e.dias.has(d.dia) && <p className="text-sm font-medium text-destructive">{ERRO_TURNOS}</p>}
                    {d.turnos.length < LIMITES_IMPORTACAO.turnos && (
                      <Button
                        variant="ghost"
                        className="self-start"
                        aria-label={`Adicionar turno no ${nomeDia(d.dia).toLowerCase()}`}
                        onClick={() => mudarDia(i, d.dia, (x) => ({ ...x, turnos: [...x.turnos, { abre: '', fecha: '' }] }))}
                      >
                        <Plus aria-hidden="true" className="size-4" /> Turno
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h4 className="text-sm font-semibold text-foreground">Datas especiais</h4>
            {u.excecoes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma data especial lida.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {u.excecoes.map((x) => (
                  <li key={x.data} className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-border p-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-foreground">{dataBr(x.data)}</p>
                      <p className="break-words text-muted-foreground">
                        {x.fechado ? 'Fechado' : turnosTexto(x.turnos)}{x.motivo ? ` · ${x.motivo}` : ''}
                      </p>
                      {x.conflito && <p className="text-foreground">Leituras diferentes para esta data: confira.</p>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover a data ${dataBr(x.data)}`}
                      onClick={() => mudar(i, (y) => ({ ...y, excecoes: y.excecoes.filter((z) => z.data !== x.data) }))}
                      className="shrink-0"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      <AcoesRevisao
        alvo="horarios"
        id={props.id}
        podeAplicar={props.podeAplicar}
        aplicando={c.aplicando}
        erroGeral={c.erroGeral}
        semIncluidos={!unidades.some((u, i) => incluida(i, u))}
        onConfirmar={() => void c.confirmar(montar)}
      />
    </div>
  )
}
