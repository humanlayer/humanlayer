import type { sessionSelectSchema } from '@humanlayer/db/tables/sessions'
import type { ChangeMessage, WithVirtualProps } from '@tanstack/db'
import type z from 'zod/v4'

/**
 * Session change message type that includes TanStack DB 0.6.x virtual props.
 * Collections emit items wrapped with WithVirtualProps for sync status tracking.
 */
export type SessionChangeMessage = ChangeMessage<
	WithVirtualProps<z.infer<typeof sessionSelectSchema>, string | number>,
	string | number
>

/**
 * Minimal artifact data shape used by sync-service disk operations.
 * This is the subset of Artifact fields actually accessed in sync-service.ts.
 * Both Electric and Query collections produce objects that extend this shape.
 */
export interface ArtifactData {
	id: string
	file_name: string
	content: string
	content_hash: string
	task_slug: string | null
	storage_type: string
	s3_key: string | null
	is_deleted: boolean
}

/**
 * Change message for artifact collections.
 * Uses the minimal ArtifactData shape to ensure compatibility between
 * Electric and Query collections which have different virtual prop wrappers.
 */
export interface ArtifactChangeMessage {
	type: 'insert' | 'update' | 'delete'
	key: string | number
	value: ArtifactData
	previousValue?: ArtifactData
}

/**
 * Minimal interface for artifact collections used in sync-service.
 * Both Electric (createLiveQueryCollection) and Query (createCollection) collections
 * satisfy this interface structurally, enabling polymorphic use without type assertions.
 */
export interface ArtifactCollectionLike {
	readonly toArray: ReadonlyArray<ArtifactData>
	toArrayWhenReady(): Promise<ReadonlyArray<ArtifactData>>
	subscribeChanges(
		callback: (changes: Array<ArtifactChangeMessage>) => void,
		options?: { includeInitialState?: boolean },
	): { unsubscribe: () => void }
}

export const DEFAULT_BACKOFF_OPTIONS = {
	initialDelay: 500,
	maxDelay: 10_000,
	multiplier: 1.3,
	maxRetries: Infinity,
} as const
