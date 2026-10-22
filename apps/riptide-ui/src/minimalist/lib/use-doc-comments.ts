import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { AnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { uuidv7 } from 'uuidv7'

import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { createArtifactCommentV2Actions } from '@/components/artifact-viewer-v2/comments/commentActions'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'
import { memberName } from '@/minimalist/lib/access'
import type { CommentPerson } from '@/minimalist/lib/people'
import { useUi } from '@/minimalist/lib/ui-state'
import { useRiptideApi } from '@/orpc/client'

/**
 * Comment actions on one artifact, written the way the standard viewer writes them so both
 * interfaces show the same threads. Changes show at once; one that fails to save is undone and
 * says so. A comment or reply that fails offers its text back, since the box has closed.
 */
export function useDocComments(task: Pick<Task, 'id' | 'resource_owner_user_id'>, artifactId: string) {
	const { client } = useRiptideApi()
	const { artifactCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const { showToast } = useUi()
	const actions = createArtifactCommentV2Actions(
		artifactCommentsCollection as ArtifactCommentsCollection,
		{ comments: client.comments },
		confirmTx.artifactComments,
	)
	// Writes stamp the task scope on the row they show at once; it isn't known until your account loads.
	const scope =
		dbOrganizationId && userId
			? {
					organizationId: dbOrganizationId,
					resourceOwnerUserId: task.resource_owner_user_id,
					taskId: task.id,
					createdByUserId: userId,
				}
			: null
	const offerText = (message: string, text: string) =>
		showToast(message, { label: 'Copy text', run: () => void navigator.clipboard.writeText(text) })
	const onFailure = (promise: Promise<unknown>, report: () => void) => void promise.catch(report)

	return {
		userId,
		/** Saves a comment on the anchored text. False when your account hasn't loaded, so nothing was saved. */
		create: (anchor: AnchorV2, text: string) => {
			if (!scope) return false
			const saving = actions.createComment({
				id: uuidv7(),
				artifactId,
				contentText: text,
				anchorJson: anchor,
				kind: 'comment',
				...scope,
			})
			onFailure(saving.isPersisted.promise, () => offerText('Could not save the comment.', text))
			return true
		},
		/** Replies under a thread's first comment. False when your account hasn't loaded. */
		reply: (rootId: string, text: string) => {
			if (!scope) return false
			const saving = actions.createReply({
				id: uuidv7(),
				artifactId,
				rootCommentId: rootId,
				contentText: text,
				...scope,
			})
			onFailure(saving.isPersisted.promise, () => offerText('Could not save the reply.', text))
			return true
		},
		edit: (commentId: string, text: string) =>
			onFailure(actions.editComment({ commentId, contentText: text, contentJson: null }), () =>
				offerText('Could not save the edit. The comment is as it was.', text),
			),
		/** Deleting a thread's first comment deletes its replies too. */
		remove: (comment: ArtifactComment) =>
			onFailure(actions.deleteComment({ commentId: comment.id }), () =>
				showToast('Could not delete the comment. It is back.'),
			),
		setResolved: (rootId: string, resolved: boolean) =>
			onFailure(actions.resolveComment({ commentId: rootId, isResolved: resolved }).isPersisted.promise, () =>
				showToast(
					resolved ? 'Could not resolve the thread. It is still open.' : 'Could not reopen the thread.',
				),
			),
		/** Resolves threads the agent was sent. The send worked either way, so a failure only says so. */
		resolveSent: (rootIds: string[]) =>
			onFailure(actions.resolveBatch({ artifactId, rootCommentIds: rootIds }), () =>
				showToast('Sent, but could not resolve the threads. Resolve them here once the agent has read them.'),
			),
	}
}

/** A comment's author as the document shows them: a member, a guest on a share link, or the agent. */
export function useCommentAuthor() {
	const { membersMap } = useOrgMembers()
	return (comment: ArtifactComment) => {
		if (comment.created_by_agent) return 'The agent'
		if (comment.anonymous_guest_name) return `${comment.anonymous_guest_name} (guest)`
		return memberName(comment.created_by_user_id ? membersMap.get(comment.created_by_user_id) : undefined)
	}
}

/** A comment's author with their picture, for its byline. Guests on a share link have no picture. */
export function useCommentPerson() {
	const { membersMap } = useOrgMembers()
	return (comment: ArtifactComment): CommentPerson => {
		if (comment.anonymous_guest_name && !comment.created_by_agent)
			return { name: `${comment.anonymous_guest_name} (guest)`, agent: false }
		const member = comment.created_by_user_id ? membersMap.get(comment.created_by_user_id) : undefined
		return { name: memberName(member), src: member?.profilePictureUrl, agent: comment.created_by_agent }
	}
}
