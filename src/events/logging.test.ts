import { afterEach, expect, it, vi } from 'vitest'
import { logError } from './logging'

afterEach(() => vi.restoreAllMocks())

it('retains non-enumerable error details in the serialized log', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = new TypeError('Database request failed')

  logError('RSVP sheet status failed', error)

  expect(JSON.parse(logged.mock.calls[0][0])).toEqual({
    message: 'RSVP sheet status failed',
    error: { name: 'TypeError', message: error.message, stack: error.stack },
  })
})

it('retains the underlying cause through nested error wrappers', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const cause = new Error('SQLITE_BUSY: database is locked')
  const databaseError = new Error('D1_ERROR', { cause })

  logError('Request failed', new Error('Could not load sheet status', { cause: databaseError }))

  expect(JSON.parse(logged.mock.calls[0][0]).error.cause).toEqual({
    name: 'Error', message: databaseError.message, stack: databaseError.stack,
    cause: { name: 'Error', message: cause.message, stack: cause.stack },
  })
})
