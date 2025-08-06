import { describe, test, expect } from 'bun:test'
import { getSessionNotificationText } from './formatting'

describe('getSessionNotificationText', () => {
  test('returns title when available', () => {
    const session = {
      title: 'My Session Title',
      summary: 'My Session Summary',
      query: 'My raw query text',
    }
    expect(getSessionNotificationText(session)).toBe('My Session Title')
  })

  test('returns summary when title is not available', () => {
    const session = {
      summary: 'My Session Summary',
      query: 'My raw query text',
    }
    expect(getSessionNotificationText(session)).toBe('My Session Summary')
  })

  test('returns query when neither title nor summary is available', () => {
    const session = {
      query: 'My raw query text',
    }
    expect(getSessionNotificationText(session)).toBe('My raw query text')
  })

  test('truncates text to default 40 characters', () => {
    const session = {
      title: 'This is a very long title that should be truncated to exactly 40 characters for display',
      query: 'short query',
    }
    expect(getSessionNotificationText(session)).toBe('This is a very long title that should be')
    expect(getSessionNotificationText(session).length).toBe(40)
  })

  test('truncates text to custom maxLength', () => {
    const session = {
      title: 'This is a title that will be truncated',
      query: 'short query',
    }
    expect(getSessionNotificationText(session, 10)).toBe('This is a ')
    expect(getSessionNotificationText(session, 10).length).toBe(10)
  })

  test('handles empty title and summary', () => {
    const session = {
      title: '',
      summary: '',
      query: 'Fallback to query text',
    }
    expect(getSessionNotificationText(session)).toBe('Fallback to query text')
  })

  test('handles undefined title and summary', () => {
    const session = {
      title: undefined,
      summary: undefined,
      query: 'Fallback to query text',
    }
    expect(getSessionNotificationText(session)).toBe('Fallback to query text')
  })

  test('preserves short text without truncation', () => {
    const session = {
      title: 'Short title',
      query: 'query',
    }
    expect(getSessionNotificationText(session)).toBe('Short title')
  })

  test('handles exactly 40 character text', () => {
    const session = {
      title: '1234567890123456789012345678901234567890', // Exactly 40 chars
      query: 'query',
    }
    expect(getSessionNotificationText(session)).toBe('1234567890123456789012345678901234567890')
    expect(getSessionNotificationText(session).length).toBe(40)
  })

  test('handles text with special characters', () => {
    const session = {
      title: '🚀 Deploy to production! 💻 #urgent-fix',
      query: 'query',
    }
    expect(getSessionNotificationText(session)).toBe('🚀 Deploy to production! 💻 #urgent-fix')
  })

  test('handles text with newlines and tabs', () => {
    const session = {
      title: 'Title with\nnewline and\ttabs',
      query: 'query',
    }
    expect(getSessionNotificationText(session)).toBe('Title with\nnewline and\ttabs')
  })

  test('prioritizes title over summary and query', () => {
    const session = {
      title: 'Title',
      summary: 'Summary should not be used',
      query: 'Query should not be used',
    }
    expect(getSessionNotificationText(session)).toBe('Title')
  })

  test('prioritizes summary over query when no title', () => {
    const session = {
      title: '',
      summary: 'Summary',
      query: 'Query should not be used',
    }
    expect(getSessionNotificationText(session)).toBe('Summary')
  })
})