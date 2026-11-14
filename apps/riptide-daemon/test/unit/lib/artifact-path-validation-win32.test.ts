import path from 'node:path'

import { describe, expect, test, vi } from 'vitest'

// Mock node:path with the win32 implementation so the production functions
// use backslash resolve/sep as they would on Windows.
vi.mock('node:path', async () => {
	const win32: typeof path = await vi.importActual('node:path/win32')
	return { ...win32, default: win32 }
})

// Import AFTER the mock so the production module picks up win32 behavior.
const { isPathWithinBoundary, validateArtifactWritePath } = await import('../../../src/lib/artifact-path-validation')

describe('isPathWithinBoundary - Windows (node:path mocked to win32)', () => {
	const taskDir = String.raw`C:\Users\dev\.humanlayer\tasks\eng-123`

	test('accepts a file inside the task directory', () => {
		const file = String.raw`C:\Users\dev\.humanlayer\tasks\eng-123\file.txt`
		expect(isPathWithinBoundary(file, taskDir)).toBe(true)
	})

	test('accepts a nested file inside the task directory', () => {
		const file = String.raw`C:\Users\dev\.humanlayer\tasks\eng-123\subdir\plan.md`
		expect(isPathWithinBoundary(file, taskDir)).toBe(true)
	})

	test('rejects a file outside the task directory', () => {
		const file = String.raw`C:\Users\dev\.humanlayer\tasks\other-task\file.txt`
		expect(isPathWithinBoundary(file, taskDir)).toBe(false)
	})

	test('rejects a sibling directory with a shared prefix', () => {
		const file = String.raw`C:\Users\dev\.humanlayer\tasks\eng-1234\file.txt`
		expect(isPathWithinBoundary(file, taskDir)).toBe(false)
	})

	test('rejects a traversal escape', () => {
		const file = String.raw`C:\Users\dev\.humanlayer\tasks\eng-123\..\other-task\file.txt`
		expect(isPathWithinBoundary(file, taskDir)).toBe(false)
	})
})

describe('validateArtifactWritePath - Windows (node:path mocked to win32)', () => {
	const taskDir = String.raw`C:\Users\dev\.humanlayer\tasks\eng-123`

	test('accepts a simple filename', () => {
		const result = validateArtifactWritePath('file.txt', taskDir)
		expect(result.valid).toBe(true)
		if (result.valid) {
			expect(result.filePath).toBe(String.raw`C:\Users\dev\.humanlayer\tasks\eng-123\file.txt`)
		}
	})

	test('accepts a nested path', () => {
		const result = validateArtifactWritePath('subdir\\notes.md', taskDir)
		expect(result.valid).toBe(true)
		if (result.valid) {
			expect(result.filePath).toBe(String.raw`C:\Users\dev\.humanlayer\tasks\eng-123\subdir\notes.md`)
		}
	})

	test('rejects a traversal attempt', () => {
		const result = validateArtifactWritePath('..\\..\\..\\secret.txt', taskDir)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain('escapes task directory')
		}
	})
})
