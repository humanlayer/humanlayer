import { describe, expect, it } from 'vitest'

import { commonDir, formatAgo, formatTokens } from '@/minimalist/lib/format'

describe('commonDir', () => {
	it('finds the shared directory of a set of paths', () => {
		expect(commonDir(['/w/app/README.md', '/w/app/scratch/a.txt'])).toBe('/w/app/')
		expect(commonDir(['/w/app/src/a.ts', '/w/app/src/b.ts'])).toBe('/w/app/src/')
		expect(commonDir(['src/a.ts', 'lib/b.ts'])).toBe('')
		expect(commonDir([])).toBe('')
	})
})

describe('formatAgo', () => {
	it('says just now inside the first minute', () => {
		expect(formatAgo(1_000, 31_000)).toBe('just now')
		expect(formatAgo(0, 5 * 60_000)).toBe('5m ago')
	})
})

describe('formatTokens', () => {
	it('shortens thousands and millions', () => {
		expect(formatTokens(800)).toBe('800')
		expect(formatTokens(42_400)).toBe('42k')
		expect(formatTokens(200_000)).toBe('200k')
		expect(formatTokens(1_000_000)).toBe('1M')
		expect(formatTokens(1_250_000)).toBe('1.3M')
	})
})
