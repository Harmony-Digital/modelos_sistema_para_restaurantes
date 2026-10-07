import { expect, test, type Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import { closeSql, entrarComoGestor, getSql } from './helpers'
import { iniciarOpenRouterFalso, type TriagemFalsa } from './openrouter-falso'
import { iniciarWorkerE2e, pararWorkerE2e } from './worker'

const SUFIXO = Date.now().toString(36)
const UNIDADE = `E2E Demo ${SUFIXO}`

type Item = TriagemFalsa['itens'][number]
const vazio = { unidade: UNIDADE, data: null, tema: null, pessoas: null, horario: null }

function triagem(mensagem: string): TriagemFalsa {
  const m = mensagem.toLowerCase()
  // sem hora fixa: um horário de hoje pode já ter passado quando o teste roda (e o aviso seria recusado)
  if (m.startsWith('hoje vou')) {
    return { itens: [{ ...vazio, servico: 'aviso_presenca', tipo: 'registrar', data: 'hoje', pessoas: 4, horario: 'à noite' } as Item], fora_escopo: false }
  }
  if (m.includes('aniversário para 40')) {
    return {
      itens: [{ ...vazio, servico: 'evento', tipo: 'pedido', data: 'amanhã', convidados: 40, tipoEvento: 'aniversário', espaco: null } as Item],
      fora_escopo: false,
    }
  }
  return { itens: [], fora_escopo: true }
}

let worker: ChildProcess | undefined
let falso: Awaited<ReturnType<typeof iniciarOpenRouterFalso>> | undefined
let restaurantId = ''
let unitId = ''

test.beforeAll(async () => {
  const sql = getSql()
  const [r] = await sql`select id from restaurants limit 1`
  restaurantId = r!.id as string
  for (const periodo of ['dia', 'mes']) {
    await sql`insert into budget_limits (restaurant_id, escopo, periodo, limite_usd)
      values (${restaurantId}, 'simulacao', ${periodo}, 5) on conflict do nothing`
  }
  // unidade aberta o dia todo, nos 7 dias: o teste não depende da hora em que roda
  const [u] = await sql`insert into units (restaurant_id, nome, slug, endereco)
    values (${restaurantId}, ${UNIDADE}, ${'e2e-demo-' + SUFIXO}, 'Rua da Demonstração, 1') returning id`
  unitId = u!.id as string
  for (let weekday = 0; weekday < 7; weekday++) {
    await sql`insert into unit_hours (restaurant_id, unit_id, weekday, turno, abre, fecha)
      values (${restaurantId}, ${unitId}, ${weekday}, 1, '00:00', '23:59')`
  }
  falso = await iniciarOpenRouterFalso(triagem)
  worker = await iniciarWorkerE2e(falso.url)
})

test.afterAll(async () => {
  await pararWorkerE2e(worker)
  await falso?.fechar()
  const sql = getSql()
  // as outras specs contam com o isolamento: o modo volta a ficar desligado
  await sql`update restaurants set modo_demonstracao = false where id = ${restaurantId}`
  const doTeste = sql`split_part(cu.wa_id_hash, ':', 2) in (select id::text from auth.users where email like '%@teste.local')`
  await sql`delete from units where nome like 'E2E %'`
  await sql`delete from ai_runs where conversation_id in (
    select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.simulado and ${doTeste})`
  await sql`delete from customers cu where cu.simulado and ${doTeste}`
  await sql`delete from auth.users where email like '%@teste.local'`
  await closeSql()
})

const simulador = (page: Page) => page.getByRole('dialog', { name: 'Simulador de WhatsApp' })

async function abrirSimuladorLimpo(page: Page) {
  await page.getByRole('button', { name: 'Abrir simulador de WhatsApp' }).click()
  await expect(simulador(page)).toBeVisible()
  // espera a ação "Novo cliente" voltar (mesmo cuidado do s1.spec)
  const pedido = page.waitForRequest((r) => r.method() === 'POST' && r.headers()['next-action'] !== undefined && r.postData() === '[]')
  await simulador(page).getByRole('button', { name: 'Novo cliente' }).click()
  await (await pedido).response()
}

async function perguntar(page: Page, texto: string) {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill(texto)
  await page.keyboard.press('Enter')
}

test('modo demonstração: aviso e pedido de evento do simulador aparecem no painel com o selo "Simulação"', async ({ page }) => {
  await entrarComoGestor(page)
  await page.goto('/ajustes')
  const chave = page.getByRole('switch', { name: 'Modo demonstração' })
  await expect(chave).toHaveAttribute('aria-checked', 'false')
  await chave.click()
  await expect(page.getByText('Modo demonstração ligado')).toBeVisible()
  await expect(chave).toHaveAttribute('aria-checked', 'true')

  await abrirSimuladorLimpo(page)
  await perguntar(page, `Hoje vou na ${UNIDADE} com 4 pessoas à noite`)
  await expect(simulador(page).getByText(/^Anotado:/)).toBeVisible({ timeout: 20_000 })
  await perguntar(page, `quero fazer um aniversário para 40 pessoas na ${UNIDADE} dia amanhã`)
  await expect(simulador(page).getByText(/^Recebemos seu pedido/)).toBeVisible({ timeout: 20_000 })

  await page.goto(`/agenda?aba=previsao&unidade=${unitId}`)
  const aviso = page.getByRole('region', { name: UNIDADE }).getByRole('listitem').filter({ hasText: '4 pessoas' })
  await expect(aviso).toContainText('Simulação')

  await page.goto(`/agenda?aba=eventos&unidade=${unitId}`)
  const pedido = page.getByRole('button', { name: /40 convidados/ })
  await expect(pedido).toContainText('Simulação')
  await pedido.click()
  const detalhe = page.getByRole('dialog')
  await expect(detalhe).toContainText('Simulação')
  await expect(detalhe.getByRole('button', { name: /telefone/i })).toHaveCount(0)

  // Conversas: as simuladas entram sem o filtro, que some
  await page.goto('/conversas?aba=ia')
  await expect(page.getByText('Mostrar simulações')).toHaveCount(0)
  await expect(page.getByText('Simulação').first()).toBeVisible()
})
