import type { CommentThreadGroup } from '@humanlayer/ui/components/artifact-comment-panel'
import { CommentThread, type UserInfo } from '@humanlayer/ui/components/comment-thread'
import type { GetMarkdownContextForComment } from '@humanlayer/ui/lib/comment-utils'
import { useCallback, useMemo } from 'react'

import { useSessionInputStore } from '@/hooks/stores/sessionInputStore'
import { useCommentActions } from '@/hooks/useCommentActions'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'

export interface WiredCommentThreadProps {
	thread: CommentThreadGroup
	artifactFilename?: string
	/** Live call sites always supply the editor-derived context resolver. */
	getMarkdownContextForComment: GetMarkdownContextForComment
	onCollapse?: () => void
	isOutdated?: boolean
}

/**
 * App-connected comment leaf. The caller supplies only the thread and
 * presentation details that belong to its surface; identity, member data,
 * mutations, and the session-input bridge are derived here.
 */
export function WiredCommentThread({
	thread,
	artifactFilename,
	getMarkdownContextForComment,
	onCollapse,
	isOutdated,
}: WiredCommentThreadProps) {
	const { root, replies } = thread
	const { membersMap } = useOrgMembers()
	const { userId } = useUserInfo()
	const appendToEditor = useSessionInputStore((state) => state.appendToEditor)
	const { replyComment, deleteComment, editComment, resolveComment, unresolveComment } = useCommentActions()

	const userLookup = useMemo(() => {
		const lookup = new Map<string, UserInfo>()
		for (const [id, member] of membersMap) {
			lookup.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
				avatarUrl: member.profilePictureUrl,
			})
		}
		return lookup
	}, [membersMap])

	const handleReply = useCallback(
		(parentCommentId: string, contentText: string, contentJson: string) => {
			return replyComment(
				{
					artifactId: root.artifact_id,
					taskId: root.task_id,
					resourceOwnerUserId: root.resource_owner_user_id,
				},
				parentCommentId,
				contentText,
				contentJson,
			)
		},
		[replyComment, root.artifact_id, root.resource_owner_user_id, root.task_id],
	)

	return (
		<CommentThread
			artifactFilename={artifactFilename}
			rootComment={root}
			replies={replies}
			onReply={handleReply}
			onDelete={deleteComment}
			onEdit={editComment}
			onResolve={root.is_resolved ? undefined : resolveComment}
			onUnresolve={root.is_resolved ? unresolveComment : undefined}
			onCollapse={onCollapse}
			currentUserId={userId ?? ''}
			userLookup={userLookup}
			getMarkdownContextForComment={getMarkdownContextForComment}
			isOutdated={isOutdated}
			onAppendToAgentInput={appendToEditor ?? undefined}
		/>
	)
}
