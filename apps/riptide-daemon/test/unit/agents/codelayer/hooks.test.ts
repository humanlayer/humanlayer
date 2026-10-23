import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { hash } from 'ohash'
import { describe, expect, test, vi } from 'vitest'

import type { ISyncManager } from '@/lib/sync-service'

import type { HookServices } from '../../../../src/agents/claudecode/types'
import {
	createCodelayerArtifactReadSyncHook,
	createCodelayerArtifactSyncHook,
} from '../../../../src/agents/codelayer/hooks'
import { createUniqueTempDir } from '../../../helpers/concurrency'

const sessionId = 'test-session-id'
const taskSlug = 'core-1025-task'
type UpsertArtifactInput = Parameters<ISyncManager['upsertArtifact']>[0]
type MockSyncManager = ISyncManager & { calls: UpsertArtifactInput[] }
type TestToolOutput =
	| string
	| { type: 'content'; value: Array<{ type: 'image-data'; data: string; mediaType: string }> }

function createMockSyncManager(upsertArtifact?: ISyncManager['upsertArtifact']): MockSyncManager {
	const calls: UpsertArtifactInput[] = []
	return {
		calls,
		upsertArtifact: async (input) => {
			calls.push(input)
			return upsertArtifact?.(input) ?? { artifactId: `artifact-${calls.length}` }
		},
		uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
		getCollection: () => undefined,
	}
}

function createNoopServices(): HookServices {
	return {
		orpc: {
			integrations: {
				jira: { createRemoteLink: vi.fn(() => Promise.resolve({ created: true })) },
				linear: { createAttachment: vi.fn(() => Promise.resolve({ created: true })) },
			},
		} as unknown as HookServices['orpc'],
	}
}

async function withCodelayerHookTest<T>(
	fn: (ctx: {
		testDir: string
		hook: ReturnType<typeof createCodelayerArtifactSyncHook>
		manager: MockSyncManager
	}) => Promise<T>,
	manager: MockSyncManager = createMockSyncManager(),
): Promise<T> {
	const testDir = await createUniqueTempDir('codelayer-artifact-sync-hook-test')
	await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug), { recursive: true })

	try {
		const hook = createCodelayerArtifactSyncHook(
			manager,
			sessionId,
			testDir,
			'task-uuid',
			taskSlug,
			null,
			null,
			createNoopServices(),
		)
		return await fn({ testDir, hook, manager })
	} finally {
		await rm(testDir, { recursive: true, force: true })
	}
}

async function withCodelayerReadHookTest<T>(
	fn: (ctx: {
		testDir: string
		hook: ReturnType<typeof createCodelayerArtifactReadSyncHook>
		manager: MockSyncManager
	}) => Promise<T>,
	manager: MockSyncManager = createMockSyncManager(),
): Promise<T> {
	const testDir = await createUniqueTempDir('codelayer-artifact-read-sync-hook-test')
	await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug), { recursive: true })

	try {
		const hook = createCodelayerArtifactReadSyncHook(manager, sessionId, testDir, 'task-uuid', taskSlug)
		return await fn({ testDir, hook, manager })
	} finally {
		await rm(testDir, { recursive: true, force: true })
	}
}

function createCtx(toolName: string, input: Record<string, unknown>, output: TestToolOutput = 'patched output') {
	const hookState: Record<string, unknown> = {}
	return {
		toolName,
		toolCallId: 'tool-call-1',
		input,
		output,
		rawOutput: output,
		tool: { name: toolName, inputSchema: {} as any },
		getContextWindow: () => [],
		getState: <T>(key: string): T | undefined => hookState[key] as T | undefined,
		updateState: <T>(key: string, updater: (current: T | undefined) => T): void => {
			hookState[key] = updater(hookState[key] as T | undefined)
		},
		done: (result?: string) => ({ type: 'done' as const, ...(result ? { mutatedResult: result } : {}) }),
	}
}

describe('createCodelayerArtifactSyncHook', () => {
	test.each(['write', 'edit'])('reports and skips a %s in the task trash root', async (toolName) => {
		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const trashDir = join(testDir, '.humanlayer', 'tasks', taskSlug, '.trash')
			const artifactPath = join(trashDir, 'plan.md')
			await mkdir(trashDir, { recursive: true })
			await writeFile(artifactPath, '# Deleted plan')

			const result = await hook(
				createCtx(toolName, {
					file_path: artifactPath,
					...(toolName === 'write' ? { content: '# Deleted plan' } : {}),
				}),
			)

			expect(manager.calls).toHaveLength(0)
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test.each(['bash', 'shell'])('uploads files a %s command left in the task directory', async (toolName) => {
		const manager = createMockSyncManager()
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		manager.uploadS3Artifact = uploadS3Artifact

		await withCodelayerHookTest(async ({ testDir, hook }) => {
			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			await writeFile(join(taskDir, 'shot.png'), Buffer.from([1, 2, 3]))
			await writeFile(join(taskDir, 'notes.md'), '# notes')

			const result = await hook(createCtx(toolName, { command: 'cp /tmp/shot.png .' }))

			expect(uploadS3Artifact).toHaveBeenCalledTimes(1)
			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({ fileName: 'notes.md', content: '# notes', operationType: 'Write' })
			expect(result.mutatedResult).toEqual(expect.any(String))
		}, manager)
	})

	test('reports nothing when a shell command changed no task files', async () => {
		await withCodelayerHookTest(async ({ hook, manager }) => {
			const result = await hook(createCtx('bash', { command: 'ls' }))
			expect(manager.calls).toHaveLength(0)
			expect(result.mutatedResult).toBeUndefined()
		})
	})

	test.each([
		['data.json', '{"enabled":true}'],
		['events.jsonl', '{"event":1}\n{"event":2}\n'],
	])('syncs %s writes through text upsert', async (fileName, content) => {
		const manager = createMockSyncManager()
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		manager.uploadS3Artifact = uploadS3Artifact

		await withCodelayerHookTest(async ({ testDir, hook }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, fileName)
			await hook(createCtx('write', { file_path: artifactPath, content }))

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({ fileName, content, operationType: 'Write' })
			expect(uploadS3Artifact).not.toHaveBeenCalled()
		}, manager)
	})

	test.each([
		['data.json', '{\n  "edited": true\n}\n'],
		['events.jsonl', '{"edited":true}\n{"kept":true}\n'],
	])('syncs %s edits through text upsert', async (fileName, content) => {
		const manager = createMockSyncManager()
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		manager.uploadS3Artifact = uploadS3Artifact

		await withCodelayerHookTest(async ({ testDir, hook }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, fileName)
			await writeFile(artifactPath, content)
			await hook(createCtx('edit', { file_path: artifactPath, old_string: 'false', new_string: 'true' }))

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({ fileName, content, operationType: 'Edit' })
			expect(uploadS3Artifact).not.toHaveBeenCalled()
		}, manager)
	})

	test('syncs JSON and JSONL apply_patch files through text upsert', async () => {
		const manager = createMockSyncManager()
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		manager.uploadS3Artifact = uploadS3Artifact

		await withCodelayerHookTest(async ({ testDir, hook }) => {
			const jsonContent = '{"patched":true}\n'
			const jsonlContent = '{"record":1}\n{"record":2}\n'
			await writeFile(join(testDir, '.humanlayer', 'tasks', taskSlug, 'patched.json'), jsonContent)
			await writeFile(join(testDir, '.humanlayer', 'tasks', taskSlug, 'patched.jsonl'), jsonlContent)

			await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/${taskSlug}/patched.json
@@
-{"patched":false}
+{"patched":true}
*** Update File: .humanlayer/tasks/${taskSlug}/patched.jsonl
@@
-{"record":0}
+{"record":2}
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(2)
			expect(manager.calls).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ fileName: 'patched.json', content: jsonContent, operationType: 'Edit' }),
					expect.objectContaining({
						fileName: 'patched.jsonl',
						content: jsonlContent,
						operationType: 'Edit',
					}),
				]),
			)
			expect(uploadS3Artifact).not.toHaveBeenCalled()
		}, manager)
	})

	test('adds resolved design template instruction when write upsert reports design questions resolved', async () => {
		const upsertArtifact = vi.fn(async (input: UpsertArtifactInput) => {
			expect(input).toMatchObject({
				fileName: 'design.md',
				frontmatter: { type: 'design-discussion' },
				operationType: 'Write',
			})

			return {
				artifactId: 'artifact-with-resolved-design-questions',
				designQuestionsResolved: true,
			}
		})

		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'design.md')
			const result = await hook(
				createCtx('write', {
					file_path: artifactPath,
					content: `---
type: design-discussion
---

# Design Discussion
`,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(upsertArtifact).toHaveBeenCalled()
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		}, createMockSyncManager(upsertArtifact))
	})

	test('does not add resolved design template instruction when write upsert reports open design questions', async () => {
		const upsertArtifact = vi.fn(async (input: UpsertArtifactInput) => {
			expect(input).toMatchObject({
				fileName: 'design.md',
				frontmatter: { type: 'design-discussion' },
				operationType: 'Write',
			})

			return {
				artifactId: 'artifact-with-open-design-questions',
				designQuestionsResolved: false,
			}
		})

		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'design.md')
			const result = await hook(
				createCtx('write', {
					file_path: artifactPath,
					content: `---
type: design-discussion
---

# Design Discussion
`,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(upsertArtifact).toHaveBeenCalled()
			expect(result.type).toBe('done')
		}, createMockSyncManager(upsertArtifact))
	})

	test('does not add resolved design template instruction for interactive PRD and TDD documents', async () => {
		const upsertArtifact = vi.fn(async () => ({
			artifactId: 'artifact-with-interactive-question-doc',
			designQuestionsResolved: true,
		}))

		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const prdPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'prd.md')
			const tddPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'tdd.md')

			const prdResult = await hook(
				createCtx('write', {
					file_path: prdPath,
					content: `---
type: design-prd
---

# PRD
`,
				}),
			)
			const tddResult = await hook(
				createCtx('write', {
					file_path: tddPath,
					content: `---
type: design-tdd
---

# TDD
`,
				}),
			)

			expect(manager.calls).toHaveLength(2)
			expect(manager.calls[0]?.frontmatter).toMatchObject({ type: 'design-prd' })
			expect(manager.calls[1]?.frontmatter).toMatchObject({ type: 'design-tdd' })
			expect(prdResult.type).toBe('done')
			expect(tddResult.type).toBe('done')
			expect(prdResult.mutatedResult).toEqual(expect.any(String))
			expect(tddResult.mutatedResult).toEqual(expect.any(String))
		}, createMockSyncManager(upsertArtifact))
	})

	test('adds resolved design template instruction when edit upsert reports design questions resolved', async () => {
		const upsertArtifact = vi.fn(async (input: UpsertArtifactInput) => {
			expect(input).toMatchObject({
				fileName: 'design.md',
				frontmatter: { type: 'design-discussion' },
				operationType: 'Edit',
			})

			return {
				artifactId: 'artifact-with-resolved-design-questions',
				designQuestionsResolved: true,
			}
		})

		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'design.md')
			await writeFile(
				artifactPath,
				`---
type: design-discussion
---

# Design

Question content is not inferred by this daemon hook.`,
			)

			const result = await hook(
				createCtx('edit', {
					file_path: artifactPath,
					old_string: 'questions resolved',
					new_string: 'questions resolved',
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(upsertArtifact).toHaveBeenCalled()
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		}, createMockSyncManager(upsertArtifact))
	})

	test('adds resolved design template instruction when read upsert reports design questions resolved', async () => {
		const upsertArtifact = vi.fn(async (input: UpsertArtifactInput) => {
			expect(input).toMatchObject({
				fileName: 'design.md',
				frontmatter: { type: 'design-discussion' },
				operationType: 'Read',
			})

			return {
				artifactId: 'artifact-with-resolved-design-questions',
				designQuestionsResolved: true,
			}
		})

		await withCodelayerReadHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'design.md')
			await writeFile(
				artifactPath,
				`---
type: design-discussion
---

# Design

Question content is not inferred by this daemon hook.`,
			)

			const result = await hook(
				createCtx('read', {
					file_path: artifactPath,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(upsertArtifact).toHaveBeenCalled()
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		}, createMockSyncManager(upsertArtifact))
	})

	test('adds resolved design template instruction when apply_patch upsert reports design questions resolved', async () => {
		const upsertArtifact = vi.fn(async (input: UpsertArtifactInput) => {
			expect(input).toMatchObject({
				fileName: 'design.md',
				frontmatter: { type: 'design-discussion' },
				operationType: 'Edit',
			})

			return {
				artifactId: 'artifact-with-resolved-design-questions',
				designQuestionsResolved: true,
			}
		})

		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'design.md')
			await writeFile(
				artifactPath,
				`---
type: design-discussion
---

# Design

Question content is not inferred by this daemon hook.`,
			)

			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/${taskSlug}/design.md
@@
-Questions open.
+Question content changed.
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(upsertArtifact).toHaveBeenCalled()
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		}, createMockSyncManager(upsertArtifact))
	})

	test('apply_patch preserves nested artifact subpaths', async () => {
		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'drafts', 'poem.md')
			await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug, 'drafts'), { recursive: true })
			await writeFile(artifactPath, 'At dawn the keys awake in rows,\nSoft thunder under careful hands;')

			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Add File: .humanlayer/tasks/${taskSlug}/drafts/poem.md
+At dawn the keys awake in rows,
+Soft thunder under careful hands;
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({
				fileName: 'drafts/poem.md',
				content: 'At dawn the keys awake in rows,\nSoft thunder under careful hands;',
				operationType: 'Edit',
			})
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test('apply_patch syncs only current task artifacts mentioned in patch text', async () => {
		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'research', 'research.md')
			const secondArtifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'plans', 'plan.md')
			await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug, 'research'), { recursive: true })
			await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug, 'plans'), { recursive: true })
			await writeFile(artifactPath, '# Research')
			await writeFile(secondArtifactPath, '# Plan')

			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: src/index.ts
@@
-old
+new
*** Update File: .humanlayer/tasks/${taskSlug}/research/research.md
@@
-draft
+final
*** Update File: .humanlayer/tasks/${taskSlug}/plans/plan.md
@@
-draft
+final
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(2)
			expect(manager.calls.map((call) => call.fileName).sort()).toEqual(['plans/plan.md', 'research/research.md'])
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test('apply_patch handles update-file payload shapes seen in local conversation_events', async () => {
		await withCodelayerHookTest(async ({ testDir, hook, manager }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'drafts', 'poem.md')
			await mkdir(join(testDir, '.humanlayer', 'tasks', taskSlug, 'drafts'), { recursive: true })
			await writeFile(artifactPath, 'The rough edges whisper, then recede,')

			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/${taskSlug}/drafts/poem.md
@@
-The bugs are small, but bright and sly,
+The rough edges whisper, then recede,
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({
				fileName: 'drafts/poem.md',
				content: 'The rough edges whisper, then recede,',
				operationType: 'Edit',
			})
			expect(result.type).toBe('done')
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test('apply_patch skips sync when patch does not touch current task artifacts', async () => {
		await withCodelayerHookTest(async ({ hook, manager }) => {
			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: src/index.ts
@@
-old
+new
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(0)
			expect(result).toEqual({ type: 'done' })
		})
	})

	test('apply_patch reports and skips files in the task trash root', async () => {
		await withCodelayerHookTest(async ({ hook, manager }) => {
			const result = await hook(
				createCtx('apply_patch', {
					patch_text: `*** Begin Patch
*** Update File: .humanlayer/tasks/${taskSlug}/.trash/plan.md
@@
-old
+new
*** End Patch`,
				}),
			)

			expect(manager.calls).toHaveLength(0)
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test('read reports and skips files in the task trash root', async () => {
		await withCodelayerReadHookTest(async ({ testDir, hook, manager }) => {
			const trashDir = join(testDir, '.humanlayer', 'tasks', taskSlug, '.trash')
			const artifactPath = join(trashDir, 'plan.md')
			await mkdir(trashDir, { recursive: true })
			await writeFile(artifactPath, '# Deleted plan')

			const result = await hook(createCtx('read', { file_path: artifactPath }))

			expect(manager.calls).toHaveLength(0)
			expect(result.mutatedResult).toEqual(expect.any(String))
		})
	})

	test('read sync does not mutate multimodal tool output', async () => {
		await withCodelayerReadHookTest(async ({ testDir, hook }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'image.png')
			await writeFile(artifactPath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

			const result = await hook(
				createCtx(
					'read',
					{ file_path: artifactPath },
					{ type: 'content', value: [{ type: 'image-data', data: 'iVBORw0=', mediaType: 'image/png' }] },
				),
			)

			expect(result).toEqual({ type: 'done' })
		})
	})

	test.each([
		['first.json', '{"first":true}'],
		['first.jsonl', '{"first":1}\n{"second":2}\n'],
	])('syncs a first read of %s through text upsert', async (fileName, content) => {
		const manager = createMockSyncManager()
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		manager.uploadS3Artifact = uploadS3Artifact

		await withCodelayerReadHookTest(async ({ testDir, hook }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, fileName)
			await writeFile(artifactPath, content)
			await hook(createCtx('read', { file_path: artifactPath }))

			expect(manager.calls).toHaveLength(1)
			expect(manager.calls[0]).toMatchObject({ fileName, content, operationType: 'Read' })
			expect(uploadS3Artifact).not.toHaveBeenCalled()
		}, manager)
	})

	test.each([
		['data.json', '{"enabled":true}'],
		['events.jsonl', '{"event":1}\n{"event":2}\n'],
	])('read sync converts an unchanged S3-backed %s artifact to text', async (fileName, content) => {
		const calls: UpsertArtifactInput[] = []
		const uploadS3Artifact = vi.fn(async () => ({ artifactId: 'mock-s3-artifact-id' }))
		const manager: MockSyncManager = {
			calls,
			upsertArtifact: async (input) => {
				calls.push(input)
				return { artifactId: 'converted-artifact-id' }
			},
			uploadS3Artifact,
			getCollection: () =>
				({
					toArray: [
						{
							file_name: fileName,
							content_hash: hash(content),
							id: 'existing-artifact-id',
							storage_type: 's3',
						},
					],
				}) as any,
		}

		await withCodelayerReadHookTest(async ({ testDir, hook }) => {
			const artifactPath = join(testDir, '.humanlayer', 'tasks', taskSlug, fileName)
			await writeFile(artifactPath, content)

			await hook(createCtx('read', { file_path: artifactPath }))

			expect(uploadS3Artifact).not.toHaveBeenCalled()
			expect(calls).toHaveLength(1)
			expect(calls[0]).toMatchObject({ fileName, content, operationType: 'Read' })
		}, manager)
	})
})
