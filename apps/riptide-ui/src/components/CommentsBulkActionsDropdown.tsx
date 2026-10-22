import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	CommentsBulkActionsDropdownView,
	type CommentsBulkActionsModel,
	useCommentsBulkActionsModel,
} from '@humanlayer/ui/components/comments-bulk-actions-dropdown'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { type FC, useCallback, useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSessionInputStore } from '@/hooks/stores/sessionInputStore'
import { useCommentActions } from '@/hooks/useCommentActions'
import { useOrgMembers } from '@/hooks/useOrgMembers'

interface CommentsBulkActionsDropdownProps {
	artifactId: string
	artifactFilename?: string
	className?: string
}

export function useWiredCommentsBulkActions({
	artifactId,
	artifactFilename,
}: Omit<CommentsBulkActionsDropdownProps, 'className'>): CommentsBulkActionsModel {
	const { artifactCommentsCollection } = useSync()
	const { membersMap } = useOrgMembers()
	const { resolveAllComments } = useCommentActions()
	// Use the autonomous append handler from sessionInputStore
	const appendToEditor = useSessionInputStore((s) => s.appendToEditor)

	const commentsQuery = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.artifact_id, artifactId)),
		[artifactCommentsCollection, artifactId],
	)
	const allComments: ArtifactComment[] = (commentsQuery.data ?? []) as ArtifactComment[]

	const userLookup = useMemo(() => {
		const map = new Map<string, { displayName?: string }>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
			})
		}
		return map
	}, [membersMap])

	const unresolvedThreads = useMemo(() => {
		const activeComments = allComments.filter((c) => !c.is_deleted && !c.is_resolved)
		const rootComments = activeComments.filter((c) => !c.reply_to_comment_id)
		return rootComments.map((root) => {
			const replies = allComments.filter((c) => !c.is_deleted && c.reply_to_comment_id === root.id)
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
				replies: replies.map((r) => ({
					id: r.id,
					contentText: r.content_text,
					isResolved: r.is_resolved,
					createdByUserId: r.created_by_user_id,
				})),
			}
		})
	}, [allComments])

	const handleResolveAll = useCallback(() => {
		resolveAllComments(artifactId)
	}, [resolveAllComments, artifactId])

	return useCommentsBulkActionsModel({
		artifactFilename,
		threads: unresolvedThreads,
		userLookup,
		onAppendToAgentInput: appendToEditor ?? undefined,
		onResolveAll: handleResolveAll,
	})
}

/** Wired version that queries comments and passes them to the pure dropdown. */
export const CommentsBulkActionsDropdown: FC<CommentsBulkActionsDropdownProps> = ({ className, ...props }) => {
	const model = useWiredCommentsBulkActions(props)
	return <CommentsBulkActionsDropdownView model={model} className={className} />
}
