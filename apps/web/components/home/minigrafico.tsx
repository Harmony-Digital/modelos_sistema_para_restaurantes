import { pontosDoGrafico } from '@/lib/inicio'
import { cn } from '@/lib/utils'

const LARGURA = 100
const ALTURA = 24

/**
 * Mini-gráfico (sparkline) dos últimos dias em SVG simples, na cor de link. O leitor de tela recebe a descrição com
 * os valores (`rotulos`, já formatados); o traço não muda de espessura ao esticar.
 */
export function Minigrafico(props: { valores: readonly number[]; rotulos: readonly string[]; descricao: string; className?: string }) {
  if (props.valores.length === 0) return null
  const pontos = pontosDoGrafico(props.valores, LARGURA, ALTURA)
  const [x, y] = pontos.split(' ').at(-1)!.split(',')
  return (
    <svg
      role="img"
      aria-label={`${props.descricao}: ${props.rotulos.join(', ')}`}
      viewBox={`-2 -2 ${LARGURA + 4} ${ALTURA + 4}`}
      preserveAspectRatio="none"
      className={cn('h-6 w-full overflow-visible text-link', props.className)}
    >
      <polyline
        points={pontos}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x} cy={y} r={1.5} fill="currentColor" />
    </svg>
  )
}
