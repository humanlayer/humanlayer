import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { hash } from 'ohash'
import { describe, expect, test } from 'vitest'

import type { ISyncManager } from '@/lib/sync-service'

import { createArtifactReadSyncHook } from '../../../../../src/agents/claudecode/hooks/artifact-read-sync-hook'
import { createUniqueTempDir } from '../../../../helpers/concurrency'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'
const sessionId = 'test-session-id'
const taskId = 'task-uuid'
const taskSlug = 'test-task'

function createMockSyncManager(): ISyncManager & { calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> } {
	const calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> = []
	return {
		calls,
		upsertArtifact: async (input) => {
			calls.push(input)
			return { artifactId: 'mock-artifact-id' }
		},
		uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
		getCollection: () => undefined,
	}
}

function createHookInput(overrides: Partial<HookInput> = {}): HookInput {
	return {
		hook_event_name: 'PostToolUse',
		session_id: 'test-session',
		cwd: '/test/cwd',
		tool_input: {},
		tool_name: 'Read',
		...overrides,
	} as HookInput
}

async function withArtifactReadHookTest<T>(
	fn: (ctx: {
		testDir: string
		createHook: (syncManager: ISyncManager) => ReturnType<typeof createArtifactReadSyncHook>
	}) => Promise<T>,
): Promise<T> {
	const testDir = await createUniqueTempDir('artifact-read-sync-hook-test')
	await mkdir(join(testDir, 'rpi', 'tasks', taskSlug), { recursive: true })

	try {
		return await fn({
			testDir,
			createHook: (syncManager) =>
				createArtifactReadSyncHook(syncManager, sessionId, testDir, taskId, taskSlug, {
					getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
				}),
		})
	} finally {
		await rm(testDir, { recursive: true, force: true })
	}
}

describe('createArtifactReadSyncHook', () => {
	describe('event filtering', () => {
		test('skips non-PostToolUse events', async () => {
			await withArtifactReadHookTest(async ({ createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				const result = await hook(createHookInput({ hook_event_name: 'PreToolUse' as any }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({ continue: true })
				expect(manager.calls).toHaveLength(0)
			})
		})
	})

	describe('path filtering', () => {
		test('skips when file_path is missing', async () => {
			await withArtifactReadHookTest(async ({ createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				const result = await hook(createHookInput({ tool_input: {} }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({ continue: true })
				expect(manager.calls).toHaveLength(0)
			})
		})

		test('skips paths not in rpi/ directory', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({ tool_input: { file_path: `${testDir}/src/index.ts` } }),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(manager.calls).toHaveLength(0)
			})
		})

		test('reports and skips a read from the task trash root', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const trashDir = join(testDir, 'rpi', 'tasks', taskSlug, '.trash')
				const filePath = join(trashDir, 'plan.md')
				await mkdir(trashDir, { recursive: true })
				await writeFile(filePath, '# Deleted plan')

				const result = await createHook(manager)(
					createHookInput({ tool_input: { file_path: filePath } }),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(manager.calls).toHaveLength(0)
			})
		})
	})

	describe('Read tool handling', () => {
		test.each([
			['data.json', '{"enabled":true}'],
			['events.jsonl', '{"event":1}\n{"event":2}\n'],
		])('converts an unchanged S3-backed %s artifact to text on read', async (fileName, content) => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, fileName)
				await writeFile(filePath, content)
				let uploadCalls = 0
				const calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> = []
				const manager: ISyncManager = {
					upsertArtifact: async (input) => {
						calls.push(input)
						return { artifactId: 'converted-artifact-id' }
					},
					uploadS3Artifact: async () => {
						uploadCalls += 1
						return { artifactId: 'mock-s3-artifact-id' }
					},
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
				const hook = createHook(manager)

				await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(uploadCalls).toBe(0)
				expect(calls).toHaveLength(1)
				expect(calls[0]).toMatchObject({ fileName, content, operationType: 'Read' })
			})
		})

		test.each([
			['first.json', '{\n  "first": true\n}\n'],
			['first.jsonl', '{"first":1}\n{"second":2}\n'],
		])('syncs a first read of %s through text upsert', async (fileName, content) => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				let uploadCalls = 0
				manager.uploadS3Artifact = async () => {
					uploadCalls += 1
					return { artifactId: 'mock-s3-artifact-id' }
				}
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, fileName)
				await writeFile(filePath, content)

				await createHook(manager)(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(uploadCalls).toBe(0)
				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toMatchObject({ fileName, content, operationType: 'Read' })
			})
		})

		test('upserts when file is not in collection (first-time read)', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'research.md')
				await writeFile(filePath, '# Research Content')
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({
						tool_input: { file_path: filePath },
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]).toEqual({
					fileName: 'research.md',
					content: '# Research Content',
					frontmatter: {},
					operationType: 'Read',
					operationContents: { file_path: filePath },
				})
			})
		})

		test('preserves nested subpath on read sync', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const nestedDir = join(testDir, 'rpi', 'tasks', taskSlug, 'research')
				await mkdir(nestedDir, { recursive: true })
				const filePath = join(nestedDir, 'plan.md')
				await writeFile(filePath, '# Nested Plan')
				const hook = createHook(manager)

				await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]?.fileName).toBe('research/plan.md')
			})
		})

		test('uploads nested binary artifact read via relative humanlayer task path', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const s3Calls: Array<Parameters<ISyncManager['uploadS3Artifact']>[0]> = []
				const manager: ISyncManager = {
					upsertArtifact: async () => ({ artifactId: 'mock-artifact-id' }),
					uploadS3Artifact: async (input) => {
						s3Calls.push(input)
						return { artifactId: 'mock-s3-artifact-id' }
					},
					getCollection: () => undefined,
				}
				const nestedDir = join(testDir, '.humanlayer', 'tasks', taskSlug, 'images')
				await mkdir(nestedDir, { recursive: true })
				await writeFile(join(nestedDir, 'chart.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({
						tool_input: { file_path: `.humanlayer/tasks/${taskSlug}/images/chart.png` },
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(s3Calls).toHaveLength(1)
				expect(s3Calls[0]?.fileName).toBe('images/chart.png')
				expect(s3Calls[0]?.contentType).toBe('image/png')
			})
		})
	})

	describe('content-hash deduplication', () => {
		test('skips upsert when artifact exists in collection with same content hash', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const content = '# Already Synced'
				const contentHash = (await import('ohash')).hash(content)
				const mockCollection = {
					toArray: [{ file_name: 'synced.md', content_hash: contentHash, id: 'collection-artifact-id' }],
				}
				const manager: ISyncManager & { calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> } = {
					calls: [],
					upsertArtifact: async (input) => {
						manager.calls.push(input)
						return { artifactId: 'mock-artifact-id' }
					},
					uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
					getCollection: () => mockCollection as any,
				}
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'synced.md')
				await writeFile(filePath, content)
				const hook = createHook(manager)

				const result = await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(manager.calls).toHaveLength(0)
			})
		})

		test('upserts when artifact exists in collection with different content hash', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const mockCollection = {
					toArray: [{ file_name: 'changed.md', content_hash: 'old-hash', id: 'stale-artifact-id' }],
				}
				const manager: ISyncManager & { calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> } = {
					calls: [],
					upsertArtifact: async (input) => {
						manager.calls.push(input)
						return { artifactId: 'mock-artifact-id' }
					},
					uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
					getCollection: () => mockCollection as any,
				}
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'changed.md')
				await writeFile(filePath, '# Updated Content')
				const hook = createHook(manager)

				const result = await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]?.operationType).toBe('Read')
			})
		})

		test('upserts when artifact not found in collection (new file on disk)', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const mockCollection = {
					toArray: [{ file_name: 'other-file.md', content_hash: 'some-hash', id: 'other-artifact-id' }],
				}
				const manager: ISyncManager & { calls: Array<Parameters<ISyncManager['upsertArtifact']>[0]> } = {
					calls: [],
					upsertArtifact: async (input) => {
						manager.calls.push(input)
						return { artifactId: 'mock-artifact-id' }
					},
					uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
					getCollection: () => mockCollection as any,
				}
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'new-file.md')
				await writeFile(filePath, '# New File')
				const hook = createHook(manager)

				const result = await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({
					continue: true,
					hookSpecificOutput: {
						hookEventName: 'PostToolUse',
						additionalContext: expect.any(String),
					},
				})
				expect(manager.calls).toHaveLength(1)
			})
		})
	})

	describe('error handling', () => {
		test('returns continue: true on error (non-blocking)', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager: ISyncManager = {
					upsertArtifact: async () => {
						throw new Error('API Error')
					},
					uploadS3Artifact: async () => ({ artifactId: 'mock-s3-artifact-id' }),
					getCollection: () => undefined,
				}
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'test.md')
				await writeFile(filePath, '# Content')
				const hook = createHook(manager)

				const result = await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: new AbortController().signal,
				})

				expect(result).toEqual({ continue: true })
			})
		})

		test('returns continue: true when file does not exist on disk', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const hook = createHook(manager)

				const result = await hook(
					createHookInput({
						tool_input: { file_path: `${testDir}/rpi/tasks/nonexistent.md` },
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(manager.calls).toHaveLength(0)
			})
		})
	})

	describe('abort signal', () => {
		test('skips when signal is aborted', async () => {
			await withArtifactReadHookTest(async ({ testDir, createHook }) => {
				const manager = createMockSyncManager()
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'test.md')
				await writeFile(filePath, '# Content')
				const hook = createHook(manager)
				const abortController = new AbortController()
				abortController.abort()

				const result = await hook(createHookInput({ tool_input: { file_path: filePath } }), undefined, {
					signal: abortController.signal,
				})

				expect(result).toEqual({ continue: true })
				expect(manager.calls).toHaveLength(0)
			})
		})
	})

	describe('frontmatter parsing', () => {
		test('parses YAML frontmatter from disk content and passes to upsertArtifact', async () => {
			await withArtifactReadHookTest(async ({ testDir }) => {
				const manager = createMockSyncManager()
				const hook = createArtifactReadSyncHook(manager, sessionId, testDir, taskId, taskSlug)
				const filePath = join(testDir, 'rpi', 'tasks', taskSlug, 'plan.md')
				await writeFile(filePath, '---\ntype: plan\nstatus: draft\n---\n# Plan')

				await hook(
					createHookInput({
						tool_input: { file_path: filePath },
						tool_name: 'Read',
					}),
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(manager.calls).toHaveLength(1)
				expect(manager.calls[0]!.frontmatter).toEqual({ type: 'plan', status: 'draft' })
			})
		})
	})
})
