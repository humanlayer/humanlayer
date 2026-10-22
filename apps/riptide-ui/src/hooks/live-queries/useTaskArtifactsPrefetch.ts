import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Prefetches full artifact content (including body) for a task into TanStack DB's local store.
 * This ensures that when the user clicks an artifact to view it, the content is already
 * available locally and renders instantly instead of waiting for an Electric sync round-trip.
 *
 * Non-blocking — callers don't depend on this data for rendering.
 */
export function useTaskArtifactsPrefetch(taskId: string | null | undefined) {
	const { artifactsCollection } = useSync()

	useLiveQuery(
		(q) =>
			taskId
				? q.from({ artifacts: artifactsCollection }).where(({ artifacts }) => eq(artifacts.task_id, taskId))
				: undefined,
		[artifactsCollection, taskId],
	)
}
