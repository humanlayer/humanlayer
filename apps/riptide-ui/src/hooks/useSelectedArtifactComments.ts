import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { partitionCommentRowsByRootFormat } from '@humanlayer/ui/lib/artifact-comment-format'
import type { MarkdownBlockContext } from '@humanlayer/ui/lib/comment-utils'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useArtifactContent } from '@/hooks/live-queries/useArtifactContent'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'

export interface ThreadInput {
	markdownContext?: MarkdownBlockContext | null
	rootComment: {
		id: string
		contentText: string
		isResolved: boolean
		createdByUserId: string
	}
	replies: Array<{
		id: string
		contentText: string
		isResolved: boolean
		createdByUserId: string
	}>
}

export interface SelectedArtifactCommentsResult {
	unresolvedThreads: ThreadInput[]
	unresolvedCount: number
	artifactFilename: string | null
	artifactId: string | null
}

/**
 * Hook that subscribes to the selected artifact from artifactViewerStore,
 * runs a live query for its comments, and computes unresolved threads.
 *
 * This is an autonomous hook - it doesn't require any props/parameters,
 * making it easy to use in any component without prop drilling.
 */
export function useSelectedArtifactComments(): SelectedArtifactCommentsResult {
	const { selectedArtifactId } = useArtifactViewerStore()
	const { artifactCommentsCollection } = useSync()

	// Fetch artifact metadata to get filename
	const { artifact: selectedArtifact } = useArtifactContent(selectedArtifactId)

	// Query comments for selected artifact
	const selectedArtifactCommentsQuery = useLiveQuery(
		(q) => {
			if (!selectedArtifactId) return undefined
			return q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.artifact_id, selectedArtifactId))
		},
		[artifactCommentsCollection, selectedArtifactId],
	)

	const selectedArtifactComments: ArtifactComment[] = (selectedArtifactCommentsQuery.data ?? []) as ArtifactComment[]

	// V1 adapter boundary: only legacy/null-anchor threads participate in V1
	// counts, formatting/export, and command-palette delivery. V2-anchored
	// roots and their replies belong exclusively to the V2 viewer.
	const legacyComments = useMemo(
		() => partitionCommentRowsByRootFormat(selectedArtifactComments).legacy,
		[selectedArtifactComments],
	)

	const unresolvedComments = useMemo(
		() => legacyComments.filter((comment) => !comment.is_deleted && !comment.is_resolved),
		[legacyComments],
	)

	// Compute unresolved threads (extracted from SessionDetailPage lines 328-360)
	const unresolvedThreads = useMemo(() => {
		const rootComments = unresolvedComments.filter((comment) => !comment.reply_to_comment_id)

		return rootComments.map((root) => {
			const replies = unresolvedComments.filter((comment) => comment.reply_to_comment_id === root.id)

			return {
				markdownContext:
					root.commented_upon_block_text || root.previous_block_text || root.next_block_text
						? {
								previousMarkdown: root.previous_block_text,
								currentMarkdown: root.commented_upon_block_text,
								nextMarkdown: root.next_block_text,
							}
						: null,
				rootComment: {
					id: root.id,
					contentText: root.content_text,
					isResolved: root.is_resolved,
					createdByUserId: root.created_by_user_id,
				},
				replies: replies.map((reply) => ({
					id: reply.id,
					contentText: reply.content_text,
					isResolved: reply.is_resolved,
					createdByUserId: reply.created_by_user_id,
				})),
			}
		})
	}, [unresolvedComments])

	return {
		unresolvedThreads,
		unresolvedCount: unresolvedComments.length,
		artifactFilename: selectedArtifact?.file_name ?? null,
		artifactId: selectedArtifactId,
	}
}
