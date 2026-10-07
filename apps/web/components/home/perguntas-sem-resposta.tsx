import { MessageCircleQuestion } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { tituloDaLacuna } from '@/lib/respostas'

export function PerguntasSemResposta(props: { lacunas: { id: string; chave: string; unidade: string | null; ocorrencias: number }[] }) {
  return (
    <section aria-labelledby="titulo-sem-resposta" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 id="titulo-sem-resposta" className="flex items-center gap-2 font-semibold text-foreground">
        <MessageCircleQuestion aria-hidden="true" className="size-4 text-link" /> Perguntas sem resposta
      </h2>
      {props.lacunas.length === 0 ? (
        <p className="text-sm text-muted-foreground">A IA respondeu tudo o que perguntaram. Quando faltar alguma informação, ela aparece aqui.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.lacunas.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{tituloDaLacuna(l.chave)}</p>
                <p className="text-sm text-muted-foreground">{l.unidade ?? 'Todas as unidades'} · {l.ocorrencias === 1 ? '1 vez' : `${l.ocorrencias} vezes`}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button asChild variant="outline" className="self-start">
        <Link href="/conteudo?aba=informacoes">{props.lacunas.length ? 'Responder' : 'Ver respostas'}</Link>
      </Button>
    </section>
  )
}
