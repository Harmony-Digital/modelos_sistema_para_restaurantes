import Link from 'next/link'
import { carregarUnidadesPainel, lerHorarioHumano } from '@atd/db'
import { HorarioHumano } from '@/components/painel/horario-humano'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { horarioParaForm, lerHorarioSalvo } from '@/lib/schemas/atendimento'
import { getDb } from '@/lib/server/db'
import { salvarHorarioHumanoAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function AtendimentoHumanoPage() {
  const s = await requireStaff(['dono'])
  const [{ restaurante }, cru] = await Promise.all([carregarUnidadesPainel(getDb(), s.claims), lerHorarioHumano(getDb(), s.claims)])
  return (
    <>
      <TopBar title="Atendimento humano" subtitle="Quando a equipe responde" />
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <Link href="/mais" className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-4 hover:underline">Voltar para Mais</Link>
        <p className="text-sm text-muted-foreground">
          Informe os turnos em que a equipe atende (horário de {restaurante.timezone}). Fora deles, a IA avisa o cliente de quando a equipe volta.
          Se não houver nenhum turno, a IA não promete horário.
        </p>
        <HorarioHumano inicial={horarioParaForm(lerHorarioSalvo(cru))} acao={salvarHorarioHumanoAction} />
      </main>
    </>
  )
}
