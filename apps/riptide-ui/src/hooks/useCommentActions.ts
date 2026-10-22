import { useCallback, useMemo } from 'react'
import { uuidv7 } from 'uuidv7'

import { createCommentActions } from '@/actions/comments'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

export interface CommentMutationScope {
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
}

export interface CommentAnchor {
	commentedUponBlockText: string
	previousBlockText: string | null
	nextBlockText: string | null
}

export interface CreateCommentInput extends CommentMutationScope {
	contentText: string
	contentJson?: string
	anchor?: CommentAnchor
	replyToCommentId?: string
}

export interface CommentActionsResult {
	createComment: (input: CreateCommentInput) => boolean
	replyComment: (
		scope: CommentMutationScope,
		replyToCommentId: string,
		contentText: string,
		contentJson?: string,
	) => boolean
	deleteComment: (commentId: string) => void
	editComment: (commentId: string, contentText: string, contentJson: string) => void
	resolveComment: (commentId: string) => void
	unresolveComment: (commentId: string) => void
	resolveAllComments: (artifactId: string) => void
}

/**
 * Shared mutation-only comment actions. This hook intentionally has no selected-
 * artifact query or UI-store dependencies so every wired comment leaf can call it.
 */
export function useCommentActions(): CommentActionsResult {
	const { client } = useRiptideApi()
	const { artifactCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()

	const commentActions = useMemo(
		() =>
			createCommentActions(artifactCommentsCollection, { comments: client.comments }, confirmTx.artifactComments),
		[artifactCommentsCollection, client, confirmTx.artifactComments],
	)

	const createComment = useCallback(
		({
			artifactId,
			taskId,
			resourceOwnerUserId,
			contentText,
			contentJson,
			anchor,
			replyToCommentId,
		}: CreateCommentInput) => {
			if (!dbOrganizationId || !userId) return false
			const baseInput = {
				id: uuidv7(),
				organizationId: dbOrganizationId,
				resourceOwnerUserId,
				taskId,
				createdByUserId: userId,
				artifactId,
				contentText,
				contentJson: contentJson ?? undefined,
			}
			commentActions.createComment(
				replyToCommentId
					? { ...baseInput, replyToCommentId }
					: {
							...baseInput,
							commentedUponBlockText: anchor?.commentedUponBlockText,
							previousBlockText: anchor?.previousBlockText,
							nextBlockText: anchor?.nextBlockText,
						},
			)
			return true
		},
		[commentActions, dbOrganizationId, userId],
	)

	const replyComment = useCallback(
		(scope: CommentMutationScope, replyToCommentId: string, contentText: string, contentJson?: string) =>
			createComment({
				...scope,
				contentText,
				contentJson,
				replyToCommentId,
			}),
		[createComment],
	)

	const deleteComment = useCallback(
		(commentId: string) => {
			void commentActions.deleteComment({ commentId })
		},
		[commentActions],
	)
	const editComment = useCallback(
		(commentId: string, contentText: string, contentJson: string) => {
			commentActions.editComment({ commentId, contentText, contentJson })
		},
		[commentActions],
	)
	const resolveComment = useCallback(
		(commentId: string) => {
			commentActions.resolveComment({ commentId, isResolved: true })
		},
		[commentActions],
	)
	const unresolveComment = useCallback(
		(commentId: string) => {
			commentActions.resolveComment({ commentId, isResolved: false })
		},
		[commentActions],
	)
	const resolveAllComments = useCallback(
		(artifactId: string) => {
			commentActions.resolveAllComments({ artifactId })
		},
		[commentActions],
	)

	return {
		createComment,
		replyComment,
		deleteComment,
		editComment,
		resolveComment,
		unresolveComment,
		resolveAllComments,
	}
}
