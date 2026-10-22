import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'

import { useRiptideApi } from '@/api/client'
import { artifactDownloadUrlQueryOptions } from '@/hooks/artifact-download-url-query'
import { useSync } from '@/providers/SyncProvider'

function normalizeWhitespace(str: string): string {
	// macOS screenshot filenames use U+202F (narrow no-break space) instead of regular space.
	// Regex matches: U+2000-U+200A (various width spaces), U+202F, U+205F, U+3000 (ideographic space).
	return str.replace(/[  -   　]/g, ' ')
}

/**
 * Gets the S3 presigned URL for a task artifact by filename.
 * Handles Unicode whitespace normalization for macOS screenshot filenames.
 */
export function useTaskArtifactUrl(taskId: string | undefined, fileName: string) {
	const { artifactsMetadataCollection } = useSync()
	const { queryClient: api } = useRiptideApi()

	const normalizedFileName = normalizeWhitespace(fileName)

	const { data: artifactData } = useLiveQuery(
		(q) =>
			taskId && fileName
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => and(eq(artifacts.task_id, taskId), eq(artifacts.is_deleted, false)))
						.select(({ artifacts }) => ({
							id: artifacts.id,
							file_name: artifacts.file_name,
							storage_type: artifacts.storage_type,
							last_updated_at: artifacts.last_updated_at,
						}))
				: undefined,
		[artifactsMetadataCollection, taskId, fileName],
	)

	const artifact = artifactData?.find((a) => normalizeWhitespace(a.file_name) === normalizedFileName)

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
