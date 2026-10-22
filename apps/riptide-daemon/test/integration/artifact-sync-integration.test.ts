import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { createArtifactSyncHook } from '../../src/agents/claudecode/hooks/artifact-sync-hook'
import type { ArtifactActions } from '../../src/collections/electric/artifacts'
import type { ArtifactChangeMessage, ArtifactCollectionLike, ArtifactData } from '../../src/collections/types'
import { getArtifactSymlinkPath } from '../../src/lib/artifact-paths'
import { SyncService } from '../../src/lib/sync-service'
import type { ORPCClient } from '../../src/orpc/client'
import { allocateTempDir, releaseTempDir } from '../helpers/concurrency'
import { createMockHookServices } from '../mocks/daemon-services.mock'

const MOCK_CLOUD_ORIGIN = 'https://test.codelayer.cloud'
const sessionId = 'test-session-id'
const taskId = 'test-task-id'
const taskSlug = 'test-task'

type MockArtifact = ArtifactData & {
	task_id: string
	resource_owner_user_id?: string
	organization_id?: string
	created_by?: string
	created_at?: bigint
	last_updated_at?: bigint
}

type TestContext = {
	testDir: string
	rpiTasksDir: string
	mockArtifactsUpsert: ReturnType<typeof vi.fn>
	mockCollection: ReturnType<typeof createMockCollection>
	mockTasksCollection: {
		toArray: Array<{ id: string; name: string; slug: string | null }>
	}
	createSyncService: () => SyncService
	setupHook: (syncService?: SyncService) => Promise<{
		syncService: SyncService
		hook: ReturnType<typeof createArtifactSyncHook>
	}>
}

function createMockCollection() {
	const collection: ArtifactCollectionLike & {
		isReady: () => true
		status: 'ready'
		state: Map<never, never>
		get: () => undefined
		update: () => void
		utils: { awaitTxId: () => Promise<void> }
	} = {
		toArray: [] as MockArtifact[],
		toArrayWhenReady: () => Promise.resolve(collection.toArray),
		subscribeChanges: vi.fn(
			(cb: (changes: ArtifactChangeMessage[]) => void, opts?: { includeInitialState?: boolean }) => {
				if (opts?.includeInitialState) {
					cb(
						collection.toArray.map((item) => ({
							type: 'insert' as const,
							key: item.id,
							value: item as ArtifactData,
						})),
					)
				}
				return { unsubscribe: () => {} }
			},
		),
		isReady: () => true as const,
		status: 'ready' as const,
		state: new Map<never, never>(),
		get: () => undefined,
		update: () => {},
		utils: { awaitTxId: async () => {} },
	}

	return collection
}

async function withArtifactSyncTest<T>(fn: (ctx: TestContext) => Promise<T>): Promise<T> {
	const testDir = allocateTempDir('artifact-sync-integration-test')
	const rpiTasksDir = join(testDir, 'rpi', 'tasks', taskSlug)
	await mkdir(rpiTasksDir, { recursive: true })

	const mockArtifactsUpsert = vi.fn(async () => ({
		artifactId: 'mock-artifact-id',
		versionId: 'mock-version-id',
		transactionId: 'mock-tx-id',
		created: true,
	}))

	const mockOrpc = {
		artifacts: {
			upsert: mockArtifactsUpsert,
		},
	} as unknown as ORPCClient

	const mockCollection = createMockCollection()
	const mockTasksCollection = {
		toArray: [{ id: taskId, name: 'Test Task', slug: taskSlug }] as Array<{
			id: string
			name: string
			slug: string | null
		}>,
	}
	function createArtifactsCollectionForTest(_syncOrigin: string, _token: string, _taskId: string) {
		return {
			collection: mockCollection,
			createActions: (orpc: ORPCClient, currentTaskId: string) => {
				const actions: ArtifactActions = {
					async upsertArtifact(input) {
						const result = await orpc.artifacts.upsert({
							taskId: currentTaskId,
							sessionId: input.sessionId,
							fileName: input.fileName,
							content: input.content,
							frontmatter: input.frontmatter,
							operationType: input.operationType,
							operationContents: input.operationContents,
						})
						return { artifactId: result.artifactId }
					},
				}
				return actions
			},
		}
	}

	const createSyncService = () =>
		new SyncService(mockOrpc, 'http://localhost:3000', 'test-token', mockTasksCollection as any, {
			createArtifactsCollection: createArtifactsCollectionForTest as any,
			setupArtifactPaths: async (cwd, _taskId, taskSlug) => {
				const symlinkPath = getArtifactSymlinkPath(cwd, taskSlug)
				await mkdir(symlinkPath, { recursive: true })
				return { storagePath: symlinkPath, symlinkPath }
			},
		})

	const setupHook = async (syncService = createSyncService()) => {
		const taskSync = await syncService.ensureTaskSync(taskId, testDir)
		const manager = taskSync.createSessionManager(sessionId)
		const taskSlug = taskSync.getTaskSlug()
		const hook = createArtifactSyncHook(
			manager,
			sessionId,
			testDir,
			taskId,
			taskSlug,
			null,
			null,
			createMockHookServices(),
			{
				getArtifactCloudUrl: (artifactId) => `${MOCK_CLOUD_ORIGIN}/artifacts/${artifactId}`,
			},
		)

		return { syncService, hook }
	}

	try {
		return await fn({
			testDir,
			rpiTasksDir,
			mockArtifactsUpsert,
			mockCollection,
			mockTasksCollection,
			createSyncService,
			setupHook,
		})
	} finally {
		await rm(testDir, { recursive: true, force: true })
		releaseTempDir(testDir)
	}
}

describe('Artifact Sync Integration', () => {
	describe('full flow: hook -> SyncManager -> orpc', () => {
		test('Write tool triggers orpc.artifacts.upsert with correct parameters', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const filePath = join(rpiTasksDir, 'research.md')
				const content = '# Research Document\n\nThis is test content.'

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: { file_path: filePath, content },
						tool_name: 'Write',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith({
					taskId,
					sessionId,
					fileName: 'research.md',
					content,
					frontmatter: {},
					operationType: 'Write',
					operationContents: { file_path: filePath, content },
				})
			})
		})

		test('Edit tool reads file from disk and calls orpc.artifacts.upsert', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const filePath = join(rpiTasksDir, 'plan.md')
				const editedContent = '# Implementation Plan\n\nUpdated content after edit.'
				await writeFile(filePath, editedContent)

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							old_string: 'old text',
							new_string: 'new text',
						},
						tool_name: 'Edit',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith({
					taskId,
					sessionId,
					fileName: 'plan.md',
					content: editedContent,
					frontmatter: {},
					operationType: 'Edit',
					operationContents: {
						file_path: filePath,
						old_string: 'old text',
						new_string: 'new text',
					},
				})
			})
		})

		test('MultiEdit tool reads file from disk and calls orpc.artifacts.upsert', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const filePath = join(rpiTasksDir, 'design.md')
				const editedContent = '# Design Document\n\nMulti-edited content.'
				await writeFile(filePath, editedContent)

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							edits: [
								{ old_string: 'a', new_string: 'b' },
								{ old_string: 'c', new_string: 'd' },
							],
						},
						tool_name: 'MultiEdit',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						taskId,
						sessionId,
						fileName: 'design.md',
						content: editedContent,
						operationType: 'MultiEdit',
					}),
				)
			})
		})
	})

	describe('SyncService lifecycle', () => {
		test('daemon startup baseline does not create task artifact sync before ensureTaskSync', async () => {
			await withArtifactSyncTest(async ({ createSyncService }) => {
				const syncService = createSyncService()
				expect(syncService.getDebugState()).toEqual({
					activeTaskIds: [],
					registeredTaskIds: [],
					pendingTaskIds: [],
				})
			})
		})

		test('ensureTaskSync reuses context for same task', async () => {
			await withArtifactSyncTest(async ({ testDir, createSyncService }) => {
				const syncService = createSyncService()
				const ctx1 = await syncService.ensureTaskSync(taskId, testDir)
				const ctx2 = await syncService.ensureTaskSync(taskId, testDir)
				expect(ctx1).toBe(ctx2)
			})
		})

		test('managers from same task context share collection', async () => {
			await withArtifactSyncTest(async ({ testDir, createSyncService }) => {
				const syncService = createSyncService()
				const taskSync = await syncService.ensureTaskSync(taskId, testDir)
				const m1 = taskSync.createSessionManager('session-1')
				const m2 = taskSync.createSessionManager('session-2')
				expect(m1.getCollection()).toBe(m2.getCollection())
			})
		})
	})

	describe('non-rpi paths are ignored', () => {
		test('Write to src/ directory does not call orpc.artifacts.upsert', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const srcDir = join(testDir, 'src')
				await mkdir(srcDir, { recursive: true })

				const filePath = join(srcDir, 'index.ts')
				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content: 'export const foo = 1',
						},
						tool_name: 'Write',
					} as any,
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(mockArtifactsUpsert).not.toHaveBeenCalled()
			})
		})

		test('Edit to package.json does not call orpc.artifacts.upsert', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const filePath = join(testDir, 'package.json')
				await writeFile(filePath, '{"name": "test"}')

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							old_string: '"name"',
							new_string: '"package-name"',
						},
						tool_name: 'Edit',
					} as any,
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(mockArtifactsUpsert).not.toHaveBeenCalled()
			})
		})

		test('Write to nested app directory does not call orpc.artifacts.upsert', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const appDir = join(testDir, 'apps', 'daemon', 'src')
				await mkdir(appDir, { recursive: true })

				const filePath = join(appDir, 'main.ts')
				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content: 'console.log("hello")',
						},
						tool_name: 'Write',
					} as any,
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(mockArtifactsUpsert).not.toHaveBeenCalled()
			})
		})
	})

	describe('rpi path variations', () => {
		test('Write to rpi/ root (outside tasks/) triggers sync', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const rpiDir = join(testDir, 'rpi')
				await mkdir(rpiDir, { recursive: true })

				const filePath = join(rpiDir, 'config.md')
				const content = '# RPI Config'

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content,
						},
						tool_name: 'Write',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						fileName: 'config.md',
						content,
						operationType: 'Write',
					}),
				)
			})
		})

		test('Write to rpi/tasks/ (task root) triggers sync', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const tasksDir = join(testDir, 'rpi', 'tasks')
				const filePath = join(tasksDir, 'index.md')
				const content = '# Tasks Index'

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content,
						},
						tool_name: 'Write',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						fileName: 'index.md',
						operationType: 'Write',
					}),
				)
			})
		})

		test('Write to rpi/tasks/<task-slug>/ (nested task) triggers sync', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const filePath = join(rpiTasksDir, 'research.md')
				const content = '# Research'

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content,
						},
						tool_name: 'Write',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						fileName: 'research.md',
						operationType: 'Write',
					}),
				)
			})
		})

		test('Write to nested path under rpi/tasks/<task-slug>/ preserves subpath', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const nestedDir = join(rpiTasksDir, 'research')
				await mkdir(nestedDir, { recursive: true })
				const filePath = join(nestedDir, 'plan.md')
				const content = '# Nested Plan'

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content,
						},
						tool_name: 'Write',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						fileName: 'research/plan.md',
						content,
						operationType: 'Write',
					}),
				)
			})
		})

		test('Edit to rpi/shared/ directory triggers sync', async () => {
			await withArtifactSyncTest(async ({ testDir, mockArtifactsUpsert, setupHook }) => {
				const { hook } = await setupHook()
				const sharedDir = join(testDir, 'rpi', 'shared')
				await mkdir(sharedDir, { recursive: true })

				const filePath = join(sharedDir, 'utils.md')
				const editedContent = '# Shared Utils\n\nEdited content.'
				await writeFile(filePath, editedContent)

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							old_string: 'old',
							new_string: 'new',
						},
						tool_name: 'Edit',
					} as any,
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
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
				expect(mockArtifactsUpsert).toHaveBeenCalledWith(
					expect.objectContaining({
						fileName: 'shared/utils.md',
						content: editedContent,
						operationType: 'Edit',
					}),
				)
			})
		})
	})

	describe('error handling', () => {
		test('continues session when orpc.artifacts.upsert fails', async () => {
			await withArtifactSyncTest(async ({ testDir, rpiTasksDir, mockArtifactsUpsert, setupHook }) => {
				mockArtifactsUpsert.mockImplementationOnce(async () => {
					throw new Error('API Error: Failed to upsert artifact')
				})

				const { hook } = await setupHook()
				const filePath = join(rpiTasksDir, 'test.md')

				const result = await hook(
					{
						hook_event_name: 'PostToolUse',
						session_id: sessionId,
						cwd: testDir,
						tool_input: {
							file_path: filePath,
							content: 'test content',
						},
						tool_name: 'Write',
					} as any,
					undefined,
					{ signal: new AbortController().signal },
				)

				expect(result).toEqual({ continue: true })
				expect(mockArtifactsUpsert).toHaveBeenCalledTimes(1)
			})
		})
	})
})
