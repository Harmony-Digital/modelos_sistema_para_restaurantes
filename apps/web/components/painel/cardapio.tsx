'use client'
import { Pencil, Plus, Search, UtensilsCrossed } from 'lucide-react'
import { useMemo, useState } from 'react'
import { salvarCategoriaAction, salvarItemAction } from '@/app/(painel)/conteudo/cardapio-actions'
import { EmptyState } from '@/components/shell/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatarCentavos } from '@/lib/dinheiro'
import { ROTULO_TAG, type CategoriaForm as ValoresCategoria, type ItemForm as ValoresItem, type TagCardapio } from '@/lib/schemas/cardapio'
import { CategoriaForm } from './categoria-form'
import { FolhaFormulario } from './folha-formulario'
import { ItemForm } from './item-form'

export type CategoriaTela = { id: string; nome: string; ordem: number; ativo: boolean }
export type ItemTela = {
  id: string
  categoryId: string
  nome: string
  descricao: string | null
  precoCentavos: number | null
  tags: string[]
  outrosNomes: string[]
  disponivel: boolean
  ordem: number
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
const rotuloTag = (t: string) => ROTULO_TAG[t as TagCardapio] ?? t

type Edicao =
  | { tipo: 'categoria'; id: string | null; inicial: ValoresCategoria }
  | { tipo: 'item'; id: string | null; inicial: ValoresItem }

export function Cardapio(props: {
  categorias: CategoriaTela[]
  itens: ItemTela[]
  /** Dono ou gerente com acesso a todas as unidades. */
  podeEditar: boolean
  /** Explica por que não há botões de edição (gerente restrito). */
  avisoSemEdicao?: string | undefined
}) {
  const [busca, setBusca] = useState('')
  const [editando, setEditando] = useState<Edicao | null>(null)
  const termo = norm(busca)
  const proximaOrdemItem = props.itens.reduce((m, i) => Math.max(m, i.ordem), 0) + 1
  const proximaOrdemCategoria = props.categorias.reduce((m, c) => Math.max(m, c.ordem), 0) + 1

  const secoes = useMemo(() => {
    const achou = (i: ItemTela) => termo === '' || [i.nome, ...i.outrosNomes].some((n) => norm(n).includes(termo))
    return props.categorias
      .map((c) => ({ categoria: c, itens: props.itens.filter((i) => i.categoryId === c.id && achou(i)) }))
      .filter((s) => termo === '' || s.itens.length > 0)
  }, [props.categorias, props.itens, termo])

  const novoItem = (categoryId: string): Edicao => ({
    tipo: 'item', id: null,
    inicial: { categoryId, nome: '', descricao: '', preco: '', tags: [], outrosNomes: [], disponivel: true, ordem: proximaOrdemItem },
  })

  return (
    <div className="flex flex-col gap-4">
      {props.avisoSemEdicao && <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{props.avisoSemEdicao}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {props.podeEditar && (
          <Button onClick={() => setEditando({ tipo: 'categoria', id: null, inicial: { nome: '', ordem: String(proximaOrdemCategoria), ativo: true } })}>
            <Plus aria-hidden="true" className="size-4" /> Nova categoria
          </Button>
        )}
        {props.podeEditar && props.categorias.length > 0 && (
          <Button variant="outline" onClick={() => setEditando(novoItem(props.categorias[0]!.id))}>
            <Plus aria-hidden="true" className="size-4" /> Novo item
          </Button>
        )}
      </div>
      {props.categorias.length > 0 && (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar item"
            placeholder="Buscar item"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="min-h-11 w-full rounded-md border border-input bg-card pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
      )}
      {props.categorias.length === 0 ? (
        <EmptyState
          icon={UtensilsCrossed}
          title="O cardápio ainda está vazio"
          description={props.podeEditar ? 'Comece criando uma categoria, como “Carnes” ou “Bebidas”, e depois cadastre os itens.' : 'Quando o dono ou o gerente cadastrar o cardápio, ele aparece aqui.'}
        />
      ) : secoes.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">Nenhum item encontrado para “{busca}”.</p>
      ) : (
        secoes.map(({ categoria: c, itens }) => (
          <section key={c.id} aria-labelledby={`cat-${c.id}`} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h2 id={`cat-${c.id}`} className="flex-1 text-base font-semibold text-foreground">
                {c.nome}
                {!c.ativo && <Badge variant="secondary" className="ml-2">Inativa</Badge>}
              </h2>
              {props.podeEditar && (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditando(novoItem(c.id))}>
                    <Plus aria-hidden="true" className="size-4" /> Item
                    <span className="sr-only"> em {c.nome}</span>
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`Editar categoria ${c.nome}`} onClick={() => setEditando({
                    tipo: 'categoria', id: c.id, inicial: { nome: c.nome, ordem: String(c.ordem), ativo: c.ativo },
                  })}>
                    <Pencil aria-hidden="true" className="size-4" />
                  </Button>
                </>
              )}
            </div>
            {itens.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum item nesta categoria.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {itens.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                        {i.nome}
                        {!i.disponivel && <Badge variant="secondary">Indisponível</Badge>}
                      </p>
                      <p className="text-sm text-foreground">{i.precoCentavos === null ? 'Preço sob consulta' : formatarCentavos(i.precoCentavos)}</p>
                      {i.descricao && <p className="mt-1 text-sm text-muted-foreground">{i.descricao}</p>}
                      {i.tags.length > 0 && (
                        <ul aria-label="Etiquetas" className="mt-2 flex flex-wrap gap-1.5">
                          {i.tags.map((t) => <li key={t}><Badge variant="outline">{rotuloTag(t)}</Badge></li>)}
                        </ul>
                      )}
                    </div>
                    {props.podeEditar && (
                      <Button variant="ghost" size="icon" aria-label={`Editar ${i.nome}`} onClick={() => setEditando({
                        tipo: 'item', id: i.id,
                        inicial: {
                          categoryId: i.categoryId, nome: i.nome, descricao: i.descricao ?? '',
                          preco: i.precoCentavos === null ? '' : formatarCentavos(i.precoCentavos),
                          tags: i.tags, outrosNomes: i.outrosNomes,
                          disponivel: i.disponivel, ordem: i.ordem,
                        },
                      })}>
                        <Pencil aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
      <FolhaFormulario
        aberto={editando !== null}
        onAbertoChange={(a) => !a && setEditando(null)}
        titulo={editando?.tipo === 'categoria' ? (editando.id ? 'Editar categoria' : 'Nova categoria') : editando?.id ? 'Editar item' : 'Novo item'}
      >
        {editando?.tipo === 'categoria' && (
          <CategoriaForm
            inicial={editando.inicial}
            rotuloSalvar="Salvar categoria"
            acao={(v) => salvarCategoriaAction(editando.id, v)}
            onSalvo={() => setEditando(null)}
          />
        )}
        {editando?.tipo === 'item' && (
          <ItemForm
            inicial={editando.inicial}
            categorias={props.categorias.map((c) => ({ id: c.id, nome: c.nome }))}
            rotuloSalvar="Salvar item"
            acao={(v) => salvarItemAction(editando.id, v)}
            onSalvo={() => setEditando(null)}
          />
        )}
      </FolhaFormulario>
    </div>
  )
}
