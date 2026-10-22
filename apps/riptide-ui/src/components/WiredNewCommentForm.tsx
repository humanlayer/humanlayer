import { NewCommentForm, type PendingCommentAnchor } from '@humanlayer/ui/components/new-comment-form'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { type CommentMutationScope, useCommentActions } from '@/hooks/useCommentActions'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'

export interface WiredNewCommentFormProps extends CommentMutationScope {
	anchor?: PendingCommentAnchor
	/** Closes the surface and clears any editor-owned pending highlight. */
	onClose?: () => void
}

/**
 * App-connected new-comment leaf. Draft persistence remains in the pure form,
 * while mutation success and surface cleanup are coordinated here.
 */
export function WiredNewCommentForm({
	artifactId,
	taskId,
	resourceOwnerUserId,
	anchor,
	onClose,
}: WiredNewCommentFormProps) {
	const { createComment } = useCommentActions()
	const { userId } = useUserInfo()
	const { membersMap } = useOrgMembers()
	const currentMember = userId ? membersMap.get(userId) : undefined
	const currentUserDisplayName = currentMember
		? [currentMember.firstName, currentMember.lastName].filter(Boolean).join(' ') || currentMember.email
		: undefined

	const handleSubmit = useCallback(
		(contentText: string, contentJson?: string, submittedAnchor?: PendingCommentAnchor) => {
			const created = createComment({
				artifactId,
				taskId,
				resourceOwnerUserId,
				contentText,
				contentJson,
				anchor: submittedAnchor ?? anchor,
			})
			if (!created) return false

			toast.success('Comment added', { duration: 3000, closeButton: true })
			return true
		},
		[anchor, artifactId, createComment, resourceOwnerUserId, taskId],
	)

	return (
		<NewCommentForm
			artifactId={artifactId}
			onSubmit={handleSubmit}
			pendingCommentAnchor={anchor}
			onCancelHighlight={onClose}
			currentUserDisplayName={currentUserDisplayName}
		/>
	)
}
