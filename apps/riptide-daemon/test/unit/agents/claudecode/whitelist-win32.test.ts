import path from 'node:path'

import { describe, expect, test, vi } from 'vitest'

vi.mock('node:path', async () => {
	const win32: typeof path = await vi.importActual('node:path/win32')
	return { ...win32, default: win32 }
})

vi.mock('node:os', () => ({
	homedir: () => String.raw`C:\Users\dev`,
}))

const { isArtifactPath, isWhitelisted } = await import('../../../../src/agents/claudecode/whitelist')

describe('isArtifactPath - Windows (node:path mocked to win32)', () => {
	const cwd = String.raw`C:\Users\dev\projects\myproject`

	test('matches absolute path in rpi directory', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\projects\myproject\rpi\tasks\foo.md`, cwd)).toBe(true)
	})

	test('matches relative path in rpi directory', () => {
		expect(isArtifactPath('rpi\\tasks\\foo.md', cwd)).toBe(true)
	})

	test('matches absolute path in .humanlayer/tasks directory', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\projects\myproject\.humanlayer\tasks\eng-123\plan.md`, cwd)).toBe(
			true,
		)
	})

	test('matches path in homedir artifacts directory', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\.humanlayer\riptide\artifacts\some-uuid\file.md`, cwd)).toBe(true)
	})

	test('rejects path outside artifact directories', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\projects\myproject\src\index.ts`, cwd)).toBe(false)
	})

	test('rejects sibling prefix (rpi-config)', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\projects\myproject\rpi-config.json`, cwd)).toBe(false)
	})

	test('detects Windows absolute paths with drive letter', () => {
		expect(isArtifactPath(String.raw`C:\Users\dev\projects\myproject\rpi\file.md`, cwd)).toBe(true)
	})
})

describe('isWhitelisted - Windows (node:path mocked to win32)', () => {
	const cwd = String.raw`C:\Users\dev\projects\myproject`

	test('whitelists Read for artifact paths', () => {
		expect(
			isWhitelisted('Read', { file_path: String.raw`C:\Users\dev\projects\myproject\rpi\tasks\foo.md` }, cwd),
		).toBe(true)
	})

	test('whitelists Write for artifact paths', () => {
		expect(isWhitelisted('Write', { file_path: 'rpi\\tasks\\foo.md' }, cwd)).toBe(true)
	})

	test('does not whitelist Read for non-artifact paths', () => {
		expect(
			isWhitelisted('Read', { file_path: String.raw`C:\Users\dev\projects\myproject\src\index.ts` }, cwd),
		).toBe(false)
	})
})
