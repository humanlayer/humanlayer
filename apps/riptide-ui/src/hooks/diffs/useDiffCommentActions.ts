import type { CreateDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/create'
import type { DeleteDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/delete'
import type { EditDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/edit'
import type { ReplyDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/reply'
import type { ResolveDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/resolve'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { createDiffCommentActions } from '@/actions/diff-comments'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import type { DiffCommentInteractionCallbacks } from '@/hooks/diffs/useDiffCommentInteractionCallbacks'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useRiptideApi } from '@/orpc/client'

export function useDiffCommentActions(resourceOwnerUserId: string): DiffCommentInteractionCallbacks {
	const { client } = useRiptideApi()
	const { diffCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const actions = useMemo(
		() =>
			createDiffCommentActions(
				// Electric and query collections expose the same mutation surface.
				diffCommentsCollection as Parameters<typeof createDiffCommentActions>[0],
				{ diffComments: client.diffComments },
				confirmTx.diffComments,
			),
		[client.diffComments, confirmTx.diffComments, diffCommentsCollection],
	)

	const identity = useCallback(() => {
		if (!dbOrganizationId || !userId || !resourceOwnerUserId) return undefined
		return { organizationId: dbOrganizationId, createdByUserId: userId, resourceOwnerUserId }
	}, [dbOrganizationId, resourceOwnerUserId, userId])

	const create = useCallback(
		async (input: CreateDiffCommentInput) => {
			const optimisticIdentity = identity()
			if (!optimisticIdentity) return false
			try {
				await actions.create({ ...input, ...optimisticIdentity, id: input.id ?? uuidv7() }).isPersisted.promise
				toast.success('Comment added')
				return true
			} catch {
				toast.error('Could not add comment')
				return false
			}
		},
		[actions, identity],
	)

	const reply = useCallback(
		async (input: ReplyDiffCommentInput) => {
			const optimisticIdentity = identity()
			if (!optimisticIdentity) return false
			try {
				await actions.reply({ ...input, ...optimisticIdentity, id: input.id ?? uuidv7() }).isPersisted.promise
				toast.success('Reply added')
				return true
			} catch {
				toast.error('Could not add reply')
				return false
			}
		},
		[actions, identity],
	)

	const edit = useCallback(
		async (input: EditDiffCommentInput) => {
			try {
				await actions.edit(input).isPersisted.promise
				toast.success('Comment updated')
				return true
			} catch {
				toast.error('Could not update comment')
				return false
			}
		},
		[actions],
	)

	const remove = useCallback(
		async (input: DeleteDiffCommentInput) => {
			try {
				await actions.remove(input).isPersisted.promise
				toast.success('Comment deleted')
			} catch {
				toast.error('Could not delete comment')
			}
		},
		[actions],
	)

	const resolve = useCallback(
		// `resolvedByUserId` only seeds the optimistic row; the server sets the real
		// resolver from the authenticated request (see createDiffCommentActions). So
		// never gate the whole action on a loaded userId — that silently swallowed
		// the click (no request, no feedback) whenever `auth.user.info` was
		// unavailable. Send it regardless and let a failed request surface a toast.
		async (input: ResolveDiffCommentInput) => {
			try {
				await actions.resolve({ ...input, resolvedByUserId: userId ?? null }).isPersisted.promise
				toast.success(input.isResolved ? 'Thread resolved' : 'Thread reopened')
			} catch {
				toast.error(input.isResolved ? 'Could not resolve thread' : 'Could not reopen thread')
			}
		},
		[actions, userId],
	)

	const deliverThread = useCallback(async () => {
		toast.info('Agent delivery is added in Phase 5')
	}, [])
	const deliverAll = useCallback(async () => {
		toast.info('Agent delivery is added in Phase 5')
	}, [])

	return useMemo(
		() => ({ create, reply, edit, remove, resolve, deliverThread, deliverAll }),
		[create, deliverAll, deliverThread, edit, remove, reply, resolve],
	)
}
