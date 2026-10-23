import { userAuthoredCommentColumns } from '@humanlayer/db/artifact-comment-author'
import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import type { QueryArtifactCommentsCollection } from '@/collections/query/artifact-comments'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

// Derive types from contract instead of manual interfaces
type ResolveCommentParams = RiptideApiInputs['comments']['resolve']
type DeleteCommentParams = RiptideApiInputs['comments']['delete']
type ResolveAllCommentsParams = RiptideApiInputs['comments']['resolveAll']
type EditCommentParams = RiptideApiInputs['comments']['edit']

// Extended create params with ACL fields needed for optimistic insert
// (these fields are copied from the artifact on the server side)
type CreateCommentParams = RiptideApiInputs['comments']['create'] & {
	id: string // required — caller generates uuidv7()
	organizationId: string
	resourceOwnerUserId: string
	taskId: string
	createdByUserId: string
}

/**
 * Creates optimistic actions for artifact comment mutations.
 */
export function createCommentActions(
	artifactCommentsCollection: ArtifactCommentsCollection | QueryArtifactCommentsCollection,
	api: Pick<RiptideApiClient, 'comments'>,
	artifactCommentsConfirmTx: ConfirmTxFn,
) {
	const sanitizeBlockText = (text: string | null | undefined): string | null => {
		const normalized = text?.trim()
		return normalized ? normalized : null
	}

	const createComment = createOptimisticAction<CreateCommentParams>({
		onMutate: (params) => {
			artifactCommentsCollection.insert({
				id: params.id,
				artifact_id: params.artifactId,
				content_text: params.contentText,
				content_json: params.contentJson ?? null,
				commented_upon_block_text: sanitizeBlockText(params.commentedUponBlockText),
				previous_block_text: sanitizeBlockText(params.previousBlockText),
				next_block_text: sanitizeBlockText(params.nextBlockText),
				// V1 comments are always legacy-format: no V2 anchor envelope.
				anchor_json: null,
				// V1 comments are always free-form; typed verdicts are desktop V2 only.
				kind: 'comment',
				reply_to_comment_id: params.replyToCommentId ?? null,
				is_resolved: false,
				is_deleted: false,
				created_at: BigInt(Date.now()),
				updated_at: BigInt(Date.now()),
				// ACL fields copied from artifact — server confirms these
				organization_id: params.organizationId,
				resource_owner_user_id: params.resourceOwnerUserId,
				task_id: params.taskId,
				...userAuthoredCommentColumns(params.createdByUserId),
				created_at_artifact_version_id: null,
				resolved_by_user_id: null,
				created_by_agent: false,
			})
		},
		mutationFn: async (params) => {
			const response = await api.comments.create({
				id: params.id,
				artifactId: params.artifactId,
				contentText: params.contentText,
				contentJson: params.contentJson,
				commentedUponBlockText: sanitizeBlockText(params.commentedUponBlockText) ?? undefined,
				previousBlockText: sanitizeBlockText(params.previousBlockText),
				nextBlockText: sanitizeBlockText(params.nextBlockText),
				replyToCommentId: params.replyToCommentId,
			})
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const resolveComment = createOptimisticAction<ResolveCommentParams>({
		onMutate: ({ commentId, isResolved }) => {
			artifactCommentsCollection.update(commentId, (draft) => {
				draft.is_resolved = isResolved
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async (params) => {
			const response = await api.comments.resolve(params)
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	// Non-optimistic delete (plain async, matching sharing.ts pattern)
	const deleteComment = async ({ commentId }: DeleteCommentParams) => {
		const response = await api.comments.delete({ commentId })
		await artifactCommentsConfirmTx(response.transactionId)
		return response
	}

	const resolveAllComments = createOptimisticAction<ResolveAllCommentsParams>({
		onMutate: ({ artifactId }) => {
			// Optimistically mark all unresolved comments as resolved
			const now = BigInt(Date.now())
			// Note: TanStack DB doesn't support bulk updates, so we iterate
			// The actual bulk happens server-side; this is best-effort optimistic
			for (const comment of artifactCommentsCollection.values()) {
				if (comment.artifact_id === artifactId && !comment.is_resolved && !comment.is_deleted) {
					artifactCommentsCollection.update(comment.id, (draft) => {
						draft.is_resolved = true
						draft.updated_at = now
					})
				}
			}
		},
		mutationFn: async (params) => {
			const response = await api.comments.resolveAll(params)
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	const editComment = createOptimisticAction<EditCommentParams>({
		onMutate: ({ commentId, contentText, contentJson }) => {
			artifactCommentsCollection.update(commentId, (draft) => {
				draft.content_text = contentText
				draft.content_json = contentJson ?? null
				draft.updated_at = BigInt(Date.now())
			})
		},
		mutationFn: async (params) => {
			const response = await api.comments.edit(params)
			await artifactCommentsConfirmTx(response.transactionId)
			return response
		},
	})

	return { createComment, resolveComment, deleteComment, resolveAllComments, editComment }
}
