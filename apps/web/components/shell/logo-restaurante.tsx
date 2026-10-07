import { cn } from '@/lib/utils'

/**
 * Logo do restaurante num quadro fixo (32 px; 24 px no topo do celular): `object-contain` encaixa qualquer proporção
 * sem distorcer nem estourar o menu. A URL é pública (bucket `marca`) e externa: `<img>` simples, sem otimização do Next.
 * `decorativa`: o nome já está escrito ao lado, então `alt=""` (sem leitura dupla); sozinha, `alt` com o nome.
 */
export function LogoRestaurante(props: { url: string; nome: string; tamanho?: 32 | 24; decorativa?: boolean; className?: string }) {
  const t = props.tamanho ?? 32
  return (
    <img
      src={props.url}
      alt={props.decorativa ? '' : props.nome}
      width={t}
      height={t}
      decoding="async"
      className={cn('shrink-0 rounded-sm object-contain', t === 32 ? 'size-8' : 'size-6', props.className)}
    />
  )
}
