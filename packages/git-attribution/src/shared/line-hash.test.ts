import { describe, expect, test } from 'vitest'

import { buildLineHashSet, hashLine, normalizeLine } from './line-hash'

describe('normalizeLine', () => {
	test('trims and collapses internal whitespace runs to a single space', () => {
		expect(normalizeLine('  const   a =\t1  ')).toBe('const a = 1')
	})

	test('returns null for empty or whitespace-only lines', () => {
		expect(normalizeLine('')).toBeNull()
		expect(normalizeLine('   \t  ')).toBeNull()
	})

	test('two lines differing only in whitespace hash-match', () => {
		const a = normalizeLine('foo   bar')
		const b = normalizeLine('foo bar')
		expect(a).not.toBeNull()
		expect(a).toBe(b)
		expect(hashLine(a as string)).toBe(hashLine(b as string))
	})
})

describe('buildLineHashSet', () => {
	test('splits on newlines, drops trivial lines, and dedupes identical lines', () => {
		const set = buildLineHashSet(['a\n\n  \nb', 'a'])
		expect(set.size).toBe(2) // 'a' (deduped) and 'b'; blank/whitespace lines excluded
		expect(set.has(hashLine('a'))).toBe(true)
		expect(set.has(hashLine('b'))).toBe(true)
	})
})
