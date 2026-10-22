import { eq, useLiveQuery } from '@tanstack/react-db'
import { useParams } from '@tanstack/react-router'

import { useSync } from '@/providers/SyncProvider'

/**
 * Gets the task_id from the current route's artifact.
 * Only works on /artifacts/:artifactId routes.
 */
export function useArtifactRouteTaskId() {
	const params = useParams({ strict: false })
	const artifactId = 'artifactId' in params ? (params.artifactId as string) : undefined

	const { artifactsMetadataCollection } = useSync()

	const { data: artifactData, isLoading } = useLiveQuery(
		(q) =>
			artifactId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => eq(artifacts.id, artifactId))
						.select(({ artifacts }) => ({
							task_id: artifacts.task_id,
						}))
				: undefined,
		[artifactsMetadataCollection, artifactId],
	)

	return {
		taskId: artifactData?.[0]?.task_id ?? undefined,
		isLoading: isLoading && !!artifactId,
	}
}
