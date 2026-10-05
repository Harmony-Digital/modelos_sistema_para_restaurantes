export function periodStarts(now: Date, timeZone: string): { dia: string; mes: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)!.value
  const y = get('year')
  const m = get('month')
  return { dia: `${y}-${m}-${get('day')}`, mes: `${y}-${m}-01` }
}
