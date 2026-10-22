import { and, eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

export interface TaskArtifact {
	id: string
	file_name: string
	task_id: string | null
	task_slug: string | null
	last_updated_at: bigint | null
	resource_owner_user_id: string | null
	share_key: string | null
	share_enabled: boolean | null
	frontmatter?: unknown
}

/**
 * Get artifacts for a task from the artifacts metadata collection.
 * Excludes tombstoned (deleted) artifacts.
 * Returns artifacts ordered by last_updated_at descending.
 */
export function useTaskArtifacts(taskId: string | undefined): TaskArtifact[] {
	const { artifactsMetadataCollection } = useSync()

	const { data: artifacts } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q
				.from({ artifacts: artifactsMetadataCollection })
				.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, false)))
				.select(({ artifacts }) => ({
					id: artifacts.id,
					file_name: artifacts.file_name,
					task_id: artifacts.task_id,
					task_slug: artifacts.task_slug,
					last_updated_at: artifacts.last_updated_at,
					resource_owner_user_id: artifacts.resource_owner_user_id,
					share_key: artifacts.share_key,
					share_enabled: artifacts.share_enabled,
					frontmatter: artifacts.frontmatter,
				}))
				.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc')
		},
		[artifactsMetadataCollection, taskId],
	)

	return artifacts ?? []
}

/**
 * Get deleted (tombstoned) artifacts for a task.
 * Returns artifacts ordered by last_updated_at descending.
 */
export function useDeletedTaskArtifacts(taskId: string | undefined): TaskArtifact[] {
	const { artifactsMetadataCollection } = useSync()

	const { data: artifacts } = useLiveQuery(
		(q) => {
			if (!taskId) return undefined
			return q
				.from({ artifacts: artifactsMetadataCollection })
				.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, true)))
				.select(({ artifacts }) => ({
					id: artifacts.id,
					file_name: artifacts.file_name,
					task_id: artifacts.task_id,
					task_slug: artifacts.task_slug,
					last_updated_at: artifacts.last_updated_at,
					resource_owner_user_id: artifacts.resource_owner_user_id,
					share_key: artifacts.share_key,
					share_enabled: artifacts.share_enabled,
				}))
				.orderBy(({ artifacts }) => artifacts.last_updated_at, 'desc')
		},
		[artifactsMetadataCollection, taskId],
	)

	return artifacts ?? []
}
