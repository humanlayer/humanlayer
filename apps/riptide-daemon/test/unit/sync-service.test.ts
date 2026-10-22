import { access, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, describe, expect, test, vi } from 'vitest'

import type { ORPCClient } from '@/orpc/client'

import { getArtifactSymlinkPath } from '../../src/lib/artifact-paths'
import { SyncService } from '../../src/lib/sync-service'
import { allocateTempDir, releaseTempDir } from '../helpers/concurrency'

// Task sync writes artifacts under homedir(); point it at a private folder so these tests never
// leave files in ~/.humanlayer/riptide/artifacts for other tests (or real tasks) to find.
const testHome = vi.hoisted(async () => {
	const { mkdtemp } = await import('node:fs/promises')
	const { tmpdir } = await vi.importActual<typeof import('node:os')>('node:os')
	const { join } = await import('node:path')
	return mkdtemp(join(tmpdir(), 'sync-service-home-'))
})
vi.mock('node:os', async (importOriginal) => {
	const os = await importOriginal<typeof import('node:os')>()
	const home = await testHome
	return { ...os, default: { ...os, homedir: () => home }, homedir: () => home }
})
afterAll(async () => rm(await testHome, { recursive: true, force: true }))

function createMockOrpc(): ORPCClient {
	return {
		artifacts: {
			upsert: vi.fn(() =>
				Promise.resolve({
					artifactId: 'mock-artifact-id',
					transactionId: 'test-tx',
					created: true,
				}),
			),
		},
	} as unknown as ORPCClient
}

async function withSyncServiceTest<T>(
	fn: (ctx: {
		testDir: string
		service: SyncService
		mockCollection: {
			toArray: unknown[]
			toArrayWhenReady: ReturnType<typeof vi.fn>
			subscribeChanges: ReturnType<typeof vi.fn>
			onFirstReady: ReturnType<typeof vi.fn>
			update: ReturnType<typeof vi.fn>
		}
		mockTasksCollection: {
			toArray: Array<{ id: string; name: string; slug: string | null }>
		}
		mockUpsertArtifact: ReturnType<typeof vi.fn>
		mockCleanup: ReturnType<typeof vi.fn>
	}) => Promise<T>,
): Promise<T> {
	const testDir = allocateTempDir('sync-service-test')
	await mkdir(join(testDir, '.humanlayer', 'tasks'), { recursive: true })

	const mockUpsertArtifact = vi.fn(() => Promise.resolve({ artifactId: 'mock-artifact-id' }))
	const mockCleanup = vi.fn(async () => {})
	const mockCreateActions = vi.fn(() => ({ upsertArtifact: mockUpsertArtifact }))
	const mockCollection = {
		onFirstReady: vi.fn((cb: () => void) => cb()),
		toArray: [] as unknown[],
		toArrayWhenReady: vi.fn(() => Promise.resolve(mockCollection.toArray)),
		subscribeChanges: vi.fn((cb: any, opts?: any) => {
			if (opts?.includeInitialState) {
				cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
			}
			return { unsubscribe: () => {} }
		}),
		isReady: () => true,
		status: 'ready' as const,
		state: new Map(),
		get: () => undefined,
		update: vi.fn(() => {}),
		utils: {
			awaitTxId: vi.fn(async () => {}),
		},
	}

	const mockTasksCollection = {
		toArray: [] as Array<{ id: string; name: string; slug: string | null }>,
	} as any

	const service = new SyncService(createMockOrpc(), 'http://localhost:3000', 'test-token', mockTasksCollection, {
		createArtifactsCollection: () => ({
			collection: mockCollection as any,
			createActions: mockCreateActions,
			cleanup: mockCleanup,
		}),
		setupArtifactPaths: async (cwd, _taskId, taskSlug) => {
			const symlinkPath = getArtifactSymlinkPath(cwd, taskSlug)
			await mkdir(symlinkPath, { recursive: true })
			return { storagePath: symlinkPath, symlinkPath }
		},
	})

	try {
		return await fn({
			testDir,
			service,
			mockCollection: mockCollection as any,
			mockTasksCollection,
			mockUpsertArtifact,
			mockCleanup,
		})
	} finally {
		await service.shutdown()
		await rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
		releaseTempDir(testDir)
	}
}

async function waitForFileContent(filePath: string, expected: string): Promise<string> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const content = await readFile(filePath, 'utf-8').catch(() => null)
		if (content === expected) return content
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	return readFile(filePath, 'utf-8')
}

describe('SyncService', () => {
	test('returns a TaskSyncContext', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			expect(taskSync).toBeDefined()
			expect(taskSync.createSessionManager).toBeTypeOf('function')
		})
	})

	test('starts with no active task contexts until ensureTaskSync is called', async () => {
		await withSyncServiceTest(async ({ service }) => {
			expect(service.getDebugState()).toEqual({
				activeTaskIds: [],
				registeredTaskIds: [],
				pendingTaskIds: [],
			})
		})
	})

	test('reuses context for same taskId', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const ctx1 = await service.ensureTaskSync('task-1', testDir)
			const ctx2 = await service.ensureTaskSync('task-1', testDir)
			expect(ctx1).toBe(ctx2)
		})
	})

	test('tracks active and registered task contexts only after ensureTaskSync is called', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			expect(service.getDebugState().activeTaskIds).toEqual([])

			await service.ensureTaskSync('task-a', testDir)
			expect(service.getDebugState()).toEqual({
				activeTaskIds: ['task-a'],
				registeredTaskIds: ['task-a'],
				pendingTaskIds: [],
			})

			await service.ensureTaskSync('task-b', testDir)
			expect(service.getDebugState()).toEqual({
				activeTaskIds: ['task-a', 'task-b'],
				registeredTaskIds: ['task-a', 'task-b'],
				pendingTaskIds: [],
			})
		})
	})

	test('createSessionManager returns distinct managers per session', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			const m1 = taskSync.createSessionManager('session-1')
			const m2 = taskSync.createSessionManager('session-2')
			expect(m1).not.toBe(m2)
		})
	})

	test('managers from same task share the same collection', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			const m1 = taskSync.createSessionManager('session-1')
			const m2 = taskSync.createSessionManager('session-2')
			expect(m1.getCollection()).toBe(m2.getCollection())
		})
	})

	test('clears all registries on shutdown', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const ctx1 = await service.ensureTaskSync('task-1', testDir)
			expect(service.getDebugState()).toEqual({
				activeTaskIds: ['task-1'],
				registeredTaskIds: ['task-1'],
				pendingTaskIds: [],
			})
			await service.shutdown()
			expect(service.getDebugState()).toEqual({
				activeTaskIds: [],
				registeredTaskIds: [],
				pendingTaskIds: [],
			})
			const ctx2 = await service.ensureTaskSync('task-1', testDir)
			expect(ctx2).not.toBe(ctx1)
		})
	})

	test('cleans up each task artifact collection on shutdown', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCleanup }) => {
			await service.ensureTaskSync('task-1', testDir)
			await service.shutdown()
			expect(mockCleanup).toHaveBeenCalledOnce()
		})
	})

	test('writes artifacts to disk when collection has data with task_slug', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection }) => {
			const taskSlug = 'eng-123-test'
			mockCollection.toArray = [
				{
					id: 'art-1',
					file_name: 'research.md',
					content: '# Research',
					content_hash: 'hash-1',
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any

			await service.ensureTaskSync('task-1', testDir)
			const content = await waitForFileContent(
				join(testDir, '.humanlayer', 'tasks', taskSlug, 'research.md'),
				'# Research',
			)
			expect(content).toBe('# Research')
		})
	})

	test('skips disk management for active rows rooted in reserved trash', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection }) => {
			const taskSlug = 'eng-reserved-trash'
			mockCollection.toArray = [
				{
					id: 'art-trash-1',
					file_name: '.trash/plan.md',
					content: '# Must not be written',
					content_hash: 'hash-1',
					task_slug: taskSlug,
					is_deleted: false,
				},
			] as any

			await service.ensureTaskSync('task-1', testDir)
			await new Promise((resolve) => setTimeout(resolve, 50))

			await expect(access(join(testDir, '.humanlayer', 'tasks', taskSlug, '.trash', 'plan.md'))).rejects.toThrow()
		})
	})

	test('skips disk writes when all artifacts have null task_slug', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection }) => {
			mockCollection.toArray = [
				{
					id: 'art-1',
					file_name: 'research.md',
					content: '# Research',
					content_hash: 'hash-1',
					task_slug: null,
					task_id: 'task-1',
				},
			] as any
			await service.ensureTaskSync('task-1', testDir)
		})
	})

	test('proceeds when collection readiness does not resolve within timeout', async () => {
		const testDir = allocateTempDir('sync-service-timeout')
		await mkdir(join(testDir, '.humanlayer', 'tasks'), { recursive: true })
		const service = new SyncService(
			createMockOrpc(),
			'http://localhost:3000',
			'test-token',
			{ toArray: [] } as any,
			{
				readyTimeoutMs: 10,
				createArtifactsCollection: () => ({
					collection: {
						toArray: [],
						toArrayWhenReady: vi.fn(() => new Promise(() => {})),
						subscribeChanges: vi.fn(() => ({ unsubscribe: () => {} })),
						isReady: () => true,
						status: 'ready' as const,
						state: new Map(),
						get: () => undefined,
						update: vi.fn(() => {}),
						utils: { awaitTxId: vi.fn(async () => {}) },
					} as any,
					createActions: vi.fn(() => ({
						upsertArtifact: vi.fn(async () => ({ artifactId: 'mock-artifact-id' })),
					})),
				}),
				setupArtifactPaths: async (cwd, _taskId, taskSlug) => {
					const symlinkPath = getArtifactSymlinkPath(cwd, taskSlug)
					await mkdir(symlinkPath, { recursive: true })
					return { storagePath: symlinkPath, symlinkPath }
				},
			},
		)
		try {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			expect(taskSync).toBeDefined()
		} finally {
			await service.shutdown()
			await rm(testDir, { recursive: true, force: true })
			releaseTempDir(testDir)
		}
	})

	test('concurrent ensureTaskSync calls for same taskId do not duplicate collections', async () => {
		await withSyncServiceTest(async ({ testDir, service }) => {
			const [ctx1, ctx2] = await Promise.all([
				service.ensureTaskSync('task-1', testDir),
				service.ensureTaskSync('task-1', testDir),
			])
			expect(ctx1).toBe(ctx2)
			expect(ctx1.createSessionManager('session-1').getCollection()).toBe(
				ctx2.createSessionManager('session-2').getCollection(),
			)
		})
	})

	test('writes task.md from a delayed initial snapshot', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'delayed-initial-snapshot'
			const content = '# Task\n\nDelayed task context.'
			let initialStateCallback: ((changes: Array<any>) => void) | undefined
			let resolveReady: ((artifacts: ReadonlyArray<unknown>) => void) | undefined
			const readyPromise = new Promise<ReadonlyArray<unknown>>((resolve) => {
				resolveReady = resolve
			})

			mockTasksCollection.toArray = [{ id: 'task-1', name: 'Delayed task', slug: taskSlug }]
			mockCollection.toArray = []
			mockCollection.toArrayWhenReady = vi.fn(() => readyPromise)
			mockCollection.subscribeChanges = vi.fn((cb: (changes: Array<any>) => void, opts?: any) => {
				if (opts?.includeInitialState) initialStateCallback = cb
				return { unsubscribe: () => {} }
			})

			const ensurePromise = service.ensureTaskSync('task-1', testDir)
			await vi.waitFor(() => expect(initialStateCallback).toBeDefined())

			const artifact = {
				id: 'task-artifact-1',
				file_name: 'task.md',
				content,
				content_hash: hash(content),
				task_slug: taskSlug,
				storage_type: 'postgres',
				s3_key: null,
				is_deleted: false,
			}
			mockCollection.toArray = [artifact]
			initialStateCallback?.([{ type: 'insert', key: artifact.id, value: artifact }])
			resolveReady?.(mockCollection.toArray)

			await ensurePromise
			const filePath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'task.md')
			expect(await waitForFileContent(filePath, content)).toBe(content)
			expect(mockCollection.subscribeChanges).toHaveBeenCalledOnce()
			expect(mockCollection.subscribeChanges).toHaveBeenCalledWith(expect.any(Function), {
				includeInitialState: true,
			})
		})
	})

	test('delegates to actions.upsertArtifact when actions are available', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockUpsertArtifact }) => {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			const manager = taskSync.createSessionManager('session-1')
			await manager.upsertArtifact({
				fileName: 'test.md',
				content: '# Test',
				operationType: 'Write',
				operationContents: { file_path: '/test/.humanlayer/tasks/test.md', content: '# Test' },
			})
			expect(mockUpsertArtifact).toHaveBeenCalledWith({
				fileName: 'test.md',
				content: '# Test',
				operationType: 'Write',
				operationContents: { file_path: '/test/.humanlayer/tasks/test.md', content: '# Test' },
				sessionId: 'session-1',
			})
		})
	})

	test('falls back to direct oRPC when actions are not available', async () => {
		const testDir = allocateTempDir('sync-service-degraded')
		await mkdir(join(testDir, '.humanlayer', 'tasks'), { recursive: true })
		const service = new SyncService(
			createMockOrpc(),
			'http://localhost:3000',
			'test-token',
			{ toArray: [] } as any,
			{
				createArtifactsCollection: () => {
					throw new Error('Network error')
				},
			},
		)
		try {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			const manager = taskSync.createSessionManager('session-1')
			await manager.upsertArtifact({
				fileName: 'test.md',
				content: '# Test',
				operationType: 'Write',
				operationContents: {},
			})
			expect((service as any).orpc.artifacts.upsert).toHaveBeenCalled()
		} finally {
			await service.shutdown()
			await rm(testDir, { recursive: true, force: true })
			releaseTempDir(testDir)
		}
	})

	test('returns degraded TaskSyncContext when collection creation fails', async () => {
		const testDir = allocateTempDir('sync-service-error')
		await mkdir(join(testDir, '.humanlayer', 'tasks'), { recursive: true })
		const service = new SyncService(
			createMockOrpc(),
			'http://localhost:3000',
			'test-token',
			{ toArray: [] } as any,
			{
				createArtifactsCollection: () => {
					throw new Error('Network error')
				},
			},
		)
		try {
			const taskSync = await service.ensureTaskSync('task-1', testDir)
			expect(taskSync.getCollection()).toBeUndefined()
			expect(taskSync.createSessionManager('session-1').getCollection()).toBeUndefined()
		} finally {
			await service.shutdown()
			await rm(testDir, { recursive: true, force: true })
			releaseTempDir(testDir)
		}
	})

	test('writes artifacts to disk on collection change', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-456-test'
			const initialContent = '# Initial'
			const updatedContent = '# Updated'
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = [
				{
					id: 'art-1',
					file_name: 'test.md',
					content: initialContent,
					content_hash: hash(initialContent),
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any

			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState)
					cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
				return { unsubscribe: () => {} }
			})

			await service.ensureTaskSync('task-1', testDir)
			const filePath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'test.md')
			expect(await waitForFileContent(filePath, initialContent)).toBe(initialContent)

			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-1',
						file_name: 'test.md',
						content: updatedContent,
						content_hash: hash(updatedContent),
						task_slug: taskSlug,
					},
				},
			])

			expect(await waitForFileContent(filePath, updatedContent)).toBe(updatedContent)
		})
	})

	test('skips disk write when content hash matches on-disk content', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-789-test'
			const fileContent = '# Same Content'
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = [
				{
					id: 'art-1',
					file_name: 'same.md',
					content: fileContent,
					content_hash: hash(fileContent),
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any

			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState)
					cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
				return { unsubscribe: () => {} }
			})

			await service.ensureTaskSync('task-1', testDir)
			const filePath = join(testDir, '.humanlayer', 'tasks', taskSlug, 'same.md')
			expect(await waitForFileContent(filePath, fileContent)).toBe(fileContent)

			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-1',
						file_name: 'same.md',
						content: fileContent,
						content_hash: hash(fileContent),
						task_slug: taskSlug,
					},
				},
			])

			await Promise.resolve()
			await Promise.resolve()
			expect(await waitForFileContent(filePath, fileContent)).toBe(fileContent)
		})
	})

	test('insert change with is_deleted=true does not write file to disk', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-insert-deleted'
			const fileContent = '# Should Not Be Written'
			const contentHash = hash(fileContent)
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = []
			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState) cb([])
				return { unsubscribe: () => {} }
			})
			mockTasksCollection.toArray = [{ id: 'task-1', name: 'test task', slug: taskSlug }]

			await service.ensureTaskSync('task-1', testDir)

			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			const filePath = join(taskDir, 'ghost-insert.md')

			changeCallback([
				{
					type: 'insert',
					value: {
						id: 'art-insert-deleted-1',
						file_name: 'ghost-insert.md',
						content: fileContent,
						content_hash: contentHash,
						task_slug: taskSlug,
						is_deleted: true,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))
			await expect(access(filePath)).rejects.toThrow()
		})
	})

	test('delete change moves existing file to .trash', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-delete-change-type'
			const fileContent = '# Will Be Deleted'
			const contentHash = hash(fileContent)
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = [
				{
					id: 'art-del-type-1',
					file_name: 'victim.md',
					content: fileContent,
					content_hash: contentHash,
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any
			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState) {
					cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
				}
				return { unsubscribe: () => {} }
			})
			mockTasksCollection.toArray = [{ id: 'task-1', name: 'test task', slug: taskSlug }]

			await service.ensureTaskSync('task-1', testDir)

			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			const filePath = join(taskDir, 'victim.md')
			expect(await waitForFileContent(filePath, fileContent)).toBe(fileContent)

			changeCallback([
				{
					type: 'delete',
					value: {
						id: 'art-del-type-1',
						file_name: 'victim.md',
						content: fileContent,
						content_hash: contentHash,
						task_slug: taskSlug,
						is_deleted: true,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))

			const trashDir = join(taskDir, '.trash')
			expect((await stat(trashDir)).isDirectory()).toBe(true)
			expect(await readFile(join(trashDir, 'victim.md'), 'utf-8')).toBe(fileContent)
			await expect(access(filePath)).rejects.toThrow()
		})
	})

	test('tombstone update moves file into .trash', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-delete-test'
			const fileContent = '# To Delete'
			const contentHash = hash(fileContent)
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = [
				{
					id: 'art-delete-1',
					file_name: 'doomed.md',
					content: fileContent,
					content_hash: contentHash,
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any
			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState) {
					cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
				}
				return { unsubscribe: () => {} }
			})
			mockTasksCollection.toArray = [{ id: 'task-1', name: 'test task', slug: taskSlug }]

			await service.ensureTaskSync('task-1', testDir)

			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			const filePath = join(taskDir, 'doomed.md')
			expect(await waitForFileContent(filePath, fileContent)).toBe(fileContent)

			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-delete-1',
						file_name: 'doomed.md',
						content: fileContent,
						content_hash: contentHash,
						task_slug: taskSlug,
						is_deleted: true,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))

			const trashDir = join(taskDir, '.trash')
			expect((await stat(trashDir)).isDirectory()).toBe(true)
			expect(await readFile(join(trashDir, 'doomed.md'), 'utf-8')).toBe(fileContent)
			await expect(access(filePath)).rejects.toThrow()
		})
	})

	test('tombstone handles missing on-disk file gracefully', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const taskSlug = 'eng-delete-nofile'
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = []
			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState) cb([])
				return { unsubscribe: () => {} }
			})
			mockTasksCollection.toArray = [{ id: 'task-1', name: 'test task', slug: taskSlug }]

			await service.ensureTaskSync('task-1', testDir)

			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-ghost-1',
						file_name: 'ghost.md',
						content: '',
						content_hash: '',
						task_slug: taskSlug,
						is_deleted: true,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))

			const trashDir = join(taskDir, '.trash')
			expect((await stat(trashDir)).isDirectory()).toBe(true)
			await expect(access(join(trashDir, 'ghost.md'))).rejects.toThrow()
		})
	})

	test('restore removes stale .trash copy and writes file back to original location', async () => {
		await withSyncServiceTest(async ({ testDir, service, mockCollection, mockTasksCollection }) => {
			const { hash } = await import('ohash')
			const taskSlug = 'eng-restore-test'
			const fileContent = '# Restore Me'
			const contentHash = hash(fileContent)
			let changeCallback: (changes: Array<any>) => void = () => {}

			mockCollection.toArray = [
				{
					id: 'art-restore-1',
					file_name: 'restorable.md',
					content: fileContent,
					content_hash: contentHash,
					task_slug: taskSlug,
					task_id: 'task-1',
					resource_owner_user_id: 'user-1',
					organization_id: 'org-1',
					created_by: 'user-1',
					created_at: BigInt(Date.now()),
					last_updated_at: BigInt(Date.now()),
				},
			] as any
			mockCollection.subscribeChanges = vi.fn((cb: any, opts?: any) => {
				changeCallback = cb
				if (opts?.includeInitialState) {
					cb(mockCollection.toArray.map((item: any) => ({ type: 'insert' as const, value: item })))
				}
				return { unsubscribe: () => {} }
			})
			mockTasksCollection.toArray = [{ id: 'task-1', name: 'test task', slug: taskSlug }]

			await service.ensureTaskSync('task-1', testDir)

			const taskDir = join(testDir, '.humanlayer', 'tasks', taskSlug)
			const filePath = join(taskDir, 'restorable.md')
			const trashedPath = join(taskDir, '.trash', 'restorable.md')
			expect(await waitForFileContent(filePath, fileContent)).toBe(fileContent)

			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-restore-1',
						file_name: 'restorable.md',
						content: fileContent,
						content_hash: contentHash,
						task_slug: taskSlug,
						is_deleted: true,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(await readFile(trashedPath, 'utf-8')).toBe(fileContent)
			await expect(access(filePath)).rejects.toThrow()

			changeCallback([
				{
					type: 'update',
					value: {
						id: 'art-restore-1',
						file_name: 'restorable.md',
						content: fileContent,
						content_hash: contentHash,
						task_slug: taskSlug,
						is_deleted: false,
					},
				},
			])

			await new Promise((resolve) => setTimeout(resolve, 200))
			expect(await readFile(filePath, 'utf-8')).toBe(fileContent)
			await expect(access(trashedPath)).rejects.toThrow()
		})
	})
})
