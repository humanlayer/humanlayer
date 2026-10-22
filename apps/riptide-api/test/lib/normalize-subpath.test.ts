import { describe, expect, test } from 'vitest'

import { normalizeSubpath } from '../../src/lib/normalize-subpath'

describe('normalizeSubpath', () => {
	test('returns valid root-level and nested subpaths unchanged', () => {
		expect(normalizeSubpath('plan.md')).toBe('plan.md')
		expect(normalizeSubpath('research/plan.md')).toBe('research/plan.md')
		expect(normalizeSubpath('deep/nested/notes.txt')).toBe('deep/nested/notes.txt')
	})

	test('preserves harmless encoded characters', () => {
		expect(normalizeSubpath('research/file%20name.md')).toBe('research/file%20name.md')
	})

	test('rejects traversal and malformed paths', () => {
		expect(() => normalizeSubpath('../plan.md')).toThrow()
		expect(() => normalizeSubpath('research/../plan.md')).toThrow()
		expect(() => normalizeSubpath('/absolute/path.md')).toThrow()
		expect(() => normalizeSubpath('research//plan.md')).toThrow()
		expect(() => normalizeSubpath('research\\plan.md')).toThrow()
		expect(() => normalizeSubpath('research%2fplan.md')).toThrow()
	})
})
