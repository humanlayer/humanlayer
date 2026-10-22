import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { useCallback, useMemo } from 'react'

import { createApprovalActions } from '@/actions/approvals'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useRiptideApi } from '@/orpc/client'

// Approval resolution can be initiated by several independently mounted surfaces
// (row controls, hotkeys, desktop composer, and mobile). Keep the guard at module
// scope so those hook instances cannot resolve the same approval concurrently.
const resolvingApprovalIds = new Set<string>()

/** Shared approval mutation core. Surface-specific state and UX stay with callers. */
export function useApprovalActions() {
	const { approvalsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()

	const approvalActions = useMemo(
		() =>
			createApprovalActions(
				approvalsCollection as Parameters<typeof createApprovalActions>[0],
				client,
				confirmTx.approvals,
			),
		[approvalsCollection, client, confirmTx.approvals],
	)

	const resolveOnce = useCallback(
		async (
			approvalId: string,
			decision: 'approve' | 'deny',
			options?: { comment?: string; appliedSuggestions?: PermissionUpdate[] },
		) => {
			if (resolvingApprovalIds.has(approvalId)) return
			resolvingApprovalIds.add(approvalId)
			try {
				const transaction = approvalActions.resolveApproval({
					approvalId,
					decision,
					comment: options?.comment,
					appliedSuggestions: options?.appliedSuggestions,
				})
				await transaction.isPersisted.promise
			} finally {
				resolvingApprovalIds.delete(approvalId)
			}
		},
		[approvalActions],
	)

	const approve = useCallback((approvalId: string) => resolveOnce(approvalId, 'approve'), [resolveOnce])

	const approveWithSuggestions = useCallback(
		(approvalId: string, suggestions: PermissionUpdate[]) =>
			resolveOnce(approvalId, 'approve', {
				appliedSuggestions: suggestions.filter((suggestion) => suggestion.type !== 'setMode'),
			}),
		[resolveOnce],
	)

	const deny = useCallback(
		(approvalId: string, comment: string) => resolveOnce(approvalId, 'deny', { comment }),
		[resolveOnce],
	)

	return { approve, approveWithSuggestions, deny }
}
