'use client'
import { Pencil, Store } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { salvarExcecaoAction } from '@/app/(painel)/conteudo/cardapio-actions'
import { applyServerErrors, Field, FormError, Select, SubmitButton, useZodForm } from '@/components/form'
import { MaskedInput } from '@/components/form/masked-input'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { chamarAcao } from '@/lib/action-result'
import { formatarCentavos, maskReais } from '@/lib/dinheiro'
import { excecaoSchema, type ExcecaoForm as Valores } from '@/lib/schemas/cardapio'
import type { CategoriaTela, ItemTela } from './cardapio'
import { FolhaFormulario } from './folha-formulario'

export type ExcecaoTela = { itemId: string; unitId: string; disponivel: boolean | null; precoOverrideCentavos: number | null }

function ExcecaoForm(props: { inicial: Valores; nomeItem: string; precoBase: number | null; temExcecao: boolean; onSalvo: () => void }) {
  const form = useZodForm(excecaoSchema, { defaultValues: props.inicial })
  const { errors, isSubmitting } = form.formState
  const enviando = useRef(false)
  const salvar = async (valores: Valores, mensagem: string) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(() => salvarExcecaoAction(valores))
      if (!r.ok) {
        applyServerErrors(form, r)
        return
      }
      toast.success(mensagem)
      props.onSalvo()
    } finally {
      enviando.current = false
    }
  }
  const onSubmit = form.handleSubmit(() => salvar(form.getValues(), 'Ajuste da unidade salvo'))
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormError form={form} />
      <Field id="disponivel" label="Disponível nesta unidade" error={errors.disponivel?.message}>
        {(a) => (
          <Select {...a} {...form.register('disponivel')}>
            <option value="segue">Como no cardápio geral</option>
            <option value="sim">Disponível</option>
            <option value="nao">Indisponível</option>
          </Select>
        )}
      </Field>
      <Field
        id="preco"
        label="Preço nesta unidade"
        hint={`Deixe em branco para usar o preço do cardápio${props.precoBase === null ? ' (sob consulta)' : ` (${formatarCentavos(props.precoBase)})`}.`}
        error={errors.preco?.message}
      >
        {(a) => <MaskedInput {...a} mask={maskReais} placeholder="R$ 0,00" {...form.register('preco')} />}
      </Field>
      <SubmitButton pending={isSubmitting}>Salvar ajuste</SubmitButton>
      {props.temExcecao && (
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => salvar({ ...form.getValues(), disponivel: 'segue', preco: '' }, `${props.nomeItem} voltou ao padrão`)}
        >
          Voltar ao padrão
        </Button>
      )}
    </form>
  )
}

export function ExcecoesItem(props: {
  unidades: { id: string; nome: string }[]
  categorias: CategoriaTela[]
  itens: ItemTela[]
  excecoes: ExcecaoTela[]
  podeEditar: boolean
}) {
  const [unitId, setUnitId] = useState(props.unidades[0]?.id ?? '')
  const [editando, setEditando] = useState<ItemTela | null>(null)

  if (props.unidades.length === 0) {
    return <EmptyState icon={Store} title="Nenhuma unidade disponível" description="Você ainda não tem acesso a nenhuma unidade ativa." />
  }
  const daUnidade = new Map(props.excecoes.filter((e) => e.unitId === unitId).map((e) => [e.itemId, e]))
  const edicao = editando ? daUnidade.get(editando.id) : undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="unidade-cardapio" className="text-sm font-medium text-foreground">Unidade</label>
        <Select id="unidade-cardapio" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {props.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </Select>
      </div>
      {props.itens.length === 0 ? (
        <EmptyState icon={Store} title="Nenhum item no cardápio" description="Cadastre os itens na aba Itens para ajustar disponibilidade e preço por unidade." />
      ) : (
        props.categorias.map((c) => {
          const itens = props.itens.filter((i) => i.categoryId === c.id)
          if (itens.length === 0) return null
          return (
            <section key={c.id} aria-labelledby={`un-cat-${c.id}`} className="flex flex-col gap-2">
              <h2 id={`un-cat-${c.id}`} className="text-base font-semibold text-foreground">{c.nome}</h2>
              <ul className="flex flex-col gap-2">
                {itens.map((i) => {
                  const e = daUnidade.get(i.id)
                  const disponivel = e?.disponivel ?? i.disponivel
                  const preco = e?.precoOverrideCentavos ?? i.precoCentavos
                  return (
                    <li key={i.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                          {i.nome}
                          <Badge variant={disponivel ? 'outline' : 'secondary'}>{disponivel ? 'Disponível' : 'Indisponível'}</Badge>
                          {e && <Badge variant="secondary">Ajustado</Badge>}
                        </p>
                        <p className="text-sm text-foreground">
                          {preco === null ? 'Preço sob consulta' : formatarCentavos(preco)}
                          {e?.precoOverrideCentavos != null && <span className="text-muted-foreground"> (nesta unidade)</span>}
                        </p>
                      </div>
                      {props.podeEditar && (
                        <Button variant="ghost" size="icon" aria-label={`Ajustar ${i.nome} nesta unidade`} onClick={() => setEditando(i)}>
                          <Pencil aria-hidden="true" className="size-4" />
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}
      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo={editando ? `${editando.nome} nesta unidade` : 'Ajuste da unidade'}
        descricao="Vale só para a unidade escolhida."
      >
        {editando && (
          <ExcecaoForm
            key={`${editando.id}-${unitId}`}
            nomeItem={editando.nome}
            precoBase={editando.precoCentavos}
            temExcecao={edicao !== undefined}
            inicial={{
              itemId: editando.id,
              unitId,
              disponivel: edicao?.disponivel == null ? 'segue' : edicao.disponivel ? 'sim' : 'nao',
              preco: edicao?.precoOverrideCentavos == null ? '' : formatarCentavos(edicao.precoOverrideCentavos),
            }}
            onSalvo={() => setEditando(null)}
          />
        )}
      </FolhaFormulario>
    </div>
  )
}
