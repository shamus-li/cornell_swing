import { describe, expect, it } from 'vitest'
import { formatLessonSchedule, nightSpan, scheduleTitle, todayInNewYork, validateEvent, validateRSVP } from './model'

const event = { kind: 'special', title: 'Swing dance', date: '2026-10-10', startTime: '18:15', endTime: '22:00', location: 'Willard Straight Hall', description: '**Everyone welcome.**', published: true }

describe('event validation', () => {
  it('accepts markdown and a date with unknown times', () => {
    expect(validateEvent({ ...event, startTime: '', endTime: '' }).description).toBe(event.description)
  })
  it.each([{ date: '2026-02-30' }, { startTime: '24:00' }, { endTime: '17:00' }, { startTime: '', endTime: '22:00' }, { kind: 'other' }, { title: ' ' }])('rejects invalid event fields %s', invalid => {
    expect(() => validateEvent({ ...event, ...invalid })).toThrow()
  })
  it('lets a weekly lesson overlap the social dance and drops both times from special events', () => {
    const lesson = { ...event, kind: 'normal', startTime: '20:00', lessonEndTime: '21:00', socialStartTime: '21:00' }
    for (const times of [{ socialStartTime: '20:00' }, { lessonEndTime: '22:00', socialStartTime: '20:00' }, { startTime: '21:00', lessonEndTime: '22:00', socialStartTime: '20:00' }]) {
      expect(validateEvent({ ...lesson, ...times })).toMatchObject(times)
    }
    expect(validateEvent({ ...lesson, kind: 'special' })).toMatchObject({ lessonEndTime: '', socialStartTime: '' })
    for (const [invalid, message] of [
      [{ lessonEndTime: '20:00' }, 'The lesson must end after it starts.'],
      [{ lessonEndTime: '7pm' }, 'Enter a valid lesson end time.'],
      [{ startTime: '', lessonEndTime: '21:00' }, 'Enter when the lesson starts.'],
      [{ socialStartTime: '22:00' }, 'The social dance must end after it starts.'],
      [{ socialStartTime: '9pm' }, 'Enter a valid social dance start time.'],
      [{ socialStartTime: '' }, 'Enter when the social dance starts.'],
      [{ lessonEndTime: '', socialStartTime: '', startTime: '' }, 'Enter when the social dance starts.'],
      [{ lessonEndTime: '', socialStartTime: '', startTime: '22:30' }, 'The social dance must end after it starts.'],
    ] as const) {
      expect(() => validateEvent({ ...lesson, ...invalid })).toThrow(message)
    }
  })
  it('spans the whole night and lists the lesson and social dance by start time', () => {
    const socialFirst = { startTime: '21:00', lessonEndTime: '23:00', socialStartTime: '20:00', endTime: '22:00' }
    expect(nightSpan(socialFirst)).toEqual({ startTime: '20:00', endTime: '23:00' })
    expect(formatLessonSchedule(socialFirst)).toEqual(['Social dance 8:00–10:00 PM', 'Lesson 9:00–11:00 PM'])
  })
  it('uses the local New York date across a UTC day boundary', () => {
    expect(todayInNewYork(new Date('2026-10-11T02:00:00Z'))).toBe('2026-10-10')
  })
})

describe('RSVP validation', () => {
  it('normalizes email for duplicate detection', () => {
    expect(validateRSVP({ name: ' Jane Doe ', email: ' Jane@Cornell.edu ' })).toEqual({ name: 'Jane Doe', email: 'jane@cornell.edu' })
  })
  it.each([{ name: '', email: 'jane@cornell.edu' }, { name: 'Jane', email: 'not-email' }, { name: 'Jane', email: 'jane@cornell' }, { name: 'Jane\nDoe', email: 'jane@cornell.edu' }])('rejects malformed participant details', value => {
    expect(() => validateRSVP(value)).toThrow()
  })
})

describe('scheduleTitle', () => {
  const weeks = [{ kind: 'normal' as const, date: '2026-08-24' }, { kind: 'normal' as const, date: '2026-12-07' }, { kind: 'normal' as const, date: '2027-01-25' }]
  it('names the semester of the next lesson, then the last one', () => {
    expect(scheduleTitle(weeks, '2026-10-01')).toBe('Fall 2026 schedule')
    expect(scheduleTitle(weeks, '2026-12-20')).toBe('Spring 2027 schedule')
    expect(scheduleTitle(weeks, '2027-06-01')).toBe('Spring 2027 schedule')
    expect(scheduleTitle([], '2026-10-01')).toBe('Schedule')
  })
})
