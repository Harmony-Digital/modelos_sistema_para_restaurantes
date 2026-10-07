import { carregarUnidadesPainel, lerRetencao, listarPedidosTitular } from '@atd/db'
import { FilaPrivacidade, PrazosRetencao } from '@/components/painel/privacidade'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { getDb } from '@/lib/server/db'
import {
  concluirAcessoAction, concluirCorrecaoAction, excluirTitularAction, gerarResumoAction, negarPedidoAction, revelarTelefoneTitularAction, salvarRetencaoAction,
} from './actions'

export const dynamic = 'force-dynamic'

const ACOES = {
  gerarResumo: gerarResumoAction,
  revelarTelefone: revelarTelefoneTitularAction,
  concluirAcesso: concluirAcessoAction,
  excluir: excluirTitularAction,
  negar: negarPedidoAction,
  concluirCorrecao: concluirCorrecaoAction,
}

// dono e gerente; o atendente é redirecionado pelo requireStaff
export default async function PrivacidadePage() {
  const s = await requireStaff(['dono', 'gerente'])
  const db = getDb()
  const [{ restaurante }, pedidos, retencao] = await Promise.all([
    carregarUnidadesPainel(db, s.claims),
    listarPedidosTitular(db, s.claims, {}),
    lerRetencao(db, s.claims),
  ])
  return (
    <>
      <TopBar title="Privacidade (LGPD)" subtitle="Pedidos dos clientes e prazos de guarda" />
      <main className="mx-auto flex max-w-xl lg:mx-0 lg:max-w-6xl lg:px-8 flex-col gap-8 px-4 py-6">
        <section aria-labelledby="pedidos-titular" className="flex flex-col gap-3">
          <h2 id="pedidos-titular" className="text-sm font-medium text-foreground">Pedidos dos clientes</h2>
          <p className="text-sm text-muted-foreground">
            Pedidos de acesso, correção ou exclusão feitos pelo WhatsApp. O prazo para responder é de 15 dias.
          </p>
          <FilaPrivacidade pedidos={pedidos} agora={new Date()} timeZone={restaurante.timezone} acoes={ACOES} />
        </section>
        <section aria-labelledby="prazos-retencao" className="flex flex-col gap-3">
          <h2 id="prazos-retencao" className="text-sm font-medium text-foreground">Prazos de guarda dos dados</h2>
          <p className="text-sm text-muted-foreground">Todo dia, de madrugada, o que passou do prazo é apagado ou anonimizado.</p>
          <PrazosRetencao itens={retencao} acao={salvarRetencaoAction} somenteLeitura={s.role !== 'dono'} />
        </section>
      </main>
    </>
  )
}
