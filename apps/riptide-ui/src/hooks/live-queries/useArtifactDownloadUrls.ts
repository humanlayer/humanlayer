import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useRiptideApi } from '@/orpc/client'

/**
 * Prefetch presigned download URLs for all S3 artifacts in a task.
 * Populates the TanStack Query cache so artifact previews load instantly.
 * Call from route-level components (always mounted) rather than conditionally-rendered components.
 */
export function useArtifactDownloadUrls(taskId: string | null | undefined) {
	const { artifactsMetadataCollection } = useSync()
	const { queryClient: api } = useRiptideApi()

	const { data: artifacts } = useLiveQuery(
		(q) =>
			taskId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => eq(artifacts.task_id, taskId))
						.select(({ artifacts }) => ({
							id: artifacts.id,
							storage_type: artifacts.storage_type,
							last_updated_at: artifacts.last_updated_at,
						}))
				: undefined,
		[artifactsMetadataCollection, taskId],
	)

	const s3Artifacts = useMemo(
		() => (artifacts ?? []).filter((artifact) => artifact.storage_type === 's3'),
		[artifacts],
	)

	useQueries({
		queries: s3Artifacts.map((artifact) => ({
			...artifactDownloadUrlQueryOptions(api, artifact),
			staleTime: 4 * 60 * 60 * 1000, // 4 hours — URLs valid for 7 days
			retry: false,
		})),
	})
}
