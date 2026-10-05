import { siWhatsapp } from 'simple-icons'

export function WhatsAppIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={props.className} fill="currentColor">
      <path d={siWhatsapp.path} />
    </svg>
  )
}
