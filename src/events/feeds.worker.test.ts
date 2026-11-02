import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupNetwork } from '@msw/cloudflare'
import { http, HttpResponse } from 'msw'
import eventsMigration from '../../migrations/events/0001_events.sql?raw'
import outsideMigration from '../../migrations/events/0011_outside_events.sql?raw'
import feedsMigration from '../../migrations/events/0014_dance_feeds.sql?raw'
import sourceNoteMigration from '../../migrations/events/0015_outside_source_note.sql?raw'
import stylesMigration from '../../migrations/events/0016_outside_styles.sql?raw'
import cityMigration from '../../migrations/events/0021_outside_city.sql?raw'
import { icsEvents, readFeeds } from './feeds'

const network = setupNetwork()
const ics = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map(event => `BEGIN:VEVENT\r\n${event.trim().replace(/\n\s*/g, '\r\n')}\r\nEND:VEVENT\r\n`).join('')}END:VCALENDAR\r\n`
const swing = `UID:309@ithacaswing.org
  DTSTART;TZID=America/New_York:20991114T181500
  DTEND;TZID=America/New_York:20991114T213000
  SUMMARY:Dance with Djug Django &amp\\; Friends
  URL:https://ithacaswing.org/calendar/dance-with-djug-django/
  LOCATION:TreeHouse Studio\\, 119 S Cayuga St\\, Ithaca \\, NY\\, 14850\\, United
    States`
const campus = (uid: string, club: string, title: string, type = 'Open Event') => `CATEGORIES;X-CG-CATEGORY=club_acronym:${club}
  CATEGORIES;X-CG-CATEGORY=event_type:${type}
  DTSTART:20991115T003000Z
  DTEND:20991115T040000Z
  UID:${uid}
  SUMMARY;ENCODING=QUOTED-PRINTABLE:${title}
  LOCATION: Sign in to download the location
  URL:https://cornell.campusgroups.com/rsvp?id=${uid}`
let campusEvents = [campus('milonga', 'ITHTAN', 'Mistletoe Milonga'), campus('mixer', 'ITHTAN', 'Tango Mixer'), campus('class', 'ITHTAN', 'Tango Class'), campus('private', 'SABORLATINO', 'Sabor Social', 'Private Event'), campus('other', 'GRADSWE', 'Coffee Hour')]

beforeAll(async () => {
  network.enable()
  network.use(
    http.get('https://ithacaswing.org/events.ics', () => new HttpResponse(ics(swing))),
    http.get('https://cornell.campusgroups.com/ical/cornell/ical_cornell.ics', () => new HttpResponse(ics(...campusEvents))),
    http.get('https://www.hands4dancers.org/upcoming-dances', () => HttpResponse.json({ upcoming: [{ id: 'h4', title: 'An evening of Contra  Dancing', startDate: Date.UTC(2099, 10, 21, 0, 0), endDate: Date.UTC(2099, 10, 21, 3, 30), fullUrl: '/upcoming-dances/2099/11/20/contra', location: { addressTitle: 'Lehman Alternative Community School' } }] })),
    http.get('https://example.org/broken.ics', () => new HttpResponse(null, { status: 500 })),
  )
  for (const migration of [eventsMigration, outsideMigration, feedsMigration, sourceNoteMigration, stylesMigration, cityMigration]) await env.EVENTS_DB.exec(migration.replace(/--.*$/gm, '').replaceAll('\n', ' '))
})
afterAll(() => network.disable())

const saved = async () => (await env.EVENTS_DB.prepare('SELECT groupId, title, date, startTime, endTime, venue, styles, url, status FROM outside_events ORDER BY date, title').all()).results

it('reads calendar, Squarespace and CampusGroups feeds into upcoming published events', async () => {
  await readFeeds(env)
  expect(await saved()).toEqual([
    { groupId: 'ithaca-swing-dance-network', title: 'Dance with Djug Django & Friends', date: '2099-11-14', startTime: '18:15', endTime: '21:30', venue: 'TreeHouse Studio, 119 S Cayuga St', styles: '["Swing"]', url: 'https://ithacaswing.org/calendar/dance-with-djug-django/', status: 'published' },
    // 00:30 UTC is 7:30 PM the evening before in Ithaca. Tango Class is skipped by its group's words, Sabor's event is private.
    { groupId: 'tango-at-cornell', title: 'Mistletoe Milonga', date: '2099-11-14', startTime: '19:30', endTime: '23:00', venue: '', styles: '["Tango"]', url: 'https://cornell.campusgroups.com/rsvp?id=milonga', status: 'published' },
    { groupId: 'tango-at-cornell', title: 'Tango Mixer', date: '2099-11-14', startTime: '19:30', endTime: '23:00', venue: '', styles: '["Tango"]', url: 'https://cornell.campusgroups.com/rsvp?id=mixer', status: 'published' },
    { groupId: 'hands-four', title: 'An evening of Contra Dancing', date: '2099-11-20', startTime: '19:00', endTime: '22:30', venue: 'Lehman Alternative Community School', styles: '["Contra"]', url: 'https://www.hands4dancers.org/upcoming-dances/2099/11/20/contra', status: 'published' },
  ])

  // Organizers' choices survive the next reading: a hidden event stays hidden and a typed-in venue is kept.
  await env.EVENTS_DB.prepare("UPDATE outside_events SET status = 'hidden' WHERE groupId = 'hands-four'").run()
  await env.EVENTS_DB.prepare("UPDATE outside_events SET venue = 'Memorial Room' WHERE title = 'Mistletoe Milonga'").run()
  // An upcoming event that leaves its feed is removed.
  campusEvents = campusEvents.filter(event => !event.includes('UID:mixer'))
  await readFeeds(env)
  expect((await saved()).map(event => [event.title, event.venue, event.status])).toEqual([
    ['Dance with Djug Django & Friends', 'TreeHouse Studio, 119 S Cayuga St', 'published'],
    ['Mistletoe Milonga', 'Memorial Room', 'published'],
    ['An evening of Contra Dancing', 'Lehman Alternative Community School', 'hidden'],
  ])
})

it('keeps a failing feed\'s events and records the problem', async () => {
  await env.EVENTS_DB.prepare("UPDATE dance_groups SET feedUrl = 'https://example.org/broken.ics' WHERE id = 'ithaca-swing-dance-network'").run()
  await readFeeds(env, 'ithaca-swing-dance-network')
  expect(await env.EVENTS_DB.prepare("SELECT feedError FROM dance_groups WHERE id = 'ithaca-swing-dance-network'").first('feedError')).toBe('The calendar link returned an error (500).')
  expect((await saved()).filter(event => event.groupId === 'ithaca-swing-dance-network')).toHaveLength(1)
})

it('reads the city from a calendar location, and leaves it to the group when there is none', () => {
  const located = (location: string) => icsEvents(ics(`UID:a\n  DTSTART:20991114T181500\n  SUMMARY:Dance\n  LOCATION:${location}`))[0]
  expect(located('Flynn Hall\\, 1 Main St\\, Rochester\\, NY 14620\\, United States')).toMatchObject({ venue: 'Flynn Hall, 1 Main St', city: 'Rochester' })
  expect(located('Flynn Hall')).toMatchObject({ venue: 'Flynn Hall', city: '' })
})

it('expands weekly series, skipping removed dates and applying changed ones', () => {
  const start = '20991101T203000'
  const series = ics(
    'UID:jam\n  DTSTART;TZID=America/New_York:20260107T203000\n  RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20260205T000000Z\n  EXDATE;TZID=America/New_York:20260121T203000\n  SUMMARY:Lindy Jam',
    'UID:jam\n  RECURRENCE-ID;TZID=America/New_York:20260204T203000\n  DTSTART;TZID=America/New_York:20260205T190000\n  SUMMARY:Lindy Jam moved',
    `UID:gone\n  DTSTART:${start}\n  STATUS:CANCELLED\n  SUMMARY:Cancelled Dance`,
    'UID:monthly\n  DTSTART;TZID=America/New_York:20260107T203000\n  RRULE:FREQ=MONTHLY;BYDAY=2MO\n  SUMMARY:Monthly Dance',
    'UID:packed\n  DTSTART;TZID=America/New_York:20991114T190000\n  SUMMARY:Contra Dance\\, Manlius Village Auditorium\\, Caller: Pamela Goddard\\nMusic: Glenrose',
  )
  expect(icsEvents(series).map(event => [event.sourceId, event.title, event.date, event.startTime])).toEqual([
    ['jam:2026-01-07', 'Lindy Jam', '2026-01-07', '20:30'],
    ['jam:2026-02-04', 'Lindy Jam moved', '2026-02-05', '19:00'],
    ['packed', 'Contra Dance', '2099-11-14', '19:00'],
  ])
})
