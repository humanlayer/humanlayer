import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { hash } from 'ohash'

import type { ArtifactActions } from '@/collections/electric/artifacts'
import { createArtifactsCollection } from '@/collections/electric/artifacts'
import type { TasksCollection } from '@/collections/electric/tasks'
import type { ArtifactCollectionLike, ArtifactData } from '@/collections/types'
import type { DaemonRuntime } from '@/effects/runtime'
import { Sentry } from '@/instrument'
import logger from '@/logger'
import type { ORPCClient } from '@/orpc/client'

import { ArtifactS3DownloadError } from '../agents/claudecode/errors'
import { validateArtifactWritePath } from './artifact-path-validation'
import { getArtifactSymlinkPath, setupArtifactPaths } from './artifact-paths'
import { isReservedArtifactTrashSubpath } from './artifact-trash'
import type { ISyncManager, ISyncService, ITaskSyncContext, SyncServiceDebugState } from './sync-service-types'

export type { ISyncManager, ISyncService, ITaskSyncContext, SyncServiceDebugState } from './sync-service-types'

/**
 * Interface for individual session-scoped sync managers.
 * Exported so hooks and tests can reference the type.
 */
/**
 * Interface for the sync service that manages task-scoped sync contexts.
 * Exported so tests can provide mock implementations.
 */
/**
 * State for a task-scoped artifacts collection and its disk writer subscription.
 */
interface TaskArtifactState {
	collection: ArtifactCollectionLike
	actions: ArtifactActions
	unsubscribe: { unsubscribe: () => void }
	cleanup?: () => Promise<void>
}

export interface SyncServiceOptions {
	readonly daemonRuntime?: DaemonRuntime
	createArtifactsCollection?: (
		syncOrigin: string,
		token: string,
		taskId: string,
	) => {
		collection: ArtifactCollectionLike
		createActions: (orpc: ORPCClient, taskId: string) => ArtifactActions
		cleanup?: () => Promise<void>
	}
	setupArtifactPaths?: (
		cwd: string,
		taskId: string,
		taskSlug: string,
	) => Promise<{ storagePath: string; symlinkPath: string }>
	readyTimeoutMs?: number
}

/**
 * Resolve task slug from the first artifact that has a non-null task_slug.
 */
function resolveTaskSlug(artifacts: ReadonlyArray<ArtifactData>): string | null {
	for (const artifact of artifacts) {
		if (artifact.task_slug) return artifact.task_slug
	}
	return null
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
	let timeout: ReturnType<typeof setTimeout> | undefined
	const timeoutPromise = new Promise<null>((resolve) => {
		timeout = setTimeout(() => resolve(null), timeoutMs)
	})

	try {
		return await Promise.race([promise, timeoutPromise])
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

/**
 * Production implementation of ISyncManager.
 * Calls the daemon API to persist artifacts.
 */
export class SyncManager implements ISyncManager {
	constructor(
		private readonly orpc: ORPCClient,
		private readonly taskId: string,
		private readonly sessionId: string,
		private readonly collection: ArtifactCollectionLike | undefined,
		private readonly actions: ArtifactActions | undefined,
	) {}

	async upsertArtifact(input: {
		fileName: string
		content: string
		operationType: 'Write' | 'Edit' | 'MultiEdit' | 'Read'
		operationContents: Record<string, unknown>
		frontmatter?: Record<string, unknown>
	}): Promise<{ artifactId: string; designQuestionsResolved?: boolean }> {
		logger.debug({ taskId: this.taskId, sessionId: this.sessionId, fileName: input.fileName }, 'Upserting artifact')
		// Use optimistic actions when available; fall back to direct oRPC in degraded mode
		if (this.actions) {
			return this.actions.upsertArtifact({
				...input,
				sessionId: this.sessionId,
			})
		}
		// Degraded mode: no collection/actions available (e.g. Electric sync timed out)
		const result = await this.orpc.artifacts.upsert({
			taskId: this.taskId,
			sessionId: this.sessionId,
			fileName: input.fileName,
			content: input.content,
			operationType: input.operationType as 'Write' | 'Edit' | 'MultiEdit',
			operationContents: input.operationContents,
			frontmatter: input.frontmatter,
		})
		return { artifactId: result.artifactId, designQuestionsResolved: result.designQuestionsResolved }
	}

	async uploadS3Artifact(params: {
		fileName: string
		contentType: string
		contentHash: string
		fileSizeBytes: number
		bytes: ArrayBuffer
	}): Promise<{ artifactId: string }> {
		const { fileName, contentType, contentHash, fileSizeBytes, bytes } = params

		const { artifactId, uploadUrl } = await this.orpc.artifacts.createUpload({
			taskId: this.taskId,
			fileName,
			contentType,
			contentHash,
			fileSizeBytes,
		})

		await fetch(uploadUrl, {
			method: 'PUT',
			body: bytes,
			headers: { 'Content-Type': contentType },
		})

		return { artifactId }
	}

	getCollection(): ArtifactCollectionLike | undefined {
		return this.collection
	}
}

/**
 * Production implementation of ITaskSyncContext.
 * Owns a task's Electric collection and disk-writer subscription,
 * and creates session-scoped SyncManagers.
 */
export class TaskSyncContext implements ITaskSyncContext {
	constructor(
		private readonly orpc: ORPCClient,
		private readonly taskId: string,
		private readonly collection: ArtifactCollectionLike | undefined,
		private readonly actions: ArtifactActions | undefined,
		private readonly tasksCollection: TasksCollection,
	) {}

	createSessionManager(sessionId: string): ISyncManager {
		logger.debug({ sessionId, taskId: this.taskId }, 'Creating SyncManager for session')
		return new SyncManager(this.orpc, this.taskId, sessionId, this.collection, this.actions)
	}

	getCollection(): ArtifactCollectionLike | undefined {
		return this.collection
	}

	getTaskSlug(): string | null {
		return this.tasksCollection.toArray.find((t) => t.id === this.taskId)?.slug ?? null
	}
}

/**
 * Production implementation of ISyncService.
 * Manages task-scoped sync contexts (Electric collections + disk writers).
 * Session-scoped managers are created via TaskSyncContext.createSessionManager().
 */
export class SyncService implements ISyncService {
	private readonly syncOrigin: string
	private readonly token: string
	private readonly orpc: ORPCClient
	private readonly createArtifactsCollectionImpl: NonNullable<SyncServiceOptions['createArtifactsCollection']>
	private readonly setupArtifactPaths: NonNullable<SyncServiceOptions['setupArtifactPaths']>
	private readonly readyTimeoutMs: number

	/** Task-scoped contexts: collection + disk writer + factory for session managers */
	private taskRegistry = new Map<string, TaskArtifactState>()
	/** Guards against concurrent ensureTaskSync calls for the same taskId */
	private pendingTaskSetup = new Map<string, Promise<TaskSyncContext>>()
	/** Keeps references to TaskSyncContexts for shutdown */
	private taskContexts = new Map<string, TaskSyncContext>()

	private readonly tasksCollection: TasksCollection

	constructor(
		orpc: ORPCClient,
		syncOrigin: string,
		token: string,
		tasksCollection: TasksCollection,
		options: SyncServiceOptions = {},
	) {
		this.orpc = orpc
		this.syncOrigin = syncOrigin
		this.token = token
		this.tasksCollection = tasksCollection
		this.createArtifactsCollectionImpl = options.createArtifactsCollection ?? createArtifactsCollection
		this.setupArtifactPaths =
			options.setupArtifactPaths ??
			((cwd, taskId, taskSlug) => {
				if (options.daemonRuntime === undefined) {
					return Promise.reject(new Error('SyncService requires daemonRuntime for artifact path setup'))
				}
				return setupArtifactPaths(cwd, taskId, taskSlug, options.daemonRuntime)
			})
		this.readyTimeoutMs = options.readyTimeoutMs ?? 10_000
	}

	/**
	 * Ensure a task-scoped sync context exists.
	 * Get-or-create semantics for the task collection + disk writer.
	 * Returns a TaskSyncContext from which session managers can be created.
	 *
	 * Steps:
	 * 1. Get or create task's artifacts collection + disk writer subscription
	 * 2. Wait for initial sync readiness (10s timeout)
	 * 3. Return TaskSyncContext for creating session managers
	 */
	async ensureTaskSync(taskId: string, cwd: string): Promise<ITaskSyncContext> {
		// Check if context already exists
		const existing = this.taskContexts.get(taskId)
		if (existing) return existing

		// Concurrent setup in progress — wait for it
		const pending = this.pendingTaskSetup.get(taskId)
		if (pending) return pending

		// Create new
		const setupPromise = this.createTaskContext(taskId, cwd)
		this.pendingTaskSetup.set(taskId, setupPromise)

		try {
			const context = await setupPromise
			this.taskContexts.set(taskId, context)
			return context
		} catch (error) {
			const errMsg = error instanceof Error ? (error.stack ?? error.message) : String(error)
			logger.error({ taskId, errMsg }, 'Failed to create task sync context')
			Sentry.captureException(error, {
				tags: { task_id: taskId },
			})
			// Return a context without a collection — upsert still works via oRPC
			const degraded = new TaskSyncContext(this.orpc, taskId, undefined, undefined, this.tasksCollection)
			this.taskContexts.set(taskId, degraded)
			return degraded
		} finally {
			this.pendingTaskSetup.delete(taskId)
		}
	}

	/**
	 * Shutdown all task collections and disk writer subscriptions.
	 * Called during daemon graceful shutdown.
	 */
	async shutdown(): Promise<void> {
		for (const [taskId, state] of this.taskRegistry) {
			try {
				state.unsubscribe.unsubscribe()
				logger.debug({ taskId }, 'Unsubscribed task disk writer')
			} catch (error) {
				logger.error({ err: error, taskId }, 'Error unsubscribing task disk writer')
				Sentry.captureException(error, {
					tags: { error_type: 'sync_service_unsubscribe', task_id: taskId },
				})
			}
			try {
				await state.cleanup?.()
				logger.debug({ taskId }, 'Cleaned up task artifacts collection')
			} catch (error) {
				logger.error({ err: error, taskId }, 'Error cleaning up task artifacts collection')
				Sentry.captureException(error, {
					tags: { error_type: 'sync_service_collection_cleanup', task_id: taskId },
				})
			}
		}
		this.taskRegistry.clear()
		this.taskContexts.clear()
		this.pendingTaskSetup.clear()
		logger.info('SyncService shutdown complete')
	}

	getDebugState(): SyncServiceDebugState {
		return {
			activeTaskIds: [...this.taskContexts.keys()].sort(),
			registeredTaskIds: [...this.taskRegistry.keys()].sort(),
			pendingTaskIds: [...this.pendingTaskSetup.keys()].sort(),
		}
	}

	/**
	 * Create a task-scoped sync context: collection readiness and disk writer subscription.
	 */
	private async createTaskContext(taskId: string, cwd: string): Promise<TaskSyncContext> {
		logger.debug({ taskId }, 'Creating artifacts collection for task')

		const { collection, createActions, cleanup } = this.createArtifactsCollectionImpl(
			this.syncOrigin,
			this.token,
			taskId,
		)
		let unsubscribe: { unsubscribe: () => void } | undefined

		try {
			// Subscribe before waiting so the disk writer receives both initial state and later changes.
			unsubscribe = this.subscribeDiskWriter(collection, cwd, taskId)
			const artifacts = await withTimeout(collection.toArrayWhenReady(), this.readyTimeoutMs)

			if (artifacts === null) {
				logger.warn(
					{ taskId, readyTimeoutMs: this.readyTimeoutMs },
					'Artifact sync timed out, proceeding without initial artifacts',
				)
				Sentry.captureMessage('Artifact sync timeout', {
					level: 'warning',
					tags: { task_id: taskId },
				})
			} else if (artifacts.length === 0) {
				logger.warn({ taskId }, 'Task sync ready with zero artifacts')
			}

			logger.debug(
				{ taskId, ready: artifacts !== null, artifactCount: artifacts?.length ?? 0 },
				'Artifact sync readiness resolved',
			)

			// Resolve task slug: prefer tasks collection (available at boot), fall back to artifacts
			const taskRecord = this.tasksCollection.toArray.find((t) => t.id === taskId)
			let taskSlug = taskRecord?.slug ?? null
			if (!taskSlug && artifacts) {
				taskSlug = resolveTaskSlug(artifacts)
			}
			if (!taskSlug) {
				logger.warn(
					{ taskId, artifactCount: artifacts?.length ?? 0, taskRecordFound: !!taskRecord },
					'Could not resolve task slug from tasks collection or artifacts',
				)
			}

			// Set up artifact symlink structure eagerly when taskSlug is available
			// This ensures symlinks are ready before subscribeDiskWriter starts, even for tasks with no initial artifacts
			if (taskSlug) {
				await this.setupArtifactPaths(cwd, taskId, taskSlug)
			}

			const actions = createActions(this.orpc, taskId)

			const state: TaskArtifactState = { collection, actions, unsubscribe, cleanup }
			this.taskRegistry.set(taskId, state)
			logger.debug(
				{ taskId, taskSlug, initialArtifactCount: artifacts?.length ?? 0 },
				'Task artifacts collection ready',
			)

			return new TaskSyncContext(this.orpc, taskId, collection, actions, this.tasksCollection)
		} catch (error) {
			unsubscribe?.unsubscribe()
			await cleanup?.()
			throw error
		}
	}

	/**
	 * Subscribe to collection changes and write new/updated artifacts to disk.
	 * Compares content_hash to avoid unnecessary writes (prevents echoing back local writes).
	 */
	private subscribeDiskWriter(
		collection: ArtifactCollectionLike,
		cwd: string,
		taskId: string,
	): { unsubscribe: () => void } {
		let setupPromise: Promise<{ storagePath: string; symlinkPath: string }> | null = null
		const pendingWrites = new Map<string, Promise<void>>()

		const resolveTaskSlugForWrite = (artifact: ArtifactData): string | null => {
			return this.tasksCollection.toArray.find((t) => t.id === taskId)?.slug ?? artifact.task_slug
		}

		const ensurePathsReady = async (taskSlug: string) => {
			if (!setupPromise) {
				setupPromise = this.setupArtifactPaths(cwd, taskId, taskSlug)
			}
			await setupPromise
		}

		return collection.subscribeChanges(
			(changes) => {
				logger.debug(
					{
						taskId,
						changeCount: changes.length,
						types: changes.map((c) => c.type),
						fileNames: changes.map((c) => c.value?.file_name),
						storageTypes: changes.map((c) => c.value?.storage_type),
					},
					'Disk writer: received changes from artifacts collection',
				)
				for (const change of changes) {
					const artifact = change.value
					if (isReservedArtifactTrashSubpath(artifact.file_name)) {
						logger.debug(
							{ taskId, fileName: artifact.file_name, changeType: change.type },
							'Skipping disk management for reserved artifact trash path',
						)
						continue
					}
					const taskSlugForWrite = resolveTaskSlugForWrite(artifact)

					// Handle tombstones from normal updates, reconnect inserts, and shape removals.
					// All three should move any on-disk file into .trash and skip normal writes.
					if (change.type === 'delete' || artifact.is_deleted) {
						if (!taskSlugForWrite) continue
						const taskDir = getArtifactSymlinkPath(cwd, taskSlugForWrite)
						const filePath = join(taskDir, artifact.file_name)
						const deletedDir = join(taskDir, '.trash')
						const deletedPath = join(deletedDir, artifact.file_name)

						const pending = pendingWrites.get(filePath) ?? Promise.resolve()
						const next = pending
							.then(async () => {
								await ensurePathsReady(taskSlugForWrite)
								await mkdir(deletedDir, { recursive: true })
								await rename(filePath, deletedPath).catch(() => {
									// File may not exist on disk (e.g. S3 artifact not yet downloaded)
								})
								logger.warn(
									{ filePath, deletedPath, changeType: change.type },
									'artifact tombstoned: moved to .trash',
								)
							})
							.finally(() => {
								if (pendingWrites.get(filePath) === next) pendingWrites.delete(filePath)
							})
						pendingWrites.set(filePath, next)
						continue
					}

					if (change.type !== 'insert' && change.type !== 'update') continue

					if (!taskSlugForWrite) {
						logger.debug({ taskId, fileName: artifact.file_name }, 'Skipping disk write: no task slug')
						continue
					}

					const taskDir = getArtifactSymlinkPath(cwd, taskSlugForWrite)

					// Handle restore / reconnect after restore: clean up stale .trash copy
					if (artifact.is_deleted === false) {
						const trashedPath = join(taskDir, '.trash', artifact.file_name)
						// Fire-and-forget cleanup of stale .trash copy
						unlink(trashedPath).catch(() => {
							// File may not exist in .trash — that's fine
						})
					}

					// Validate path is within task directory before writing
					const validation = validateArtifactWritePath(artifact.file_name, taskDir)
					if (!validation.valid) {
						logger.warn(
							{ taskId, fileName: artifact.file_name, reason: validation.reason },
							'Rejected artifact write in sync: path traversal detected',
						)
						continue
					}
					const filePath = validation.filePath

					// Serialize writes per file via promise chaining
					const pending = pendingWrites.get(filePath) ?? Promise.resolve()
					const next = pending
						.then(async () => {
							// Ensure paths are set up — all concurrent callbacks await the same promise
							await ensurePathsReady(taskSlugForWrite)

							// S3-backed artifacts: download from S3 instead of writing content string
							if (artifact.storage_type === 's3' && artifact.s3_key) {
								const s3Key = artifact.s3_key
								// Check if file exists on disk with matching hash
								try {
									const existingBytes = await readFile(filePath)
									const existingHashBuffer = await crypto.subtle.digest('SHA-256', existingBytes)
									const existingHash = Array.from(new Uint8Array(existingHashBuffer))
										.map((b) => b.toString(16).padStart(2, '0'))
										.join('')
									if (existingHash === artifact.content_hash) {
										logger.debug(
											{ taskId, fileName: artifact.file_name },
											'S3 disk write skipped: content hash matches',
										)
										return
									}
								} catch {
									// File doesn't exist or can't be read — proceed to download
								}

								// Fetch pre-signed download URL from API
								logger.debug(
									{ taskId, fileName: artifact.file_name, artifactId: artifact.id },
									'Disk writer: fetching S3 download URL',
								)
								const { downloadUrl } = await this.orpc.artifacts.downloadUrl({
									artifactId: artifact.id,
								})
								logger.debug(
									{ taskId, fileName: artifact.file_name },
									'Disk writer: downloading S3 artifact',
								)
								const response = await fetch(downloadUrl)
								if (!response.ok) {
									throw new ArtifactS3DownloadError(
										artifact.id,
										s3Key,
										response.status,
										response.statusText,
									)
								}
								const buffer = await response.arrayBuffer()
								await mkdir(dirname(filePath), { recursive: true })
								await writeFile(filePath, new Uint8Array(buffer))
								logger.info(
									{ taskId, fileName: artifact.file_name, bytes: buffer.byteLength },
									'Disk writer: wrote S3 artifact to disk',
								)
								return
							}

							const onDiskContent = await readFile(filePath, 'utf-8').catch(() => null)
							const onDiskHash = onDiskContent ? hash(onDiskContent) : null
							if (artifact.content_hash === onDiskHash) {
								logger.debug(
									{ taskId, fileName: artifact.file_name },
									'Disk write skipped: content hash matches',
								)
								return
							}

							await mkdir(dirname(filePath), { recursive: true })
							await writeFile(filePath, artifact.content)
							logger.info({ taskId, fileName: artifact.file_name }, 'Disk writer: wrote artifact to disk')
						})
						.catch((error) => {
							if (error instanceof ArtifactS3DownloadError) {
								logger.error(
									{
										artifactId: error.artifactId,
										s3Key: error.s3Key,
										status: error.status,
										statusText: error.statusText,
										taskId,
										fileName: artifact.file_name,
									},
									'Disk writer: failed to download artifact from S3',
								)
								Sentry.captureException(error, {
									tags: { task_id: taskId },
									extra: {
										artifactId: error.artifactId,
										s3Key: error.s3Key,
										status: error.status,
										fileName: artifact.file_name,
									},
								})
							} else {
								logger.error(
									{
										errMessage: error instanceof Error ? error.message : String(error),
										errStack: error instanceof Error ? error.stack : undefined,
										errName: error instanceof Error ? error.name : undefined,
										taskId,
										fileName: artifact.file_name,
										storageType: artifact.storage_type,
										s3Key: artifact.s3_key,
									},
									'Disk writer: failed to write artifact',
								)
								Sentry.captureException(error, {
									tags: { task_id: taskId },
									extra: { fileName: artifact.file_name },
								})
							}
						})
						.finally(() => {
							if (pendingWrites.get(filePath) === next) {
								pendingWrites.delete(filePath)
							}
						})
					pendingWrites.set(filePath, next)
				}
			},
			{ includeInitialState: true },
		)
	}
}
