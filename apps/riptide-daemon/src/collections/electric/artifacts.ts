import { type Artifact, artifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import { AWAIT_TX_TIMEOUT, createElectricSyncErrorHandler } from '@humanlayer/sync'
import { BasicIndex, createCollection, createLiveQueryCollection, createOptimisticAction } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'

import { Sentry } from '@/instrument'
import logger from '@/logger'
import type { ORPCClient } from '@/orpc/client'

import { DEFAULT_BACKOFF_OPTIONS } from '../types'

// Re-export Artifact type for use in query/artifacts.ts
export type { Artifact }

// Types are derived from function return type to avoid issues with 0.6.x virtual props
export type ArtifactsCollectionResult = ReturnType<typeof createArtifactsCollection>
export type ArtifactsCollection = ArtifactsCollectionResult['collection']

export interface ArtifactUpsertInput {
	fileName: string
	content: string
	sessionId: string
	operationType: 'Write' | 'Edit' | 'MultiEdit' | 'Read'
	operationContents: Record<string, unknown>
	frontmatter?: Record<string, unknown>
}

export interface ArtifactActions {
	upsertArtifact(input: ArtifactUpsertInput): Promise<{ artifactId: string; designQuestionsResolved?: boolean }>
}

/**
 * Create a new artifacts collection for a specific task.
 * Uses the /v1/tasks/:taskId/artifacts endpoint with daemon authentication.
 *
 * @param syncOrigin - The Electric sync origin URL
 * @param token - The daemon authentication token
 * @param taskId - The task identifier for scoping artifacts
 */
export function createArtifactsCollection(syncOrigin: string, token: string, taskId: string) {
	logger.debug({ taskId }, 'Initializing artifacts electric collection for task')
	const artifactsElectricCollection = createCollection(
		electricCollectionOptions({
			schema: artifactSelectSchema,
			shapeOptions: {
				url: `${syncOrigin}/v1/tasks/${taskId}/artifacts`,
				subsetMethod: 'POST',
				headers: {
					'x-daemon-authorization': token,
				},
				onError: createElectricSyncErrorHandler({
					collectionName: 'artifacts',
					shouldRetryOnFailure: true,
					logger,
					captureException: (error, { tags }) => Sentry.captureException(error, { tags }),
				}),
				backoffOptions: DEFAULT_BACKOFF_OPTIONS,
			},
			autoIndex: 'eager',
			defaultIndexType: BasicIndex,
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true, // Start sync immediately — don't wait for first subscriber
		}),
	)
	logger.debug({ taskId }, 'Artifacts electric collection initialized')

	const collection = createLiveQueryCollection({
		query: (q) => q.from({ artifacts: artifactsElectricCollection }),
		getKey: (item) => item.id,
	})

	/**
	 * Create artifact actions for a specific session.
	 *
	 * @param orpc - The daemon oRPC client
	 * @param actionsTaskId - The task identifier
	 */
	function createActions(orpc: ORPCClient, actionsTaskId: string): ArtifactActions {
		// Per-call deferreds keyed by optimistic action ID.
		// Supports concurrent upserts (e.g. AgentLayer's parallel hook execution).
		const pendingUpserts = new Map<
			string,
			PromiseWithResolvers<{
				artifactId: string
				transactionId: string
				created: boolean
				designQuestionsResolved?: boolean
			}>
		>()

		/** Placeholder UUID for optimistic inserts — passes schema validation but is clearly not real */
		const PLACEHOLDER_UUID = '00000000-0000-0000-0000-000000000000'

		const upsertAction = createOptimisticAction<ArtifactUpsertInput & { taskId: string; id: string }>({
			onMutate: ({ id, fileName, content, frontmatter }) => {
				const existing = collection.toArray.find((a) => a.file_name === fileName)
				if (existing) {
					// Apply optimistic update to the BASE electric collection
					// This keeps the merged view in sync with disk state
					artifactsElectricCollection.update(existing.id, (draft) => {
						draft.content = content
						draft.content_hash = hash(content)
						draft.frontmatter = frontmatter ?? draft.frontmatter
						draft.last_updated_at = BigInt(Date.now())
					})
				} else {
					// Optimistic insert for new artifacts using client-generated UUID.
					// Placeholder values for org/user fields pass schema validation and are
					// overwritten when Electric delivers the real server-side row.
					artifactsElectricCollection.insert({
						id,
						task_id: actionsTaskId,
						task_slug: null,
						file_name: fileName,
						content,
						content_hash: hash(content),
						frontmatter: frontmatter ?? {},
						resource_owner_user_id: '',
						organization_id: PLACEHOLDER_UUID,
						created_by: '',
						created_at: BigInt(Date.now()),
						last_updated_at: BigInt(Date.now()),
						share_key: null,
						shared_by: null,
						share_enabled: false,
						public_permission: 'off',
						is_deleted: false,
						storage_type: 'postgres',
						s3_key: null,
						content_type: null,
						file_size_bytes: null,
					})
				}
			},
			mutationFn: async ({
				id,
				taskId: txTaskId,
				sessionId,
				fileName,
				content,
				operationType,
				operationContents,
				frontmatter,
			}) => {
				// Phase 1: API call — if this fails, no data was persisted
				let result: {
					artifactId: string
					transactionId: string
					created: boolean
					designQuestionsResolved?: boolean
				}
				try {
					result = await orpc.artifacts.upsert({
						id,
						taskId: txTaskId,
						sessionId,
						fileName,
						content,
						operationType: operationType as 'Write' | 'Edit' | 'MultiEdit',
						operationContents,
						frontmatter,
					})
				} catch (error) {
					logger.error(
						{ err: error, taskId: txTaskId, fileName, operationType },
						'Optimistic upsert: API call failed, rolling back optimistic state',
					)
					Sentry.captureException(error, {
						tags: { task_id: txTaskId },
						extra: { fileName, operationType },
					})
					const deferred = pendingUpserts.get(id)
					if (deferred) {
						deferred.reject(error)
						pendingUpserts.delete(id)
					}
					throw error // Transaction rollback: optimistic overlay removed
				}

				// Resolve so the caller gets artifactId immediately
				const deferred = pendingUpserts.get(id)
				if (deferred) {
					deferred.resolve(result)
					pendingUpserts.delete(id)
				}

				// Phase 2: Wait for Electric to deliver the server row.
				// If this step times out or throws, mutationFn throws → Transaction.commit() catches
				// → calls rollback() → sets state='failed', rejects isPersisted, calls
				// touchCollection() → collection recalculates merged view without the
				// optimistic overlay. Data IS persisted server-side; sync will
				// eventually deliver it.
				try {
					await artifactsElectricCollection.utils.awaitTxId(Number(result.transactionId), AWAIT_TX_TIMEOUT)
				} catch (error) {
					logger.error(
						{ err: error, taskId: txTaskId, fileName, transactionId: result.transactionId },
						'Optimistic upsert: sync confirmation timed out — optimistic state will be rolled back. Data was persisted server-side.',
					)
					Sentry.captureException(error, {
						tags: { task_id: txTaskId },
						extra: { fileName, transactionId: result.transactionId },
					})
					throw error // Transaction rollback: optimistic overlay removed
				}

				return result
			},
		})

		async function upsertArtifact(
			input: ArtifactUpsertInput,
		): Promise<{ artifactId: string; designQuestionsResolved?: boolean }> {
			const id = uuidv7()
			const deferred = Promise.withResolvers<{
				artifactId: string
				transactionId: string
				created: boolean
				designQuestionsResolved?: boolean
			}>()
			pendingUpserts.set(id, deferred)
			upsertAction({ ...input, id, taskId: actionsTaskId })
			const result = await deferred.promise
			return { artifactId: result.artifactId, designQuestionsResolved: result.designQuestionsResolved }
		}

		return { upsertArtifact }
	}

	return {
		collection,
		createActions,
		cleanup: async () => {
			await collection.cleanup()
			await artifactsElectricCollection.cleanup()
		},
	}
}
