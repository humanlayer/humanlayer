import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'

import type { AnchorV2, CommentKind } from '../anchor/types'

export interface CreateV2CommentInput {
	id: string
	artifactId: string
	contentText: string
	contentJson?: ArtifactComment['content_json']
	anchorJson: AnchorV2
	/**
	 * Typed review verdict. `comment` for free-form feedback (the block/range
	 * composer path); `deletion`/`approval` for the instant verdict commands.
	 */
	kind: CommentKind
	/**
	 * Task scope. Authenticated writers stamp it on the optimistic row (see
	 * {@link requireTaskScope}); share-link writers omit it because the server
	 * derives it from the link.
	 */
	organizationId?: string
	resourceOwnerUserId?: string
	taskId?: string
	createdByUserId?: string
}

/**
 * A V2 reply create. A reply carries no anchor and no typed verdict kind — its
 * document context comes from the root. `rootCommentId` is the effective root
 * (the server flattens any thread member to root); the app's optimistic action
 * inserts the row and calls `comments.create` with `replyToCommentId`.
 */
export interface CreateV2ReplyInput {
	id: string
	artifactId: string
	rootCommentId: string
	contentText: string
	/** Task scope; see {@link CreateV2CommentInput}. */
	organizationId?: string
	resourceOwnerUserId?: string
	taskId?: string
	createdByUserId?: string
}

/**
 * Narrows a write to the task scope an authenticated optimistic insert needs.
 * The controller holds task-scoped writes until auth resolves, so a missing
 * field here is a wiring bug, not a user state.
 */
export function requireTaskScope(
	input: Pick<CreateV2CommentInput, 'organizationId' | 'resourceOwnerUserId' | 'taskId' | 'createdByUserId'>,
) {
	const { organizationId, resourceOwnerUserId, taskId, createdByUserId } = input
	if (!organizationId || resourceOwnerUserId === undefined || !taskId || !createdByUserId) {
		throw new Error('Authenticated comment writes need a task scope')
	}
	return { organizationId, resourceOwnerUserId, taskId, createdByUserId }
}

export interface V2CommentPersistenceAdapter<Response extends { transactionId: string }> {
	insert: (row: ArtifactComment) => void
	persist: (
		input: Pick<CreateV2CommentInput, 'id' | 'artifactId' | 'contentText' | 'contentJson' | 'anchorJson' | 'kind'>,
	) => Promise<Response>
	confirm: (transactionId: string) => Promise<unknown>
	now?: () => number
}

export function createV2CommentPersistence<Response extends { transactionId: string }>(
	adapter: V2CommentPersistenceAdapter<Response>,
) {
	return {
		optimisticallyInsert(input: CreateV2CommentInput) {
			const now = BigInt((adapter.now ?? Date.now)())
			const scope = requireTaskScope(input)
			adapter.insert({
				id: input.id,
				artifact_id: input.artifactId,
				content_text: input.contentText,
				content_json: input.contentJson ?? null,
				anchor_json: input.anchorJson,
				kind: input.kind,
				commented_upon_block_text: null,
				previous_block_text: null,
				next_block_text: null,
				reply_to_comment_id: null,
				is_resolved: false,
				is_deleted: false,
				created_at: now,
				updated_at: now,
				organization_id: scope.organizationId,
				resource_owner_user_id: scope.resourceOwnerUserId,
				task_id: scope.taskId,
				created_by_user_id: scope.createdByUserId,
				anonymous_author_id: null,
				anonymous_guest_name: null,
				created_via_public_share: false,
				created_at_artifact_version_id: null,
				resolved_by_user_id: null,
				created_by_agent: false,
			})
		},
		async persistAndConfirm(input: CreateV2CommentInput): Promise<Response> {
			const response = await adapter.persist(input)
			await adapter.confirm(response.transactionId)
			return response
		},
	}
}
