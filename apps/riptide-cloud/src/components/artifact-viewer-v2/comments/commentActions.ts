import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import {
	createV2CommentPersistence,
	requireTaskScope,
	type ArtifactCommentEditInput,
	type CreateV2CommentInput,
	type CreateV2ReplyInput,
} from '@humanlayer/ui/artifact-viewer-v2'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ApiClient } from '@/api/client'
import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import type { ConfirmTxFn } from '@/providers/SyncProvider'

/**
 * V2 create params: the extended `comments.create` contract plus the ACL
 * fields the optimistic insert needs (the server re-derives them from the
 * artifact). `anchorJson` is required — every V2 comment is anchored — and the
 * legacy triplet fields are intentionally absent: V2 writes store the anchor
 * envelope only and never dual-write V1's columns.
 */
export type CreateV2CommentParams = CreateV2CommentInput

/**
 * Optimistic V2 comment actions over Cloud's Electric-synced comment
 * collection. Lives beside the V2 composition rather than modifying V1's
 * action module — the V1 path stays legacy-triplet-only.
 */
export function createArtifactCommentV2Actions(
	artifactCommentsCollection: ArtifactCommentsCollection,
	api: Pick<ApiClient['client'], 'comments'>,
	artifactCommentsConfirmTx: ConfirmTxFn,
) {
	const persistence = createV2CommentPersistence({
		insert: (row) => artifactCommentsCollection.insert({ ...row, content_json: row.content_json as never }),
		persist: (params) => api.comments.create(params),
		confirm: artifactCommentsConfirmTx,
	})
	const createComment = createOptimisticAction<CreateV2CommentParams>({
		onMutate: (input) => persistence.optimisticallyInsert(input),
		mutationFn: (input) => persistence.persistAndConfirm(input),
	})
	const editCommentAction = createOptimisticAction<ArtifactCommentEditInput>({
		onMutate: ({ commentId, contentText }) => {
			artifactCommentsCollection.update(commentId, (draft) => {
				draft.content_text = contentText
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async ({ commentId, contentText, contentJson }) => {
			const response = await api.comments.edit({ commentId, contentText, contentJson })
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})
	const editComment = (input: ArtifactCommentEditInput) => editCommentAction(input).isPersisted.promise

	// Undo (`z`) an annotation-only verdict: soft-delete optimistically so the
	// highlight clears instantly (the projector filters `is_deleted`), then
	// confirm the server delete. Only ever called for `deletion`/`approval`
	// comments — free-text comments are never removed this way.
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
	const deleteComment = (input: { commentId: string; memberIds?: string[] }) =>
		deleteCommentAction(input).isPersisted.promise

	// Reply to a V2 root: optimistically insert an unanchored, kind-`comment` row
	// under the root, then persist through the existing `comments.create`
	// contract with `replyToCommentId` (the server flattens to the true root and
	// reopens the thread). Passing the client id keeps the optimistic row and the
	// server row in sync so the reply never duplicates on reconciliation.
	const createReply = createOptimisticAction<CreateV2ReplyInput>({
		onMutate: (input) => {
			const now = BigInt(Date.now())
			const scope = requireTaskScope(input)
			artifactCommentsCollection.insert({
				id: input.id,
				artifact_id: input.artifactId,
				content_text: input.contentText,
				content_json: null,
				anchor_json: null,
				kind: 'comment',
				commented_upon_block_text: null,
				previous_block_text: null,
				next_block_text: null,
				reply_to_comment_id: input.rootCommentId,
				is_resolved: false,
				is_deleted: false,
				created_at: now,
				updated_at: now,
				organization_id: scope.organizationId,
				resource_owner_user_id: scope.resourceOwnerUserId,
				task_id: scope.taskId,
				...userAuthoredCommentColumns(scope.createdByUserId),
				created_at_artifact_version_id: null,
				resolved_by_user_id: null,
				created_by_agent: false,
			})
		},
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

	// Resolve/reopen a whole thread. Optimistically flip the root row's
	// `is_resolved` so the projection re-partitions the thread between the open
	// rail and the Resolved section instantly; the existing `comments.resolve`
	// procedure cascades the state across every non-deleted reply server-side.
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

	return { createComment, editComment, deleteComment, createReply, resolveComment, resolveBatch }
}
