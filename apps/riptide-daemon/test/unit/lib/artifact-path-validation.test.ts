import { describe, expect, test } from 'vitest'

import { isPathWithinBoundary, validateArtifactWritePath } from '../../../src/lib/artifact-path-validation'

describe('isPathWithinBoundary', () => {
	const taskDir = '/Users/kyle/projects/myproject/.humanlayer/tasks/eng-123'

	test('returns true for paths within boundary', () => {
		expect(isPathWithinBoundary(`${taskDir}/file.txt`, taskDir)).toBe(true)
		expect(isPathWithinBoundary(`${taskDir}/subdir/file.txt`, taskDir)).toBe(true)
		expect(isPathWithinBoundary(`${taskDir}/deep/nested/file.txt`, taskDir)).toBe(true)
	})

	test('returns false for paths outside boundary', () => {
		expect(isPathWithinBoundary('/Users/kyle/projects/myproject/.env', taskDir)).toBe(false)
		expect(isPathWithinBoundary('/Users/kyle/.bashrc', taskDir)).toBe(false)
		expect(isPathWithinBoundary('/etc/passwd', taskDir)).toBe(false)
	})

	test('returns false for traversal escapes', () => {
		// path.join resolves .. segments, so this becomes /Users/kyle/projects/myproject/.humanlayer/tasks/.gitignore
		const escapedPath = '/Users/kyle/projects/myproject/.humanlayer/tasks/.gitignore'
		expect(isPathWithinBoundary(escapedPath, taskDir)).toBe(false)
	})

	test('returns false for sibling task directories', () => {
		const siblingTaskDir = '/Users/kyle/projects/myproject/.humanlayer/tasks/other-task/file.txt'
		expect(isPathWithinBoundary(siblingTaskDir, taskDir)).toBe(false)
	})
})

describe('validateArtifactWritePath', () => {
	const taskDir = '/Users/kyle/projects/myproject/.humanlayer/tasks/eng-123'

	test('accepts valid filenames', () => {
		const result = validateArtifactWritePath('file.txt', taskDir)
		expect(result.valid).toBe(true)
		if (result.valid) {
			expect(result.filePath).toBe(`${taskDir}/file.txt`)
		}
	})

	test('accepts nested paths within task directory', () => {
		const result = validateArtifactWritePath('subdir/file.txt', taskDir)
		expect(result.valid).toBe(true)
		if (result.valid) {
			expect(result.filePath).toBe(`${taskDir}/subdir/file.txt`)
		}
	})

	test('rejects path traversal attempts', () => {
		const result = validateArtifactWritePath('../../../.gitignore', taskDir)
		expect(result.valid).toBe(false)
		if (!result.valid) {
			expect(result.reason).toContain('escapes task directory')
		}
	})

	test('rejects traversal to parent task directory', () => {
		const result = validateArtifactWritePath('../other-task/file.txt', taskDir)
		expect(result.valid).toBe(false)
	})

	test('absolute paths are treated as relative by path.join and land inside boundary', () => {
		// In Node.js/Bun, path.join(base, '/etc/passwd') does NOT replace the base —
		// it yields base + '/etc/passwd', which is safely inside the boundary.
		// This is unlike Python's os.path.join. No escape is possible this way.
		const result = validateArtifactWritePath('/etc/passwd', taskDir)
		expect(result.valid).toBe(true)
		if (result.valid) {
			expect(result.filePath).toBe(`${taskDir}/etc/passwd`)
		}
	})
})
