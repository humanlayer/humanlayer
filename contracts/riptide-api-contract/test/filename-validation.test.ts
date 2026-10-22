import { describe, expect, test } from 'vitest'

import { safeFileNameSchema, safeSubpathSchema } from '../src/lib/filename-validation'

describe('safeFileNameSchema', () => {
	describe('rejects path traversal attempts', () => {
		test('rejects raw traversal sequences', () => {
			expect(() => safeFileNameSchema.parse('../foo.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('../../.gitignore')).toThrow()
			expect(() => safeFileNameSchema.parse('../../../.env')).toThrow()
			expect(() => safeFileNameSchema.parse('foo/../bar.txt')).toThrow()
		})

		test('rejects forward slashes', () => {
			expect(() => safeFileNameSchema.parse('foo/bar.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('/absolute/path.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('subdir/file.md')).toThrow()
		})

		test('rejects backslashes', () => {
			expect(() => safeFileNameSchema.parse('foo\\bar.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('..\\..\\file.txt')).toThrow()
		})

		test('rejects URL-encoded traversal', () => {
			expect(() => safeFileNameSchema.parse('%2e%2e%2ffile.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('%2e%2e%5cfile.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('foo%2fbar.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('foo%5cbar.txt')).toThrow()
		})

		test('rejects null bytes', () => {
			expect(() => safeFileNameSchema.parse('foo\0bar.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('foo\x00bar.txt')).toThrow()
			expect(() => safeFileNameSchema.parse('foo%00bar.txt')).toThrow()
		})
	})

	describe('accepts valid filenames', () => {
		test('accepts simple filenames', () => {
			expect(safeFileNameSchema.parse('file.txt')).toBe('file.txt')
			expect(safeFileNameSchema.parse('document.md')).toBe('document.md')
			expect(safeFileNameSchema.parse('README')).toBe('README')
		})

		test('accepts leading dots (hidden files)', () => {
			expect(safeFileNameSchema.parse('.gitignore')).toBe('.gitignore')
			expect(safeFileNameSchema.parse('.env.example')).toBe('.env.example')
		})

		test('accepts multiple dots in filename', () => {
			expect(safeFileNameSchema.parse('file.name.with.dots.txt')).toBe('file.name.with.dots.txt')
			expect(safeFileNameSchema.parse('2026-04-15-plan.md')).toBe('2026-04-15-plan.md')
		})

		test('accepts URL-encoded harmless characters', () => {
			expect(safeFileNameSchema.parse('file%20name.txt')).toBe('file%20name.txt')
			expect(safeFileNameSchema.parse('file%2Bname.txt')).toBe('file%2Bname.txt')
		})

		test('accepts dashes and underscores', () => {
			expect(safeFileNameSchema.parse('my-file_name.txt')).toBe('my-file_name.txt')
			expect(safeFileNameSchema.parse('eng-123-research.md')).toBe('eng-123-research.md')
		})
	})

	describe('enforces length constraints', () => {
		test('rejects empty string', () => {
			expect(() => safeFileNameSchema.parse('')).toThrow()
		})

		test('rejects filenames over 255 characters', () => {
			const longName = 'a'.repeat(256)
			expect(() => safeFileNameSchema.parse(longName)).toThrow()
		})

		test('accepts filename at max length', () => {
			const maxName = 'a'.repeat(255)
			expect(safeFileNameSchema.parse(maxName)).toBe(maxName)
		})
	})
})

describe('safeSubpathSchema', () => {
	describe('rejects unsafe subpaths', () => {
		test('rejects traversal sequences', () => {
			expect(() => safeSubpathSchema.parse('../foo.txt')).toThrow()
			expect(() => safeSubpathSchema.parse('research/../plan.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research/..')).toThrow()
			expect(() => safeSubpathSchema.parse('%2e%2e/research.md')).toThrow()
		})

		test('rejects backslashes and null bytes', () => {
			expect(() => safeSubpathSchema.parse('research\\plan.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research/plan%00.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research/plan\0.md')).toThrow()
		})

		test('rejects absolute paths and invalid segments', () => {
			expect(() => safeSubpathSchema.parse('/absolute/path.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research//plan.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research/./plan.md')).toThrow()
			expect(() => safeSubpathSchema.parse('./research/plan.md')).toThrow()
			expect(() => safeSubpathSchema.parse('research/')).toThrow()
		})
	})

	describe('accepts valid subpaths', () => {
		test('accepts simple filenames and nested paths', () => {
			expect(safeSubpathSchema.parse('plan.md')).toBe('plan.md')
			expect(safeSubpathSchema.parse('research/plan.md')).toBe('research/plan.md')
			expect(safeSubpathSchema.parse('deep/nested/notes.txt')).toBe('deep/nested/notes.txt')
		})

		test('accepts hidden files and encoded harmless characters', () => {
			expect(safeSubpathSchema.parse('.gitignore')).toBe('.gitignore')
			expect(safeSubpathSchema.parse('research/.draft.md')).toBe('research/.draft.md')
			expect(safeSubpathSchema.parse('research/file%20name.md')).toBe('research/file%20name.md')
		})
	})

	describe('enforces length constraints', () => {
		test('rejects empty string', () => {
			expect(() => safeSubpathSchema.parse('')).toThrow()
		})

		test('rejects paths over 1024 characters', () => {
			const longPath = `dir/${'a'.repeat(1021)}`
			expect(() => safeSubpathSchema.parse(longPath)).toThrow()
		})

		test('accepts path at max length', () => {
			const maxPath = `dir/${'a'.repeat(1020)}`
			expect(safeSubpathSchema.parse(maxPath)).toBe(maxPath)
		})
	})
})
