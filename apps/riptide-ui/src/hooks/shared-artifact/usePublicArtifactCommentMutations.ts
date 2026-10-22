import { commentAuthorColumns } from '@humanlayer/db/artifact-comment-author'
import type {
	ArtifactCommentPersistence,
	ArtifactCommentProjectionRow,
	CreateV2CommentInput,
	CreateV2ReplyInput,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useRiptideApi } from '@/orpc/client'

import type { GuestArtifactIdentity } from './useGuestArtifactIdentity'

interface Options {
	artifactId: string
	shareKey: string
	commentsCollection: { utils: { awaitTxId: (txId: number, timeout: number) => Promise<unknown> } }
	requireGuestIdentity: () => Promise<GuestArtifactIdentity>
	rememberGuestIdentity: (identity: GuestArtifactIdentity) => void
	onConfirmed?: () => Promise<unknown>
}

export function usePublicArtifactCommentMutations(options: Options) {
	const { client } = useRiptideApi()
	const [optimisticRows, setOptimisticRows] = useState<ArtifactCommentProjectionRow[]>([])

	const confirm = useCallback(
		async (transactionId: string) => {
			await options.commentsCollection.utils.awaitTxId(Number(transactionId), 10_000)
		},
		[options.commentsCollection],
	)
	const offerUndo = useCallback(
		(response: { commentId: string; transactionId: string; undoToken?: string }) => {
			if (!response.undoToken) return
			const { commentId, undoToken } = response
			toast('Comment added', {
				duration: 10_000,
				action: {
					label: 'Undo',
					onClick: () => {
						void client.public.artifacts
							.undoComment({
								artifactId: options.artifactId,
								shareKey: options.shareKey,
								commentId,
								undoToken,
							})
							.then((undoResponse) => confirm(undoResponse.transactionId))
							.catch(() => toast.error('Could not undo comment. The comment is still visible.'))
					},
				},
			})
		},
		[client, confirm, options.artifactId, options.shareKey],
	)
	const addOptimistic = useCallback(
		(input: CreateV2CommentInput | CreateV2ReplyInput, guest: GuestArtifactIdentity) => {
			const now = BigInt(Date.now())
			const row: ArtifactCommentProjectionRow = {
				id: input.id,
				artifact_id: options.artifactId,
				...commentAuthorColumns({
					kind: 'guest',
					anonymousAuthorId: guest.anonymousAuthorId,
					guestName: guest.guestName,
				}),
				reply_to_comment_id: 'rootCommentId' in input ? input.rootCommentId : null,
				created_at: now,
				updated_at: now,
				content_text: input.contentText,
				content_json: 'contentJson' in input ? (input.contentJson ?? null) : null,
				anchor_json: 'anchorJson' in input ? input.anchorJson : null,
				kind: 'comment',
				is_resolved: false,
				is_deleted: false,
				created_by_agent: false,
			}
			setOptimisticRows((rows) => [...rows, row])
			return () => setOptimisticRows((rows) => rows.filter((candidate) => candidate.id !== row.id))
		},
		[options.artifactId],
	)

	const write = useCallback(
		async (
			input: CreateV2CommentInput | CreateV2ReplyInput,
			target: { anchorJson?: CreateV2CommentInput['anchorJson']; contentJson?: unknown; rootCommentId?: string },
		) => {
			const guestIdentity = await options.requireGuestIdentity()
			const remove = addOptimistic(input, guestIdentity)
			try {
				const response = await client.public.artifacts.createComment({
					artifactId: options.artifactId,
					shareKey: options.shareKey,
					id: input.id,
					contentText: input.contentText,
					guestIdentity,
					...target,
				})
				await confirm(response.transactionId)
				offerUndo(response)
				options.rememberGuestIdentity(guestIdentity)
				await options.onConfirmed?.()
				return response
			} finally {
				remove()
			}
		},
		[
			addOptimistic,
			client,
			confirm,
			offerUndo,
			options.artifactId,
			options.shareKey,
			options.requireGuestIdentity,
			options.rememberGuestIdentity,
			options.onConfirmed,
		],
	)

	const persistence = useMemo<ArtifactCommentPersistence>(
		() => ({
			async createComment(input: CreateV2CommentInput) {
				return write(input, { anchorJson: input.anchorJson, contentJson: input.contentJson })
			},
			async createReply(input: CreateV2ReplyInput) {
				return write(input, { rootCommentId: input.rootCommentId })
			},
			// Public commenters cannot delete; they undo through the toast instead.
			deleteComment() {},
			resolveComment() {},
		}),
		[write],
	)

	return { persistence, optimisticRows }
}
