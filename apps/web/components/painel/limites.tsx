'use client'
import { useRef } from 'react'
import { toast } from 'sonner'
import { emReais, formatarUsd } from '@atd/core/gastos'
import { applyServerErrors, Field, FormError, SubmitButton, TextInput, useZodForm } from '@/components/form'
import { chamarAcao, type ActionResult } from '@/lib/action-result'
import { pctDoLimite, usdParaCampo } from '@/lib/gastos-tela'
import {
  cotacaoSchema, ESCOPOS_GASTO, limiteSchema, NOME_ESCOPO, NOME_PERIODO, PERIODOS_GASTO, type CotacaoForm, type EscopoGasto,
  type LimiteForm, type PeriodoGasto,
} from '@/lib/schemas/gastos'

type Limite = { escopo: EscopoGasto; periodo: PeriodoGasto; limiteUsd: string; alertaPct: number }
type Uso = { hoje: Record<EscopoGasto, string>; mes: Record<EscopoGasto, string> }
type Acoes = {
  salvarLimite: (v: LimiteForm) => Promise<ActionResult<null>>
  salvarCotacao: (v: CotacaoForm) => Promise<ActionResult<null>>
}

const EXPLICACAO: Record<EscopoGasto, string> = {
  ia: 'Respostas da IA aos clientes no WhatsApp.',
  simulacao: 'Conversas de teste no simulador; não afeta os clientes.',
  whatsapp: 'Mensagens enviadas pela API oficial do WhatsApp.',
}
const USADO: Record<PeriodoGasto, string> = { dia: 'Usado hoje', mes: 'Usado no mês' }

/** Guarda síncrona contra duplo envio + toast de sucesso + erros do servidor no formulário. */
function useEnvio() {
  const enviando = useRef(false)
  return async (enviar: () => Promise<ActionResult<null>>, aplicar: (r: ActionResult<null>) => void, ok: string) => {
    if (enviando.current) return
    enviando.current = true
    try {
      const r = await chamarAcao(enviar)
      if (!r.ok) return aplicar(r)
      toast.success(ok)
    } finally {
      enviando.current = false
    }
  }
}

function LimiteLinha(props: { escopo: EscopoGasto; periodo: PeriodoGasto; limite: Limite | undefined; uso: string; cotacao: string; acao: Acoes['salvarLimite']; somenteLeitura?: boolean | undefined }) {
  const { escopo, periodo } = props
  const form = useZodForm(limiteSchema, {
    defaultValues: {
      escopo, periodo, limiteUsd: props.limite ? usdParaCampo(props.limite.limiteUsd) : '', alertaPct: String(props.limite?.alertaPct ?? 80),
    },
  })
  const { errors, isSubmitting } = form.formState
  const enviar = useEnvio()
  const onSubmit = form.handleSubmit(() =>
    enviar(() => props.acao(form.getValues()), (r) => applyServerErrors(form, r), `Limite ${NOME_PERIODO[periodo]} salvo`))
  const id = `${escopo}-${periodo}`
  const pct = props.limite ? ` (${pctDoLimite(props.uso, props.limite.limiteUsd)}%)` : ''
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3">
      <FormError form={form} />
      <p className="text-sm text-muted-foreground tabular-nums">
        {USADO[periodo]}: {formatarUsd(props.uso)} · {emReais(props.uso, props.cotacao)}{pct}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field id={`limite-${id}`} label={`Limite ${NOME_PERIODO[periodo]} (US$)`} error={errors.limiteUsd?.message} required>
          {(a) => <TextInput {...a} inputMode="decimal" autoComplete="off" disabled={props.somenteLeitura} {...form.register('limiteUsd')} />}
        </Field>
        <Field id={`alerta-${id}`} label={`Avisar ${periodo === 'dia' ? 'no dia' : 'no mês'} em (%)`} error={errors.alertaPct?.message} required>
          {(a) => <TextInput {...a} inputMode="numeric" autoComplete="off" disabled={props.somenteLeitura} {...form.register('alertaPct')} />}
        </Field>
      </div>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar limite {NOME_PERIODO[periodo]}</SubmitButton>}
    </form>
  )
}

function Cotacao(props: { cotacao: string; acao: Acoes['salvarCotacao']; somenteLeitura?: boolean | undefined }) {
  const form = useZodForm(cotacaoSchema, { defaultValues: { cotacao: usdParaCampo(props.cotacao) } })
  const { errors, isSubmitting } = form.formState
  const enviar = useEnvio()
  const onSubmit = form.handleSubmit(() => enviar(() => props.acao(form.getValues()), (r) => applyServerErrors(form, r), 'Cotação salva'))
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <FormError form={form} />
      <Field
        id="cotacao"
        label="Cotação do dólar (R$)"
        hint="Só para mostrar os valores em reais. Os limites e a cobrança são em dólar."
        error={errors.cotacao?.message}
        required
      >
        {(a) => <TextInput {...a} inputMode="decimal" autoComplete="off" disabled={props.somenteLeitura} {...form.register('cotacao')} />}
      </Field>
      {!props.somenteLeitura && <SubmitButton pending={isSubmitting}>Salvar cotação</SubmitButton>}
    </form>
  )
}

/** Limites de gasto por tipo (IA, simulação, WhatsApp) e período, com o uso atual e a cotação. Dono edita; gerente só vê. */
export function Limites(props: { limites: Limite[]; uso: Uso; cotacao: string; acoes: Acoes; somenteLeitura?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {props.somenteLeitura && <p className="text-sm text-muted-foreground">Só o dono altera os limites e a cotação.</p>}
      <p className="text-sm text-muted-foreground">
        “Usado” é o que já foi gasto; o aviso de % também conta as respostas em andamento, por isso pode aparecer um pouco antes.
      </p>
      {ESCOPOS_GASTO.map((escopo) => (
        <fieldset key={escopo} aria-label={NOME_ESCOPO[escopo]} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
          <legend className="px-1 font-semibold text-foreground">{NOME_ESCOPO[escopo]}</legend>
          <p className="-mt-2 text-sm text-muted-foreground">{EXPLICACAO[escopo]}</p>
          {PERIODOS_GASTO.map((periodo) => (
            <LimiteLinha
              key={periodo}
              escopo={escopo}
              periodo={periodo}
              limite={props.limites.find((l) => l.escopo === escopo && l.periodo === periodo)}
              uso={(periodo === 'dia' ? props.uso.hoje : props.uso.mes)[escopo]}
              cotacao={props.cotacao}
              acao={props.acoes.salvarLimite}
              somenteLeitura={props.somenteLeitura}
            />
          ))}
        </fieldset>
      ))}
      <Cotacao cotacao={props.cotacao} acao={props.acoes.salvarCotacao} somenteLeitura={props.somenteLeitura} />
    </div>
  )
}
