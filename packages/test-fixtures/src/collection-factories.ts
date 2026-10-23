/**
 * Collection Factories
 *
 * Pre-configured collection creators for each Electric proxy endpoint.
 * These make it easy to create typed collections for testing.
 */
import { approvalSelectSchema } from '@humanlayer/db/tables/approvals'
import { artifactCommentSelectSchema, publicArtifactCommentSelectSchema } from '@humanlayer/db/tables/artifact-comments'
import { artifactSelectSchema, publicArtifactSelectSchema } from '@humanlayer/db/tables/artifacts'
import { conversationEventSelectSchema } from '@humanlayer/db/tables/conversation-events'
import { diffCommentSelectSchema } from '@humanlayer/db/tables/diff-comments'
import { onlineHostSelectSchema } from '@humanlayer/db/tables/online-hosts'
import { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAclSelectSchema } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAclSelectSchema } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettingsSelectSchema } from '@humanlayer/db/tables/task-user-settings'
import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { taskSelectSchema } from '@humanlayer/db/tables/tasks'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

import type { ProxyServer } from './electric-test-context'

// =============================================================================
// Types
// =============================================================================

export type CollectionFactoryOpts = {
	/** The proxy server port to connect to */
	proxyPort: number
	/** Optional error handler */
	onError?: (err: unknown) => void
}

export type CollectionFromServer = {
	/** The proxy server to connect to */
	server: ProxyServer
	/** Optional error handler */
	onError?: (err: unknown) => void
	/** Whether to start syncing immediately (default: true) */
	startSync?: boolean
}

// Helper to normalize options
function normalizeOpts(opts: CollectionFactoryOpts | CollectionFromServer): CollectionFactoryOpts {
	if ('server' in opts) {
		return {
			proxyPort: opts.server.port,
			onError: opts.onError,
		}
	}
	return opts
}

// =============================================================================
// Sessions Collection
// =============================================================================

export function createSessionsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: sessionSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/sessions`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createSessionsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: sessionSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/sessions`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type SessionsCollection = ReturnType<typeof createSessionsCollection>

// =============================================================================
// Sessions by Host Collection
// =============================================================================

export function createSessionsByHostCollection(
	opts: (CollectionFactoryOpts | CollectionFromServer) & { hostId: string },
) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: sessionSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/sessions/${opts.hostId}`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type SessionsByHostCollection = ReturnType<typeof createSessionsByHostCollection>

// =============================================================================
// Tasks Collection
// =============================================================================

export function createTasksCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/tasks`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createTasksV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/tasks`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type TasksCollection = ReturnType<typeof createTasksCollection>

// =============================================================================
// Events Collection
// =============================================================================

export function createEventsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: conversationEventSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/events`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createEventsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: conversationEventSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/events`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type EventsCollection = ReturnType<typeof createEventsCollection>

// =============================================================================
// Approvals Collection
// =============================================================================

export function createApprovalsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: approvalSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/approvals`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createApprovalsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: approvalSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/approvals`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type ApprovalsCollection = ReturnType<typeof createApprovalsCollection>

// =============================================================================
// Artifact Comments Collection
// =============================================================================

export function createArtifactCommentsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactCommentSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/artifact-comments`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createArtifactCommentsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactCommentSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/artifact-comments`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type ArtifactCommentsCollection = ReturnType<typeof createArtifactCommentsCollection>

// =============================================================================
// Diff Comments Collection
// =============================================================================

export function createDiffCommentsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: diffCommentSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/diff-comments`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type DiffCommentsCollection = ReturnType<typeof createDiffCommentsV2Collection>

// =============================================================================
// Daemon Approvals Collection (scoped by hostId in auth token)
// =============================================================================

export function createDaemonApprovalsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: approvalSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/daemon/approvals`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type DaemonApprovalsCollection = ReturnType<typeof createDaemonApprovalsCollection>

// =============================================================================
// Hosts Collection
// =============================================================================

export function createHostsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: onlineHostSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/hosts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.host_id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createHostsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: onlineHostSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/hosts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.host_id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createHostsV3Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: onlineHostSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v3/hosts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => JSON.stringify([item.host_id, item.organization_id, item.user_id]),
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type HostsCollection = ReturnType<typeof createHostsCollection>

// =============================================================================
// Task User ACL Collection
// =============================================================================

export function createTaskUserAclCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskUserAclSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/task-user-acls`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createTaskUserAclV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskUserAclSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/task-user-acls`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type TaskUserAclCollection = ReturnType<typeof createTaskUserAclCollection>

// =============================================================================
// Task Organization ACL Collection
// =============================================================================

export function createTaskOrgAclCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskOrganizationAclSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/task-organization-acls`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createTaskOrgAclV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskOrganizationAclSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/task-organization-acls`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type TaskOrgAclCollection = ReturnType<typeof createTaskOrgAclCollection>

// =============================================================================
// Task User Settings Collection
// =============================================================================

export function createTaskUserSettingsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskUserSettingsSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/task-user-settings`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createTaskUserSettingsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskUserSettingsSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/task-user-settings`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type TaskUserSettingsCollection = ReturnType<typeof createTaskUserSettingsCollection>

// =============================================================================
// Task Workspace Setup For Host Collections
// =============================================================================

export function createTaskWorkspaceSetupForHostV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskWorkspaceSetupForHostSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/task-workspace-setup-for-host`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createDaemonWorkspaceSetupCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: taskWorkspaceSetupForHostSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/daemon/workspace-setup`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type TaskWorkspaceSetupForHostCollection = ReturnType<typeof createTaskWorkspaceSetupForHostV2Collection>

// =============================================================================
// Artifacts Collection
// =============================================================================

/** All artifacts the user has access to */
export function createArtifactsCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/artifacts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createArtifactsV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/artifacts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

/** Artifacts for a specific task */
export function createTaskArtifactsCollection(
	opts: (CollectionFactoryOpts | CollectionFromServer) & { taskId: string },
) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/tasks/${opts.taskId}/artifacts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createTaskArtifactsV2Collection(
	opts: (CollectionFactoryOpts | CollectionFromServer) & { taskId: string },
) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactSelectSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/tasks/${opts.taskId}/artifacts`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type ArtifactsCollection = ReturnType<typeof createArtifactsCollection>
export type TaskArtifactsCollection = ReturnType<typeof createTaskArtifactsCollection>

// =============================================================================
// Artifacts Metadata Collection (no content column)
// =============================================================================

const artifactMetadataSchema = artifactSelectSchema.omit({ content: true })

/** All artifacts metadata (no content) the user has access to */
export function createArtifactsMetadataCollection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactMetadataSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v1/artifacts/metadata`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export function createArtifactsMetadataV2Collection(opts: CollectionFactoryOpts | CollectionFromServer) {
	const { proxyPort, onError } = normalizeOpts(opts)

	return createCollection(
		electricCollectionOptions({
			schema: artifactMetadataSchema,
			shapeOptions: {
				url: `http://localhost:${proxyPort}/v2/artifacts/metadata`,
				subsetMethod: 'POST',
				onError: (err) => {
					onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type ArtifactsMetadataCollection = ReturnType<typeof createArtifactsMetadataCollection>

// =============================================================================
// Shared Artifact Collection (public, using share key)
// =============================================================================

/** Single shared artifact via share key (no auth required) */
export function createSharedArtifactCollection(opts: {
	proxyPort: number
	artifactId: string
	shareKey: string
	onError?: (err: unknown) => void
}) {
	return createCollection(
		electricCollectionOptions({
			schema: publicArtifactSelectSchema,
			shapeOptions: {
				url: `http://localhost:${opts.proxyPort}/v1/shared/artifacts/${opts.artifactId}`,
				subsetMethod: 'POST',
				headers: {
					'x-share-key': opts.shareKey,
				},
				onError: (err) => {
					opts.onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type SharedArtifactCollection = ReturnType<typeof createSharedArtifactCollection>

/** Comments for a single shared artifact via share key (no auth required). */
export function createSharedArtifactCommentsCollection(opts: {
	proxyPort: number
	artifactId: string
	shareKey: string
	onError?: (err: unknown) => void
}) {
	return createCollection(
		electricCollectionOptions({
			schema: publicArtifactCommentSelectSchema,
			shapeOptions: {
				url: `http://localhost:${opts.proxyPort}/v1/shared/artifacts/${opts.artifactId}/comments`,
				subsetMethod: 'POST',
				headers: { 'x-share-key': opts.shareKey },
				onError: (err) => {
					opts.onError?.(err)
					return {}
				},
			},
			getKey: (item) => item.id,
			syncMode: 'on-demand',
			startSync: true,
		}),
	)
}

export type SharedArtifactCommentsCollection = ReturnType<typeof createSharedArtifactCommentsCollection>

// =============================================================================
// LiveQueryCollection Wrapper
// =============================================================================

/**
 * Create a LiveQueryCollection wrapper around an Electric collection.
 * This provides reactive querying capabilities on top of the synced data.
 *
 * NOTE: Uses `any` type casting to avoid complex @tanstack/db generic inference issues.
 * The collections work correctly at runtime; we just bypass strict compile-time checking.
 *
 * @param electricCollection - The Electric collection to wrap
 * @param getKey - Optional key extractor function. Defaults to item.id. Use item.host_id for hosts.
 */
export function wrapWithLiveQuery(electricCollection: any, getKey?: (item: any) => string) {
	return createLiveQueryCollection({
		query: (q: any) => q.from({ items: electricCollection }),
		getKey: getKey ?? ((item: { id: string }) => item.id),
	})
}

export type LiveQueryWrapped = ReturnType<typeof wrapWithLiveQuery>
