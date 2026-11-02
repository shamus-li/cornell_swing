import { env } from 'cloudflare:workers'
import { beforeAll, expect, it } from 'vitest'
import eventsMigration from '../../migrations/events/0001_events.sql?raw'
import roomMigration from '../../migrations/events/0004_event_room.sql?raw'
import publishedMigration from '../../migrations/events/0005_event_published.sql?raw'
import pricesMigration from '../../migrations/events/0006_event_prices.sql?raw'
import lessonEndMigration from '../../migrations/events/0010_lesson_end.sql?raw'
import socialStartMigration from '../../migrations/events/0018_social_start.sql?raw'
import slugsMigration from '../../migrations/events/0019_event_slugs.sql?raw'
import doorMigration from '../../migrations/events/0020_door_charges.sql?raw'
import { assignSlug } from './slugs'
import worker from './worker'

const origin = 'https://swingsyndicate.club'
const template = '<title>Site</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:url" content=""><meta property="og:image" content="/assets/hero.webp"><div id="root"></div><script id="event-data" type="application/json">null</script>'
const assets = { ...env.ASSETS, fetch: async () => new Response(template, { headers: { 'Content-Type': 'text/html' } }) }
const visit = (slug: string) => worker.fetch(new Request(`${origin}/events/${slug}`, { redirect: 'manual' }), { ...env, ASSETS: assets })
const add = async (id: string, kind: string, title: string, date: string, published = 1) => {
  await env.EVENTS_DB.prepare("INSERT INTO events (id, kind, title, date, startTime, endTime, location, published, updatedAt) VALUES (?, ?, ?, ?, '18:15', '22:00', 'Willard Straight Hall', ?, '')").bind(id, kind, title, date, published).run()
  return assignSlug(env.EVENTS_DB, id, { kind: kind as 'normal' | 'special', title, date })
}

beforeAll(async () => {
  for (const migration of [eventsMigration, roomMigration, publishedMigration, pricesMigration, lessonEndMigration, socialStartMigration, slugsMigration, doorMigration]) await env.EVENTS_DB.exec(migration.replace(/--.*$/gm, '').replaceAll('\n', ' '))
})

it('names events from their titles without clashing', async () => {
  expect(await add('a', 'special', 'The Lindy Haunt 👻', '2099-10-17')).toBe('the-lindy-haunt')
  expect(await add('b', 'special', 'The Lindy Haunt', '2100-10-16')).toBe('the-lindy-haunt-2100')
  expect(await add('c', 'normal', 'Monday Night Swing', '2099-11-09')).toBe('monday-night-swing-nov-9')
})

it('serves a page with link preview tags, and keeps old links working after a rename', async () => {
  await add('d', 'special', 'Sweater Weather Swing', '2099-11-13')
  const page = await (await visit('sweater-weather-swing')).text()
  expect(page).toContain('<title>Sweater Weather Swing · Swing Syndicate at Cornell</title>')
  expect(page).toContain('property="og:title" content="Sweater Weather Swing"')
  expect(page).toContain(`property="og:url" content="${origin}/events/sweater-weather-swing"`)
  expect(page).toContain(`property="og:image" content="${origin}/assets/hero.webp"`)
  expect(page).toContain('name="description" content="Friday, November 13 · 6:15–10:00 PM · Willard Straight Hall"')

  await env.EVENTS_DB.prepare("UPDATE events SET title = 'Winter Warmer' WHERE id = 'd'").run()
  expect(await assignSlug(env.EVENTS_DB, 'd', { kind: 'special', title: 'Winter Warmer', date: '2099-11-13' })).toBe('winter-warmer')
  const moved = await visit('sweater-weather-swing')
  expect(moved.status).toBe(301)
  expect(moved.headers.get('location')).toBe(`${origin}/events/winter-warmer`)
})

it('sends unknown and unpublished events to the events list', async () => {
  await add('e', 'special', 'Secret Draft', '2099-12-01', 0)
  for (const slug of ['secret-draft', 'no-such-event']) expect((await visit(slug)).headers.get('location')).toBe(`${origin}/events`)
})
