import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import {
	getOperationType,
	getTaskArtifactPathsFromApplyPatch,
	isApplyPatchTool,
	isEditTool,
	isReadTool,
	isTextFile,
	isWriteTool,
	scanTaskArtifactDirectory,
} from '../../../src/lib/artifact-sync-utils'
import { createUniqueTempDir } from '../../helpers/concurrency'

describe('artifact file classification', () => {
	test.each([
		'artifact.md',
		'artifact.mdx',
		'artifact.txt',
		'artifact.json',
		'artifact.jsonl',
		'ARTIFACT.JSON',
		'ARTIFACT.JSONL',
	])('classifies %s as text', (fileName) => {
		expect(isTextFile(fileName)).toBe(true)
	})

	test.each(['artifact.png', 'artifact.pdf', 'artifact.json.gz'])('classifies %s as binary', (fileName) => {
		expect(isTextFile(fileName)).toBe(false)
	})
})

describe('tool name normalization', () => {
	test.each(['Read', 'read'])('recognizes %s as read', (toolName) => {
		expect(isReadTool(toolName)).toBe(true)
		expect(getOperationType(toolName)).toBe('Read')
	})

	test.each(['Write', 'write'])('recognizes %s as write', (toolName) => {
		expect(isWriteTool(toolName)).toBe(true)
		expect(getOperationType(toolName)).toBe('Write')
	})

	test.each(['Edit', 'edit', 'MultiEdit', 'multi_edit', 'apply_patch', 'apply-patch'])(
		'recognizes %s as edit family',
		(toolName) => {
			expect(isEditTool(toolName)).toBe(true)
			expect(getOperationType(toolName)).toBe('Edit')
		},
	)

	test.each(['apply_patch', 'apply-patch'])('recognizes %s as apply_patch', (toolName) => {
		expect(isApplyPatchTool(toolName)).toBe(true)
	})

	test('returns undefined for non-file tools', () => {
		expect(getOperationType('functions.agent')).toBeUndefined()
	})
})

describe('getTaskArtifactPathsFromApplyPatch', () => {
	test('returns only files under the current task artifact directory', () => {
		const cwd = '/repo'
		const taskSlug = 'core-1025-task'
		const toolInput = {
			patch_text: `*** Begin Patch
*** Update File: src/index.ts
@@
-old
+new
*** Update File: .humanlayer/tasks/core-1025-task/research.md
@@
-draft
+updated
*** Update File: .humanlayer/tasks/other-task/plan.md
@@
-old
+new
*** End Patch`,
		}

		expect(getTaskArtifactPathsFromApplyPatch(toolInput, cwd, taskSlug)).toEqual([
			'/repo/.humanlayer/tasks/core-1025-task/research.md',
		])
	})

	test('extracts add and update patch shapes seen in local conversation_events', () => {
		const cwd = '/repo'
		const addToolInput = {
			patch_text: `*** Begin Patch
*** Add File: .humanlayer/tasks/comments-test/poem.md
+At dawn the keys awake in rows,
+Soft thunder under careful hands;
*** End Patch`,
		}
		const updateToolInput = {
			patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/comments-test/poem.md
@@
-The bugs are small, but bright and sly,
+The rough edges whisper, then recede,
*** End Patch`,
		}

		expect(getTaskArtifactPathsFromApplyPatch(addToolInput, cwd, 'comments-test')).toEqual([
			'/repo/.humanlayer/tasks/comments-test/poem.md',
		])
		expect(getTaskArtifactPathsFromApplyPatch(updateToolInput, cwd, 'comments-test')).toEqual([
			'/repo/.humanlayer/tasks/comments-test/poem.md',
		])
	})

	test('uses move destination for renamed artifact files', () => {
		const cwd = '/repo'
		const taskSlug = 'core-1025-task'
		const toolInput = {
			patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/core-1025-task/old-plan.md
*** Move to: .humanlayer/tasks/core-1025-task/new-plan.md
@@
-old
+new
*** End Patch`,
		}

		expect(getTaskArtifactPathsFromApplyPatch(toolInput, cwd, taskSlug)).toEqual([
			'/repo/.humanlayer/tasks/core-1025-task/new-plan.md',
		])
	})

	test('excludes files in the task trash root', () => {
		const cwd = '/repo'
		const taskSlug = 'core-1025-task'
		const toolInput = {
			patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/core-1025-task/.trash/plan.md
@@
-old
+new
*** End Patch`,
		}

		expect(getTaskArtifactPathsFromApplyPatch(toolInput, cwd, taskSlug)).toEqual([])
	})
})

describe('scanTaskArtifactDirectory', () => {
	test('skips the task trash root but keeps nested user-owned trash directories', async () => {
		const cwd = await createUniqueTempDir('artifact-scan-trash-test')
		const taskSlug = 'scan-task'
		const taskDir = join(cwd, '.humanlayer', 'tasks', taskSlug)
		try {
			await mkdir(join(taskDir, '.trash'), { recursive: true })
			await mkdir(join(taskDir, 'research', '.trash'), { recursive: true })
			await writeFile(join(taskDir, 'plan.md'), '# Plan')
			await writeFile(join(taskDir, '.trash', 'deleted.md'), '# Deleted')
			await writeFile(join(taskDir, 'research', '.trash', 'notes.md'), '# Notes')

			const paths = await scanTaskArtifactDirectory(cwd, taskSlug)

			expect(paths.sort()).toEqual(
				[join(taskDir, 'plan.md'), join(taskDir, 'research', '.trash', 'notes.md')].sort(),
			)
		} finally {
			await rm(cwd, { recursive: true, force: true })
		}
	})
})
