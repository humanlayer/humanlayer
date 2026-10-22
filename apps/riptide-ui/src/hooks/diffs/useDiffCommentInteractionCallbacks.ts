import type { CreateDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/create'
import type { DeleteDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/delete'
import type { EditDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/edit'
import type { ReplyDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/reply'
import type { ResolveDiffCommentInput } from '@humanlayer/riptide-api-contract/api/diff-comments/resolve'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'

export type DiffCommentDeliveryMode = 'send' | 'send-and-resolve'

export interface DiffCommentInteractionCallbacks {
	readonly create: (input: CreateDiffCommentInput) => Promise<boolean>
	readonly reply: (input: ReplyDiffCommentInput) => Promise<boolean>
	readonly edit: (input: EditDiffCommentInput) => Promise<boolean>
	readonly remove: (input: DeleteDiffCommentInput) => Promise<void>
	readonly resolve: (input: ResolveDiffCommentInput) => Promise<void>
	readonly deliverThread: (input: { rootCommentId: string; mode: DiffCommentDeliveryMode }) => Promise<void>
	readonly deliverAll: (input: {
		taskId: string
		rootCommentIds: readonly string[]
		mode: DiffCommentDeliveryMode
	}) => Promise<void>
}

function payloadSummary(input: unknown): string {
	return JSON.stringify(input, null, 2)
}

function isRejected(contentText: string): boolean {
	return contentText.trimStart().toLowerCase().startsWith('[reject]')
}

/** Phase 3 interaction ports. These report contract payloads but never mutate comment state. */
export function useDiffCommentInteractionCallbacks(): DiffCommentInteractionCallbacks {
	const acceptWrite = useCallback(async (action: string, input: { contentText: string }) => {
		if (isRejected(input.contentText)) {
			toast.error(`${action} rejected`, { description: payloadSummary(input) })
			return false
		}
		toast.success(`${action} accepted`, { description: payloadSummary(input) })
		return true
	}, [])

	const create = useCallback(
		(input: CreateDiffCommentInput) => acceptWrite('Create diff comment', input),
		[acceptWrite],
	)
	const reply = useCallback(
		(input: ReplyDiffCommentInput) => acceptWrite('Reply to diff comment', input),
		[acceptWrite],
	)
	const edit = useCallback((input: EditDiffCommentInput) => acceptWrite('Edit diff comment', input), [acceptWrite])
	const remove = useCallback(async (input: DeleteDiffCommentInput) => {
		toast.success('Delete diff comment accepted', { description: payloadSummary(input) })
	}, [])
	const resolve = useCallback(async (input: ResolveDiffCommentInput) => {
		toast.success(input.isResolved ? 'Resolve diff thread accepted' : 'Reopen diff thread accepted', {
			description: payloadSummary(input),
		})
	}, [])
	const deliverThread = useCallback(async (input: { rootCommentId: string; mode: DiffCommentDeliveryMode }) => {
		toast.success('Thread delivery callback', { description: payloadSummary(input) })
	}, [])
	const deliverAll = useCallback(
		async (input: { taskId: string; rootCommentIds: readonly string[]; mode: DiffCommentDeliveryMode }) => {
			toast.success('Bulk delivery callback', { description: payloadSummary(input) })
		},
		[],
	)

	return useMemo(
		() => ({ create, reply, edit, remove, resolve, deliverThread, deliverAll }),
		[create, deliverAll, deliverThread, edit, remove, reply, resolve],
	)
}
