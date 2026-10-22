import { homedir } from 'node:os'

import { describe, expect, test } from 'vitest'

import {
	extractArtifactSubpath,
	getArtifactSubpathPrefixes,
	isArtifactTrashPath,
} from '../../../src/lib/artifact-subpath'

describe('extractArtifactSubpath', () => {
	const taskDir = '/Users/kyle/projects/myproject/.humanlayer/tasks/eng-123'
	const storageDir = '/Users/kyle/.humanlayer/riptide/artifacts/019-task-id'

	test('extracts a root-level artifact path from the symlink directory', () => {
		expect(extractArtifactSubpath(`${taskDir}/plan.md`, [taskDir, storageDir])).toBe('plan.md')
	})

	test('extracts a nested artifact path from the symlink directory', () => {
		expect(extractArtifactSubpath(`${taskDir}/research/plan.md`, [taskDir, storageDir])).toBe('research/plan.md')
	})

	test('extracts a nested artifact path from the storage directory', () => {
		expect(extractArtifactSubpath(`${storageDir}/research/plan.md`, [taskDir, storageDir])).toBe('research/plan.md')
	})

	test('returns null when the path is outside every task directory prefix', () => {
		expect(extractArtifactSubpath('/Users/kyle/projects/myproject/src/index.ts', [taskDir, storageDir])).toBeNull()
	})

	test('returns null when the path resolves outside the task directory', () => {
		expect(extractArtifactSubpath(`${taskDir}/../other-task/plan.md`, [taskDir, storageDir])).toBeNull()
	})

	test('returns null when given the task directory itself', () => {
		expect(extractArtifactSubpath(taskDir, [taskDir, storageDir])).toBeNull()
	})

	test.each([`${taskDir}/.trash/plan.md`, `${storageDir}/.trash/research.md`])(
		'returns null for a reserved trash path: %s',
		(filePath) => {
			expect(extractArtifactSubpath(filePath, [taskDir, storageDir])).toBeNull()
			expect(isArtifactTrashPath(filePath, [taskDir, storageDir])).toBe(true)
		},
	)

	test.each(['research/.trash/notes.md', '.trash-can/plan.md', 'research/.draft.md', '.gitignore'])(
		'keeps a non-reserved hidden path syncable: %s',
		(subpath) => {
			expect(extractArtifactSubpath(`${taskDir}/${subpath}`, [taskDir, storageDir])).toBe(subpath)
			expect(isArtifactTrashPath(`${taskDir}/${subpath}`, [taskDir, storageDir])).toBe(false)
		},
	)

	test('does not fall through to a broader legacy prefix for a reserved trash path', () => {
		const taskPrefix = '/repo/rpi/tasks/current-task'
		expect(
			extractArtifactSubpath(`${taskPrefix}/.trash/plan.md`, [taskPrefix, '/repo/rpi/tasks', '/repo/rpi']),
		).toBeNull()
	})
})

describe('getArtifactSubpathPrefixes', () => {
	test('includes symlink, storage, legacy task slug path, and legacy tasks root when task slug exists', () => {
		expect(getArtifactSubpathPrefixes('/repo', 'task-uuid', 'eng-123')).toEqual([
			'/repo/.humanlayer/tasks/eng-123',
			`${homedir()}/.humanlayer/riptide/artifacts/task-uuid`,
			'/repo/rpi/tasks/eng-123',
			'/repo/rpi/tasks',
			'/repo/rpi',
		])
	})

	test('omits slug-specific prefixes when task slug is unavailable', () => {
		expect(getArtifactSubpathPrefixes('/repo', 'task-uuid', null)).toEqual([
			`${homedir()}/.humanlayer/riptide/artifacts/task-uuid`,
			'/repo/rpi/tasks',
			'/repo/rpi',
		])
	})
})
