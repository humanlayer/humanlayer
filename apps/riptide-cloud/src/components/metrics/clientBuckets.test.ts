import { describe, expect, it } from 'vitest'

import { bucketNoun, elapsedWeeksInRange, formatBucketLabel, isCompleteBucket, parseLocalDay } from './clientBuckets'

// Replaces the deleted clientWeeks.test.ts. Both functions below changed
// behaviour in the bucket refactor — `isCompleteBucket` gained a bucket size,
// `elapsedWeeksInRange` gained a second bound — so they are worth pinning.

describe('parseLocalDay', () => {
	it('builds the date in LOCAL time, so captions do not shift a day west of Greenwich', () => {
		const day = parseLocalDay('2026-08-03')
		expect(day?.getFullYear()).toBe(2026)
		expect(day?.getMonth()).toBe(7)
		expect(day?.getDate()).toBe(3)
	})

	it('returns null for anything that is not a day key', () => {
		expect(parseLocalDay('2026-8-3')).toBeNull()
		expect(parseLocalDay('nonsense')).toBeNull()
	})
})

describe('formatBucketLabel / bucketNoun', () => {
	it('names a weekly bucket as a week and a daily one as itself', () => {
		expect(formatBucketLabel('2026-07-27')).toBe('Jul 27')
		expect(bucketNoun('2026-07-27', 'week')).toBe('wk of Jul 27')
		expect(bucketNoun('2026-07-27', 'day')).toBe('Jul 27')
	})

	it('falls through unparseable input rather than throwing', () => {
		expect(formatBucketLabel('later')).toBe('later')
	})
})

describe('isCompleteBucket', () => {
	// Monday 2026-08-17, and a "now" of Wednesday the 19th at midday UTC.
	const now = new Date('2026-08-19T12:00:00Z')

	it('measures against the BUCKET size, not always a week', () => {
		expect(isCompleteBucket('2026-08-17', 'week', now)).toBe(false)
		expect(isCompleteBucket('2026-08-17', 'day', now)).toBe(true)
	})

	it('treats the bucket containing now as incomplete', () => {
		expect(isCompleteBucket('2026-08-19', 'day', now)).toBe(false)
	})

	it('honours the client offset, so a week does not complete early', () => {
		// 02:00 UTC on Monday the 17th is still Sunday the 16th in New York
		// (UTC-4, so getTimezoneOffset() = +240 — POSITIVE west). The week of the
		// 10th is over in UTC but not yet for that viewer.
		const mondayEarly = new Date('2026-08-17T02:00:00Z')
		expect(isCompleteBucket('2026-08-10', 'week', mondayEarly, 240)).toBe(false)
		// Ignoring the offset is what would quote it as final a few hours early.
		expect(isCompleteBucket('2026-08-10', 'week', mondayEarly, 0)).toBe(true)
	})

	it('is false for an unparseable key rather than throwing', () => {
		expect(isCompleteBucket('later', 'week', now)).toBe(false)
	})
})

describe('elapsedWeeksInRange', () => {
	it('counts only the part of a running range that has actually happened', () => {
		// Range opened two weeks ago and runs to a future Sunday; only 2 weeks ran.
		const now = new Date('2026-08-19T00:00:00Z')
		expect(elapsedWeeksInRange('2026-08-05', '2026-08-23', now)).toBeCloseTo(2, 5)
	})

	it('gives a finished range its whole width, however long ago it ended', () => {
		// The second bound is what this gained: without it, a range that closed
		// last month would keep growing its divisor and shrink every rate.
		const soon = new Date('2026-08-10T00:00:00Z')
		const later = new Date('2026-09-30T00:00:00Z')
		expect(elapsedWeeksInRange('2026-07-27', '2026-08-09', soon)).toBeCloseTo(2, 5)
		expect(elapsedWeeksInRange('2026-07-27', '2026-08-09', later)).toBeCloseTo(2, 5)
	})

	it('counts the end day in full — `to` is inclusive', () => {
		const now = new Date('2026-09-01T00:00:00Z')
		expect(elapsedWeeksInRange('2026-08-03', '2026-08-09', now)).toBeCloseTo(1, 5)
	})

	it('is null when the range has not started or cannot be parsed', () => {
		expect(elapsedWeeksInRange('2026-08-17', '2026-08-23', new Date('2026-08-01T00:00:00Z'))).toBeNull()
		expect(elapsedWeeksInRange('later', '2026-08-23', new Date())).toBeNull()
	})
})
