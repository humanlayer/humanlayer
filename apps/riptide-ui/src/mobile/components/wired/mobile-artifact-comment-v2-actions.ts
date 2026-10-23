import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { AnchorV2 } from '@humanlayer/ui/artifact-viewer-v2'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

interface MobileV2Identity {
	artifactId: string
	organizationId: string
	resourceOwnerUserId: string
	taskId: string
	createdByUserId: string
}

interface CreateMobileV2RootInput extends MobileV2Identity {
	id: string
	contentText: string
	anchorJson: AnchorV2
}

interface CreateMobileV2ReplyInput extends MobileV2Identity {
	id: string
	rootCommentId: string
	contentText: string
}

interface EditMobileV2CommentInput {
	commentId: string
	contentText: string
}

export function createMobileArtifactCommentV2Actions(
	artifactCommentsCollection: ArtifactCommentsCollection,
	api: Pick<RiptideApiClient, 'comments'>,
	artifactCommentsConfirmTx: ConfirmTxFn,
) {
	const createRootAction = createOptimisticAction<CreateMobileV2RootInput>({
		onMutate: (input) => artifactCommentsCollection.insert(createMobileV2RootRow(input) as never),
		mutationFn: async (input) => {
			const response = await api.comments.create({
				id: input.id,
				artifactId: input.artifactId,
				contentText: input.contentText,
				anchorJson: input.anchorJson,
				kind: 'comment',
			})
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const createReplyAction = createOptimisticAction<CreateMobileV2ReplyInput>({
		onMutate: (input) => artifactCommentsCollection.insert(createMobileV2ReplyRow(input) as never),
		mutationFn: async (input) => {
			const response = await api.comments.create({
				id: input.id,
				artifactId: input.artifactId,
				contentText: input.contentText,
				replyToCommentId: input.rootCommentId,
			})
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const editCommentAction = createOptimisticAction<EditMobileV2CommentInput>({
		onMutate: ({ commentId, contentText }) => {
			artifactCommentsCollection.update(commentId, (draft) => {
				draft.content_text = contentText
				draft.content_json = null
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async ({ commentId, contentText }) => {
			const response = await api.comments.edit({ commentId, contentText })
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const deleteCommentAction = createOptimisticAction<{ commentId: string; memberIds?: string[] }>({
		onMutate: ({ commentId, memberIds }) => {
			const updatedAt = BigInt(Date.now())
			for (const memberId of memberIds ?? [commentId]) {
				artifactCommentsCollection.update(memberId, (draft) => {
					draft.is_deleted = true
					draft.updated_at = updatedAt
				})
			}
		},
		mutationFn: async ({ commentId }) => {
			const response = await api.comments.delete({ commentId })
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const resolveComment = createOptimisticAction<{ commentId: string; isResolved: boolean }>({
		onMutate: ({ commentId, isResolved }) => {
			artifactCommentsCollection.update(commentId, (draft) => {
				draft.is_resolved = isResolved
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async ({ commentId, isResolved }) => {
			const response = await api.comments.resolve({ commentId, isResolved })
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const resolveBatch = async (input: { artifactId: string; rootCommentIds: string[] }) => {
		const response = await api.comments.resolveBatch(input)
		await artifactCommentsConfirmTx(response.transactionId)
		return response
	}

	return {
		createRoot: (input: CreateMobileV2RootInput) => createRootAction(input).isPersisted.promise,
		createReply: (input: CreateMobileV2ReplyInput) => createReplyAction(input).isPersisted.promise,
		editComment: (input: EditMobileV2CommentInput) => editCommentAction(input).isPersisted.promise,
		deleteComment: (input: { commentId: string; memberIds?: string[] }) =>
			deleteCommentAction(input).isPersisted.promise,
		resolveComment,
		resolveBatch,
	}
}

function baseRow(input: MobileV2Identity & { id: string; contentText: string }): ArtifactComment {
	const now = BigInt(Date.now())
	return {
		id: input.id,
		artifact_id: input.artifactId,
		content_text: input.contentText,
		content_json: null,
		anchor_json: null,
		kind: 'comment',
		commented_upon_block_text: null,
		previous_block_text: null,
		next_block_text: null,
		reply_to_comment_id: null,
		is_resolved: false,
		is_deleted: false,
		created_at: now,
		updated_at: now,
		organization_id: input.organizationId,
		resource_owner_user_id: input.resourceOwnerUserId,
		task_id: input.taskId,
		...userAuthoredCommentColumns(input.createdByUserId),
		created_at_artifact_version_id: null,
		resolved_by_user_id: null,
		created_by_agent: false,
	}
}

export function createMobileV2RootRow(input: CreateMobileV2RootInput): ArtifactComment {
	return { ...baseRow(input), anchor_json: input.anchorJson }
}

export function createMobileV2ReplyRow(input: CreateMobileV2ReplyInput): ArtifactComment {
	return { ...baseRow(input), reply_to_comment_id: input.rootCommentId }
}
