import { formatEventDate, type EventRecord } from './model'

// Special events are named once, like sweater-weather-swing; weekly lessons repeat, like monday-night-swing-nov-9.
export function baseSlug({ kind, title, date }: Pick<EventRecord, 'kind' | 'title' | 'date'>): string {
  const name = title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event'
  return kind === 'normal' && date ? `${name}-${formatEventDate(date, { month: 'short' }).toLowerCase()}-${Number(date.slice(8))}` : name
}

// Gives the event its current slug, adding the year and then a number if another event already has that one.
// Earlier slugs stay in event_slugs and redirect here.
export async function assignSlug(db: D1Database, id: string, event: Pick<EventRecord, 'kind' | 'title' | 'date'>): Promise<string> {
  const base = baseSlug(event)
  const year = event.date.slice(0, 4)
  for (let attempt = 1; ; attempt++) {
    const slug = attempt === 1 ? base : attempt === 2 && year ? `${base}-${year}` : `${base}-${attempt}`
    const owner = await db.prepare('SELECT eventId FROM event_slugs WHERE slug = ?').bind(slug).first<string>('eventId')
    if (owner && owner !== id) continue
    await db.batch([
      db.prepare('INSERT INTO event_slugs (slug, eventId) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(slug, id),
      db.prepare('UPDATE events SET slug = ? WHERE id = ?').bind(slug, id),
    ])
    return slug
  }
}
