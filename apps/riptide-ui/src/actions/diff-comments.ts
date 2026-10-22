import type { DiffCommentAnchor } from '@humanlayer/db/zodschemas/diff-comment-anchor'
import type { RiptideApiInputs } from '@humanlayer/riptide-api-contract/contract-router'
import { createOptimisticAction } from '@tanstack/react-db'

import type { DiffCommentsCollection } from '@/collections/electric/diff-comments'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

type CreateInput = RiptideApiInputs['diffComments']['create'] & OptimisticIdentity
type ReplyInput = RiptideApiInputs['diffComments']['reply'] & OptimisticIdentity
type EditInput = RiptideApiInputs['diffComments']['edit']
type DeleteInput = RiptideApiInputs['diffComments']['delete']
type ResolveInput = RiptideApiInputs['diffComments']['resolve']
type ResolveBatchInput = RiptideApiInputs['diffComments']['resolveBatch']

interface OptimisticIdentity {
	organizationId: string
	resourceOwnerUserId: string
	createdByUserId: string
}

export function createDiffCommentActions(
	collection: DiffCommentsCollection,
	api: Pick<RiptideApiClient, 'diffComments'>,
	confirmTx: ConfirmTxFn,
) {
	const create = createOptimisticAction<CreateInput>({
		onMutate: (input) => {
			const now = BigInt(Date.now())
			collection.insert(makeOptimisticRow(input, input.anchor, null, now))
		},
		mutationFn: async ({ organizationId: _, resourceOwnerUserId: __, createdByUserId: ___, ...input }) => {
			const response = await api.diffComments.create(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	const reply = createOptimisticAction<ReplyInput>({
		onMutate: (input) => {
			const now = BigInt(Date.now())
			collection.insert(makeOptimisticRow(input, null, input.rootCommentId, now))
			collection.update(input.rootCommentId, (draft) => {
				draft.is_resolved = false
				draft.resolved_by_user_id = null
				draft.updated_at = now
			})
		},
		mutationFn: async ({ organizationId: _, resourceOwnerUserId: __, createdByUserId: ___, ...input }) => {
			const response = await api.diffComments.reply(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	const edit = createOptimisticAction<EditInput>({
		onMutate: (input) =>
			collection.update(input.commentId, (draft) => {
				draft.content_text = input.contentText
				draft.content_json = input.contentJson ?? null
				draft.updated_at = BigInt(Date.now())
			}),
		mutationFn: async (input) => {
			const response = await api.diffComments.edit(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	const remove = createOptimisticAction<DeleteInput>({
		onMutate: (input) =>
			collection.update(input.commentId, (draft) => {
				draft.is_deleted = true
				draft.updated_at = BigInt(Date.now())
			}),
		mutationFn: async (input) => {
			const response = await api.diffComments.delete(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	const resolve = createOptimisticAction<ResolveInput & { resolvedByUserId: string | null }>({
		onMutate: ({ commentId, isResolved, resolvedByUserId }) =>
			collection.update(commentId, (draft) => {
				draft.is_resolved = isResolved
				draft.resolved_by_user_id = isResolved ? resolvedByUserId : null
				draft.updated_at = BigInt(Date.now())
			}),
		mutationFn: async ({ resolvedByUserId: _, ...input }) => {
			const response = await api.diffComments.resolve(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	const resolveBatch = createOptimisticAction<ResolveBatchInput & { resolvedByUserId: string }>({
		onMutate: ({ rootCommentIds, resolvedByUserId }) => {
			const now = BigInt(Date.now())
			for (const id of rootCommentIds)
				collection.update(id, (draft) => {
					draft.is_resolved = true
					draft.resolved_by_user_id = resolvedByUserId
					draft.updated_at = now
				})
		},
		mutationFn: async ({ resolvedByUserId: _, ...input }) => {
			const response = await api.diffComments.resolveBatch(input)
			await confirmTx(response.transactionId)
			return response
		},
	})

	return { create, reply, edit, remove, resolve, resolveBatch }
}

function makeOptimisticRow(
	input: (CreateInput | ReplyInput) & { id?: string },
	anchor: DiffCommentAnchor | null,
	replyToCommentId: string | null,
	now: bigint,
) {
	if (!input.id) throw new Error('Optimistic diff comments require a client-generated ID')
	return {
		id: input.id,
		organization_id: input.organizationId,
		resource_owner_user_id: input.resourceOwnerUserId,
		task_id: input.taskId,
		created_by_user_id: input.createdByUserId,
		reply_to_comment_id: replyToCommentId,
		created_at: now,
		updated_at: now,
		content_text: input.contentText,
		content_json: input.contentJson ?? null,
		anchor_json: anchor,
		is_resolved: false,
		resolved_by_user_id: null,
		is_deleted: false,
		created_by_agent: false,
	}
}
