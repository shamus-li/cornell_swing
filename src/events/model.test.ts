import { describe, expect, it } from 'vitest'
import { todayInNewYork, validateEvent, validateRSVP } from './model'

const event = { kind: 'special', title: 'Swing dance', date: '2026-10-10', startTime: '18:15', endTime: '22:00', location: 'Willard Straight Hall', description: '**Everyone welcome.**' }

describe('event validation', () => {
  it('accepts markdown and a date with unknown times', () => {
    expect(validateEvent({ ...event, startTime: '', endTime: '' }).description).toBe(event.description)
  })
  it.each([{ date: '2026-02-30' }, { startTime: '24:00' }, { endTime: '17:00' }, { startTime: '', endTime: '22:00' }, { kind: 'other' }, { title: ' ' }])('rejects invalid event fields %s', invalid => {
    expect(() => validateEvent({ ...event, ...invalid })).toThrow()
  })
  it('uses the local New York date across a UTC day boundary', () => {
    expect(todayInNewYork(new Date('2026-10-11T02:00:00Z'))).toBe('2026-10-10')
  })
})

describe('RSVP validation', () => {
  it('normalizes email for duplicate detection', () => {
    expect(validateRSVP({ name: ' Jane Doe ', email: ' Jane@Cornell.edu ' })).toEqual({ name: 'Jane Doe', email: 'jane@cornell.edu' })
  })
  it.each([{ name: '', email: 'jane@cornell.edu' }, { name: 'Jane', email: 'not-email' }, { name: 'Jane\nDoe', email: 'jane@cornell.edu' }])('rejects malformed participant details', value => {
    expect(() => validateRSVP(value)).toThrow()
  })
})
