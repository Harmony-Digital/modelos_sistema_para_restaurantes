import Link from 'next/link'
import { acessoInbox, listarInbox, modoDemonstracao } from '@atd/db'
import { ControlesAvisos } from '@/components/conversas/avisos'
import { ListaConversas } from '@/components/conversas/lista'
import { Abas } from '@/components/painel/abas'
import { TopBar } from '@/components/shell/top-bar'
import { Button } from '@/components/ui/button'
import { ABAS_INBOX, abaDe } from '@/lib/conversas'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'

type Busca = { aba?: string; unidade?: string; sim?: string; cursor?: string }

const controle =
  'min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function href(p: { aba: string; unidade?: string | undefined; sim?: boolean; cursor?: string }) {
  const q = new URLSearchParams({ aba: p.aba })
  if (p.unidade) q.set('unidade', p.unidade)
  if (p.sim) q.set('sim', '1')
  if (p.cursor) q.set('cursor', p.cursor)
  return `/conversas?${q.toString()}`
}

export default async function ConversasPage(props: { searchParams: Promise<Busca> }) {
  const session = await requireStaff(['dono', 'gerente', 'atendente'])
  const sp = await props.searchParams
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
  return (
    <>
      <TopBar title="Conversas" subtitle="Atendimento da equipe pelo WhatsApp" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Abas
          rotulo="Situação das conversas"
          itens={ABAS_INBOX.map((a) => ({ href: href({ aba: a.aba, unidade, sim }), rotulo: a.rotulo, ativo: a.aba === aba }))}
        />
        <form method="get" action="/conversas" className="flex flex-wrap items-end gap-3">
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
        <ListaConversas itens={itens} aba={aba} meuId={session.userId} />
        {(sp.cursor || proximo) && (
          <nav aria-label="Páginas" className="flex justify-between gap-3">
            {sp.cursor
              ? <Link href={href({ aba, unidade, sim })} className="inline-flex min-h-11 items-center text-sm font-medium text-link">Voltar ao início</Link>
              : <span />}
            {proximo && <Link href={href({ aba, unidade, sim, cursor: proximo })} className="inline-flex min-h-11 items-center text-sm font-medium text-link">Ver mais</Link>}
          </nav>
        )}
      </main>
    </>
  )
}
