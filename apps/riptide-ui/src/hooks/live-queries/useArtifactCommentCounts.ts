import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { SessionArtifact } from '@/utils/sidebar-transforms'

interface OpenCommentCountRow {
	artifact_id: string
}

export function countOpenCommentsByArtifact(
	rows: OpenCommentCountRow[],
	artifactIds: ReadonlySet<string>,
): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const row of rows) {
		if (!row.artifact_id || !artifactIds.has(row.artifact_id)) continue
		counts[row.artifact_id] = (counts[row.artifact_id] ?? 0) + 1
	}
	return counts
}

/**
 * Live count of open (unresolved, non-deleted) comments per artifact, scoped to the
 * given list. Comment sync is org-scoped, so we filter to the provided artifacts
 * client-side.
 */
export function useArtifactCommentCounts(artifacts: SessionArtifact[]): Record<string, number> {
	const { artifactCommentsCollection } = useSync()

	const openCommentsQuery = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => and(eq(comments.is_resolved, false), eq(comments.is_deleted, false)))
				.select(({ comments }) => ({ artifact_id: comments.artifact_id })),
		[artifactCommentsCollection],
	)

	return useMemo(() => {
		const artifactIds = new Set(artifacts.map((a) => a.id).filter((id): id is string => !!id))
		return countOpenCommentsByArtifact(openCommentsQuery.data ?? [], artifactIds)
	}, [openCommentsQuery.data, artifacts])
}
