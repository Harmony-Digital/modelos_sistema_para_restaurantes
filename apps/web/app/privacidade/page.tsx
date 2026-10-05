import { schema } from '@atd/db'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/server/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Política de privacidade' }

export default async function PrivacidadePage() {
  const db = getDb()
  const rows = await db
    .select({ nome: schema.restaurants.nome, dpoNome: schema.restaurants.dpoNome, dpoContato: schema.restaurants.dpoContato })
    .from(schema.restaurants)
    .limit(2)
  if (rows.length === 0) notFound()
  if (rows.length > 1) throw new Error('Esperado exatamente 1 restaurante')
  const r = rows[0]!
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold">Política de privacidade — atendimento por WhatsApp</h1>
      <p><strong>Rascunho sujeito a revisão jurídica.</strong></p>
      <p>
        O atendimento do {r.nome} pelo WhatsApp é feito por um assistente virtual. Tratamos apenas o nome do seu
        perfil, seu número de telefone e o conteúdo da conversa, para responder suas dúvidas, registrar avisos de
        presença e pedidos de evento (art. 7º, V, LGPD) e para dar continuidade ao atendimento (art. 7º, IX).
      </p>
      <p>
        Seu telefone é armazenado cifrado. Antes de qualquer processamento por inteligência artificial, dados como
        CPF, e-mail e telefone são mascarados, e os provedores de IA não podem reter nem usar os dados para
        treinamento. Mensagens de áudio são transcritas e o arquivo é descartado.
      </p>
      <p>
        Prazos de guarda: mensagens por 90 dias; avisos de presença anonimizados 30 dias após a data; pedidos de
        evento anonimizados após 2 anos; cadastro sem interação apagado após 12 meses.
      </p>
      <p>
        Você pode pedir acesso, correção ou exclusão dos seus dados escrevendo no próprio WhatsApp (por exemplo,
        “quero apagar meus dados”). Respondemos em até 15 dias.
      </p>
      <p>Encarregado (DPO): {r.dpoNome ?? 'a definir'} — {r.dpoContato ?? 'contato a definir'}.</p>
    </main>
  )
}
