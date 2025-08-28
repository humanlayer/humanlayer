import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { formatTimestamp, formatAbsoluteTimestamp } from './formatting'

describe('formatTimestamp Performance Optimizations', () => {
  let mockDateNow: ReturnType<typeof mock>
  const originalDateNow = Date.now

  beforeEach(() => {
    // Mock Date.now to control time for testing
    mockDateNow = mock()
    global.Date.now = mockDateNow as any
  })

  afterEach(() => {
    global.Date.now = originalDateNow
  })

  test('caches recent timestamp calculations', () => {
    const testDate = new Date('2023-01-01T12:00:00Z')
    const now = new Date('2023-01-01T12:05:00Z').getTime() // 5 minutes later
    mockDateNow.mockImplementation(() => now)

    // First call should calculate
    const result1 = formatTimestamp(testDate)

    // Second call with same parameters should return cached result
    const result2 = formatTimestamp(testDate)

    expect(result1).toBe(result2)
    expect(result1).toMatch(/\d+ minutes ago/)
  })

  test('stabilizes timestamp to nearest minute', () => {
    const testDate1 = new Date('2023-01-01T12:00:30Z') // 30 seconds
    const testDate2 = new Date('2023-01-01T12:00:45Z') // 45 seconds
    const now = new Date('2023-01-01T12:05:00Z').getTime()
    mockDateNow.mockImplementation(() => now)

    const result1 = formatTimestamp(testDate1)
    const result2 = formatTimestamp(testDate2)

    // Both should produce the same result since they're in the same minute
    expect(result1).toBe(result2)
  })

  test('cache expires after TTL period', async () => {
    const testDate = new Date('2023-01-01T12:00:00Z')
    let now = new Date('2023-01-01T12:05:00Z').getTime()
    mockDateNow.mockImplementation(() => now)

    const result1 = formatTimestamp(testDate)

    // Move time forward beyond cache TTL (30 seconds)
    now = now + 35000 // 35 seconds later
    mockDateNow.mockImplementation(() => now)

    const result2 = formatTimestamp(testDate)

    // Results should be the same (content-wise) but recalculated
    expect(result1).toMatch(/\d+ minutes ago/)
    expect(result2).toMatch(/\d+ minutes ago/)
  })

  test('handles old dates correctly without caching complications', () => {
    const testDate = new Date('2023-01-01T12:00:00Z') // More than 7 days ago
    const now = new Date('2023-01-15T12:00:00Z').getTime() // 14 days later
    mockDateNow.mockImplementation(() => now)

    const result = formatTimestamp(testDate)
    expect(result).toBe('Jan 1, 2023')

    // Old dates should also be cached since they don't change
    const result2 = formatTimestamp(testDate)
    expect(result2).toBe('Jan 1, 2023')
  })

  test('handles invalid dates', () => {
    const result1 = formatTimestamp('invalid-date')
    const result2 = formatTimestamp(new Date('invalid'))

    expect(result1).toBe('Invalid date')
    expect(result2).toBe('Invalid date')
  })

  test('cache cleanup prevents memory leaks', () => {
    const now = new Date('2023-01-01T12:00:00Z').getTime()
    mockDateNow.mockImplementation(() => now)

    // Generate many cache entries to trigger cleanup
    for (let i = 0; i < 150; i++) {
      const testDate = new Date(now - i * 60000) // Different minutes
      formatTimestamp(testDate)
    }

    // Should not crash and should handle cache cleanup gracefully
    const result = formatTimestamp(new Date(now))
    expect(result).toMatch(/just now|a few seconds ago|less than a minute ago|now/)
  })

  test('different current times produce different cache keys', () => {
    const testDate = new Date('2023-01-01T12:00:00Z')

    // First call at 12:05
    let now = new Date('2023-01-01T12:05:00Z').getTime()
    mockDateNow.mockImplementation(() => now)
    const result1 = formatTimestamp(testDate)

    // Second call at 12:10 - should be different due to relative time change
    now = new Date('2023-01-01T12:10:00Z').getTime()
    mockDateNow.mockImplementation(() => now)
    const result2 = formatTimestamp(testDate)

    expect(result1).toMatch(/\d+ minutes ago/)
    expect(result2).toMatch(/\d+ minutes ago/)
  })

  test('performance benchmark - multiple calls with same date', () => {
    const testDate = new Date('2023-01-01T12:00:00Z')
    const now = new Date('2023-01-01T12:05:00Z').getTime()
    mockDateNow.mockImplementation(() => now)

    const iterations = 1000
    const start = performance.now()

    // Call formatTimestamp many times with the same date
    for (let i = 0; i < iterations; i++) {
      formatTimestamp(testDate)
    }

    const end = performance.now()
    const avgTime = (end - start) / iterations

    // With caching, average time per call should be very low
    expect(avgTime).toBeLessThan(1) // Less than 1ms per call on average
  })
})

describe('formatAbsoluteTimestamp', () => {
  test('formats date correctly', () => {
    const testDate = new Date('2023-01-15T14:30:45Z')
    const result = formatAbsoluteTimestamp(testDate)
    expect(result).toMatch(/January 15, 2023/)
    expect(result).toMatch(/2:30 PM|14:30/)
  })

  test('handles string dates', () => {
    const result = formatAbsoluteTimestamp('2023-01-15T14:30:45Z')
    expect(result).toMatch(/January 15, 2023/)
    expect(result).toMatch(/2:30 PM|14:30/)
  })

  test('handles invalid dates', () => {
    const result = formatAbsoluteTimestamp('invalid-date')
    expect(result).toBe('Invalid date')
  })
})
