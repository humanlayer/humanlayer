import { describe, expect, it } from 'vitest'

import {
	chunkPathArguments,
	isNullBlobId,
	parseGitNumstat,
	parseNulSeparatedPaths,
	parseRawDiff,
} from '../../src/effects/services/task-diff/git-diff-parsers'

const sha1 = (digit: string) => digit.repeat(40)
const sha256 = (digit: string) => digit.repeat(64)
const nullSha1 = sha1('0')

describe('parseRawDiff', () => {
	it('reads status, paths, and both blob IDs from -z output', () => {
		const output = [
			`:100644 100644 ${sha1('a')} ${sha1('b')} M`,
			'src/modified.ts',
			`:000000 100644 ${nullSha1} ${sha1('c')} A`,
			'added file.ts',
			`:100644 000000 ${sha1('d')} ${nullSha1} D`,
			'deleted.ts',
			`:100644 100644 ${sha1('e')} ${sha1('f')} R087`,
			'old/name.ts',
			'new/name.ts',
			`:100644 100755 ${sha1('1')} ${sha1('1')} T`,
			'typechange.sh',
			'',
		].join('\0')

		expect(parseRawDiff(output)).toEqual([
			{ changeType: 'modified', path: 'src/modified.ts', baseBlobId: sha1('a'), currentBlobId: sha1('b') },
			{ changeType: 'added', path: 'added file.ts', baseBlobId: nullSha1, currentBlobId: sha1('c') },
			{ changeType: 'deleted', path: 'deleted.ts', baseBlobId: sha1('d'), currentBlobId: nullSha1 },
			{
				changeType: 'renamed',
				prevPath: 'old/name.ts',
				path: 'new/name.ts',
				baseBlobId: sha1('e'),
				currentBlobId: sha1('f'),
			},
			{ changeType: 'modified', path: 'typechange.sh', baseBlobId: sha1('1'), currentBlobId: sha1('1') },
		])
	})

	it('accepts SHA-256 blob IDs', () => {
		const output = [`:100644 100644 ${sha256('a')} ${sha256('b')} M`, 'file.ts', ''].join('\0')
		expect(parseRawDiff(output)).toEqual([
			{ changeType: 'modified', path: 'file.ts', baseBlobId: sha256('a'), currentBlobId: sha256('b') },
		])
	})

	it('keeps tabs, colons, and newlines in paths', () => {
		const output = [`:100644 100644 ${sha1('a')} ${sha1('b')} M`, 'odd:\tpath\nname.ts', ''].join('\0')
		expect(parseRawDiff(output).map((file) => file.path)).toEqual(['odd:\tpath\nname.ts'])
	})

	it('returns nothing for empty output', () => {
		expect(parseRawDiff('')).toEqual([])
	})
})

describe('parseGitNumstat', () => {
	it('keys renames by destination path and marks binary files', () => {
		const output = ['3\t1\tsrc/a.ts', '-\t-\timage.png', '2\t0\t', 'old.ts', 'new.ts', ''].join('\0')
		const stats = parseGitNumstat(output)
		expect(stats.get('src/a.ts')).toEqual({ additions: 3, deletions: 1, binary: false })
		expect(stats.get('image.png')).toEqual({ additions: 0, deletions: 0, binary: true })
		expect(stats.get('new.ts')).toEqual({ additions: 2, deletions: 0, binary: false })
		expect(stats.has('old.ts')).toBe(false)
	})
})

describe('isNullBlobId', () => {
	it('matches only all-zero IDs', () => {
		expect(isNullBlobId(nullSha1)).toBe(true)
		expect(isNullBlobId(sha256('0'))).toBe(true)
		expect(isNullBlobId(sha1('a'))).toBe(false)
	})
})

describe('parseNulSeparatedPaths', () => {
	it('keeps spaces and newlines inside paths', () => {
		expect(parseNulSeparatedPaths('a b.js\0line\nbreak.js\0')).toEqual(['a b.js', 'line\nbreak.js'])
		expect(parseNulSeparatedPaths('')).toEqual([])
	})
})

describe('chunkPathArguments', () => {
	it('splits by count and by byte size', () => {
		expect(chunkPathArguments(['a', 'b', 'c'], { maxCount: 2, maxBytes: 1000 })).toEqual([['a', 'b'], ['c']])
		expect(chunkPathArguments(['aaaa', 'bbbb', 'cccc'], { maxCount: 10, maxBytes: 10 })).toEqual([
			['aaaa', 'bbbb'],
			['cccc'],
		])
		expect(chunkPathArguments([])).toEqual([])
	})

	it('keeps a path longer than the byte limit in its own chunk', () => {
		expect(chunkPathArguments(['a', 'x'.repeat(20), 'b'], { maxCount: 10, maxBytes: 5 })).toEqual([
			['a'],
			['x'.repeat(20)],
			['b'],
		])
	})
})
