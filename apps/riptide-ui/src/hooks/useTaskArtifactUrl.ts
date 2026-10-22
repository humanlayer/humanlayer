import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'

import { useSync } from '@/components/providers/SyncProvider'
import { artifactDownloadUrlQueryOptions } from '@/hooks/live-queries/artifact-download-url-query'
import { useTaskIdFromRouteParams } from '@/hooks/useTaskIdFromRouteParams'
import { getTaskArtifactScope, type TaskArtifactReference } from '@/lib/task-artifact-path'
import { useRiptideApi } from '@/orpc/client'

function normalizeWhitespace(str: string): string {
	// macOS screenshot filenames use U+202F (narrow no-break space) instead of regular space.
	return str.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
}

/**
 * Gets the S3 presigned URL for a task artifact, including artifacts of other tasks.
 * Draft tasks can share a slug, so the route task wins among slug matches.
 * Handles Unicode whitespace normalization for macOS screenshot filenames.
 */
export function useTaskArtifactUrl(reference: TaskArtifactReference) {
	const { artifactsMetadataCollection } = useSync()
	const { queryClient: api } = useRiptideApi()
	const routeTaskId = useTaskIdFromRouteParams()

	const { fileName } = reference
	const scope = getTaskArtifactScope(reference, routeTaskId)
	const scopeColumn = scope?.column
	const scopeValue = scope?.value
	const normalizedFileName = normalizeWhitespace(fileName)

	const { data: artifactData } = useLiveQuery(
		(q) => {
			if (!fileName || !scopeColumn || !scopeValue) return undefined
			return q
				.from({ artifacts: artifactsMetadataCollection })
				.where(({ artifacts }) =>
					and(
						eq(scopeColumn === 'task_slug' ? artifacts.task_slug : artifacts.task_id, scopeValue),
						eq(artifacts.is_deleted, false),
					),
				)
				.select(({ artifacts }) => ({
					id: artifacts.id,
					task_id: artifacts.task_id,
					task_slug: artifacts.task_slug,
					file_name: artifacts.file_name,
					storage_type: artifacts.storage_type,
					last_updated_at: artifacts.last_updated_at,
				}))
		},
		[artifactsMetadataCollection, scopeColumn, scopeValue, fileName],
	)

	const matchingArtifacts = artifactData?.filter((a) => normalizeWhitespace(a.file_name) === normalizedFileName)
	const artifact = matchingArtifacts?.find((a) => a.task_id === routeTaskId) ?? matchingArtifacts?.[0]

	const {
		data: downloadUrl,
		isLoading: isUrlLoading,
		error: urlError,
	} = useQuery({
		...artifactDownloadUrlQueryOptions(api, artifact),
		enabled: !!artifact?.id && artifact?.storage_type === 's3',
		staleTime: 4 * 60 * 60 * 1000,
		retry: false,
	})

	return {
		artifact,
		url: downloadUrl?.downloadUrl,
		error: urlError,
		isLoading: artifact?.storage_type === 's3' && isUrlLoading,
	}
}
