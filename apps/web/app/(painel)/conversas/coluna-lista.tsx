import Link from 'next/link'
import { acessoInbox, listarInbox, modoDemonstracao } from '@atd/db'
import { AtalhosLista } from '@/components/conversas/atalhos'
import { ControlesAvisos } from '@/components/conversas/avisos'
import { ListaConversas } from '@/components/conversas/lista'
import { Abas } from '@/components/painel/abas'
import { TopBar } from '@/components/shell/top-bar'
import { Button } from '@/components/ui/button'
import { ABAS_INBOX, abaDe } from '@/lib/conversas'
import { requireStaff } from '@/lib/dal'
import { buscaDaLista, colunaLista, hrefLista } from '@/lib/lista-detalhe'
import { getDb } from '@/lib/server/db'

export type BuscaConversas = { aba?: string; unidade?: string; sim?: string; cursor?: string }

const controle =
  'min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/**
 * Coluna da lista de Conversas (slot `@lista`): filtros, avisos e a lista. Com uma conversa aberta, os filtros, as
 * abas e a paginação continuam nela (o detalhe fica aberto ao lado). O tempo real vem do layout do painel (`Avisos`
 * assina a inbox e recarrega a rota inteira, lista e detalhe): esta coluna não assina nada.
 */
export async function ColunaConversas(props: { sp: BuscaConversas; abertaId?: string }) {
  const session = await requireStaff(['dono', 'gerente', 'atendente'])
  const { sp, abertaId } = props
  const aba = abaDe(sp.aba)
  const db = getDb()
  const acesso = await acessoInbox(db, session.claims)
  const unidades = acesso?.unidades ?? []
  // filtro só entre as unidades permitidas; qualquer outro valor é ignorado
  const unidade = unidades.some((u) => u.id === sp.unidade) ? sp.unidade : undefined
  // modo demonstração ligado: as simulações já entram sempre (com o selo) e o filtro some
  const demonstracao = await modoDemonstracao(db, session.claims)
  const sim = !demonstracao && sp.sim === '1'
  const { itens, proximo } = await listarInbox(db, session.claims, {
    aba, simulacoes: sim, ...(unidade && { unitId: unidade }), ...(sp.cursor && { cursor: sp.cursor }),
  })
  const base = abertaId ? `/conversas/${abertaId}` : '/conversas'
  const filtros = { aba, ...(unidade && { unidade }), ...(sim && { sim: '1' }) }
  const comPagina = { ...filtros, ...(sp.cursor && { cursor: sp.cursor }) }
  const href = (extra: { aba?: string; cursor?: string } = {}) => hrefLista(base, { ...filtros, ...extra })
  return (
    <section aria-label="Lista de conversas" className={colunaLista(abertaId !== undefined)}>
      <TopBar title="Conversas" subtitle="Atendimento da equipe pelo WhatsApp" className="lg:hidden" semFaixa />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 lg:mx-0 lg:max-w-none lg:py-4">
        <Abas
          rotulo="Situação das conversas"
          itens={ABAS_INBOX.map((a) => ({ href: href({ aba: a.aba }), rotulo: a.rotulo, ativo: a.aba === aba }))}
        />
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="aba" value={aba} />
          {unidades.length > 1 && (
            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
              Unidade
              <select name="unidade" defaultValue={unidade ?? ''} className={controle}>
                <option value="">Todas as minhas unidades</option>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
          )}
          {!demonstracao && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="sim" value="1" defaultChecked={sim} className="size-5 accent-primary" />
              Mostrar simulações
            </label>
          )}
          {(!demonstracao || unidades.length > 1) && <Button type="submit" variant="outline">Filtrar</Button>}
        </form>
        <ControlesAvisos />
        <ListaConversas itens={itens} aba={aba} meuId={session.userId} abertaId={abertaId} busca={buscaDaLista(comPagina)} />
        {(sp.cursor || proximo) && (
          <nav aria-label="Páginas" className="flex justify-between gap-3">
            {sp.cursor
              ? <Link href={href()} className="inline-flex min-h-11 items-center text-sm font-medium text-link">Voltar ao início</Link>
              : <span />}
            {proximo && <Link href={href({ cursor: proximo })} className="inline-flex min-h-11 items-center text-sm font-medium text-link">Ver mais</Link>}
          </nav>
        )}
      </div>
      <AtalhosLista voltar={hrefLista('/conversas', comPagina)} aberta={abertaId !== undefined} />
    </section>
  )
}
