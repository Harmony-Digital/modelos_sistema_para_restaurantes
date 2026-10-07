import { carregarUnidadesPainel, lerHorarioHumano, modoDemonstracao, REGRAS_RESERVA_PADRAO } from '@atd/db'
import { LogOut } from 'lucide-react'
import { cookies } from 'next/headers'
import { Button } from '@/components/ui/button'
import { HorarioHumano } from '@/components/painel/horario-humano'
import { LogoForm } from '@/components/painel/logo-form'
import { ModoDemonstracao } from '@/components/painel/modo-demonstracao'
import { RegrasReservaForm } from '@/components/painel/regras-reserva-form'
import { RestauranteForm } from '@/components/painel/restaurante-form'
import { TopBar } from '@/components/shell/top-bar'
import { requireStaff } from '@/lib/dal'
import { horarioParaForm, lerHorarioSalvo } from '@/lib/schemas/atendimento'
import { getDb } from '@/lib/server/db'
import { lerRestauranteDoPainel } from '@/lib/server/restaurante'
import { parseTema, THEME_COOKIE } from '@/lib/theme'
import { setTheme, signOut } from '../actions'
import { salvarModoDemonstracaoAction, salvarRegrasReservaAction, salvarRestauranteAction } from './actions'
import { salvarHorarioHumanoAction } from './atendimento-humano/actions'
import { enviarLogoAction, removerLogoAction } from './logo-actions'
import { ThemeForm } from './theme-form'

export const dynamic = 'force-dynamic'

const PAPEL = { dono: 'Dono', gerente: 'Gerente', atendente: 'Atendente' } as const

/** Restaurante, regras da reserva, horário de atendimento humano, modo demonstração, tema e conta (antes em "Mais"). */
export default async function AjustesPage() {
  const session = await requireStaff()
  const db = getDb()
  const dono = session.role === 'dono'
  // restaurante: o dono edita, os demais só veem (como era em "Mais"); modo demonstração: o atendente nem vê
  const gestao = session.role !== 'atendente'
  const [{ restaurante }, demonstracao, horario, marca] = await Promise.all([
    carregarUnidadesPainel(db, session.claims),
    gestao ? modoDemonstracao(db, session.claims) : null,
    // horário humano: só o dono (a Server Action também exige dono)
    dono ? lerHorarioHumano(db, session.claims) : null,
    // logo: dono e gerente enviam, trocam e removem (as Server Actions também exigem); o atendente nem vê
    gestao ? lerRestauranteDoPainel() : null,
  ])
  const tema = parseTema((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <>
      <TopBar title="Ajustes" subtitle={`Você entrou como ${PAPEL[session.role]}`} />
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-6 lg:mx-0 lg:max-w-3xl lg:px-8">
        <section aria-labelledby="restaurante" className="flex flex-col gap-3">
          <h2 id="restaurante" className="text-sm font-medium text-foreground">Restaurante</h2>
          <RestauranteForm
            inicial={{ nome: restaurante.nome, politicaFeriado: restaurante.politicaFeriado, politicaUrl: restaurante.politicaUrl ?? '' }}
            acao={salvarRestauranteAction}
            somenteLeitura={!dono}
          />
          {marca !== null && (
            <LogoForm nome={restaurante.nome} logo={marca.logo} enviar={enviarLogoAction} remover={removerLogoAction} />
          )}
          {demonstracao !== null && (
            <ModoDemonstracao ligado={demonstracao} acao={salvarModoDemonstracaoAction} somenteLeitura={!dono} />
          )}
        </section>
        {gestao && (
          <section aria-labelledby="regras-reserva-titulo" className="flex flex-col gap-3">
            <h2 id="regras-reserva-titulo" className="text-sm font-medium text-foreground">Regras da reserva</h2>
            <RegrasReservaForm inicial={restaurante.regrasReserva} padrao={REGRAS_RESERVA_PADRAO} acao={salvarRegrasReservaAction} />
          </section>
        )}
        {horario !== null && (
          <section id="atendimento-humano" aria-labelledby="atendimento-humano-titulo" className="flex scroll-mt-20 flex-col gap-3">
            <h2 id="atendimento-humano-titulo" className="text-sm font-medium text-foreground">Horário de atendimento humano</h2>
            <p className="text-sm text-muted-foreground">
              Informe os turnos em que a equipe atende (horário de {restaurante.timezone}). Fora deles, a IA avisa o cliente de quando a equipe volta.
              Se não houver nenhum turno, a IA não promete horário.
            </p>
            <HorarioHumano inicial={horarioParaForm(lerHorarioSalvo(horario))} acao={salvarHorarioHumanoAction} />
          </section>
        )}
        <ThemeForm atual={tema} action={setTheme} />
        <section aria-labelledby="conta" className="flex flex-col gap-3">
          <h2 id="conta" className="text-sm font-medium text-foreground">Conta</h2>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full justify-start lg:w-auto"><LogOut aria-hidden="true" className="size-4" /> Sair</Button>
          </form>
        </section>
      </main>
    </>
  )
}
