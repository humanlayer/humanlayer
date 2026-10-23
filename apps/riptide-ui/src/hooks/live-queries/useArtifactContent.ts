import { eq, useLiveQuery } from '@tanstack/react-db'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * Hook to fetch a single artifact by ID, including content.
 * Returns null when artifactId is null (panel closed).
 *
 * Falls back to artifactsMetadataCollection when the full collection
 * hasn't synced the record yet. This is important for S3-stored artifacts
 * (images, PDFs) where content is empty and we only need file_name,
 * storage_type, etc. for rendering.
 */
export function useArtifactContent(artifactId: string | null) {
	const { artifactsCollection, artifactsMetadataCollection } = useSync()

	const { data, isLoading } = useLiveQuery(
		(q) =>
			artifactId
				? q.from({ artifacts: artifactsCollection }).where(({ artifacts }) => eq(artifacts.id, artifactId))
				: undefined,
		[artifactsCollection, artifactId],
	)

	// Fallback: use metadata collection when full collection hasn't synced yet
	const { data: metaData } = useLiveQuery(
		(q) =>
			artifactId && !data?.[0]
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts }) => eq(artifacts.id, artifactId))
				: undefined,
		[artifactsMetadataCollection, artifactId, data],
	)

	// Prefer full artifact (with content), fall back to metadata with empty content
	const artifact = data?.[0] ?? (metaData?.[0] ? { ...metaData[0], content: '' } : null)

	return {
		artifact,
		isLoading,
	}
}
