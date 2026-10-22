import { unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import { describe, expect, test } from 'vitest'

import { normalizePath, validateWorkingDirectory } from '../../src/lib/utils'

describe('normalizePath', () => {
	test('expands ~ at start to home directory', () => {
		const result = normalizePath('~/foo/bar')
		expect(result).toBe(`${homedir()}/foo/bar`)
	})

	test('expands standalone ~ to home directory', () => {
		const result = normalizePath('~')
		expect(result).toBe(homedir())
	})

	test('returns absolute path unchanged', () => {
		const result = normalizePath('/absolute/path')
		expect(result).toBe('/absolute/path')
	})

	test('returns relative path unchanged', () => {
		const result = normalizePath('relative/path')
		expect(result).toBe('relative/path')
	})

	test('does not expand ~ in middle of path', () => {
		const result = normalizePath('/foo/~bar/baz')
		expect(result).toBe('/foo/~bar/baz')
	})
})

describe('validateWorkingDirectory', () => {
	test('returns valid: true for existing directory', async () => {
		// /tmp should exist on all systems
		const result = await validateWorkingDirectory('/tmp')
		expect(result.valid).toBe(true)
		expect(result.error).toBeUndefined()
	})

	test('returns valid: false with error for non-existent path', async () => {
		const result = await validateWorkingDirectory('/nonexistent/path/that/does/not/exist')
		expect(result.valid).toBe(false)
		expect(result.error).toContain('Working directory does not exist')
	})

	test('returns valid: false with error for file path', async () => {
		// Create a temp file to test against
		const tempFile = `/tmp/test-file-${Date.now()}`
		await writeFile(tempFile, 'test')
		try {
			const result = await validateWorkingDirectory(tempFile)
			expect(result.valid).toBe(false)
			expect(result.error).toContain('Path is not a directory')
		} finally {
			await unlink(tempFile)
		}
	})

	test('handles tilde expansion correctly', async () => {
		// Home directory should always exist
		const result = await validateWorkingDirectory('~')
		expect(result.valid).toBe(true)
	})

	test('validates expanded tilde paths', async () => {
		const result = await validateWorkingDirectory('~/nonexistent-dir-12345')
		expect(result.valid).toBe(false)
		expect(result.error).toContain('Working directory does not exist')
	})
})
