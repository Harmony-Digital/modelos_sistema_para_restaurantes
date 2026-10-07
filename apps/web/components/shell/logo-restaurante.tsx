import { cn } from '@/lib/utils'

/**
 * Logo do restaurante num quadro fixo (32 px; 24 px no topo do celular): `object-contain` encaixa qualquer proporção
 * sem distorcer nem estourar o menu. A URL é pública (bucket `marca`) e externa: `<img>` simples, sem otimização do Next.
 */
export function LogoRestaurante(props: { url: string; nome: string; tamanho?: 32 | 24; className?: string }) {
  const t = props.tamanho ?? 32
  return (
    <img
      src={props.url}
      alt={props.nome}
      width={t}
      height={t}
      decoding="async"
      className={cn('shrink-0 rounded-sm object-contain', t === 32 ? 'size-8' : 'size-6', props.className)}
    />
  )
}
