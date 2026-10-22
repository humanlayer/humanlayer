import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { createOptimisticAction } from '@tanstack/react-db'

import type { ApprovalsCollection } from '@/collections/electric/approvals'
import type { ConfirmTxFn } from '@/components/providers/SyncProvider'
import type { RiptideApiClient } from '@/orpc/client'

interface ResolveApprovalParams {
	approvalId: string
	decision: 'approve' | 'deny'
	comment?: string
	appliedSuggestions?: PermissionUpdate[]
}

/**
 * Creates optimistic actions for approval mutations.
 */
export function createApprovalActions(
	approvalsCollection: ApprovalsCollection,
	api: RiptideApiClient,
	approvalsConfirmTx: ConfirmTxFn,
) {
	const resolveApproval = createOptimisticAction<ResolveApprovalParams>({
		onMutate: ({ approvalId, decision, appliedSuggestions }) => {
			approvalsCollection.update(approvalId, (draft) => {
				draft.status = decision === 'approve' ? 'approved' : 'denied'
				draft.responded_at = BigInt(Date.now())
				draft.applied_suggestions = decision === 'approve' ? (appliedSuggestions ?? null) : null
			})
		},
		mutationFn: async ({ approvalId, decision, comment, appliedSuggestions }) => {
			const response = await api.approvals.resolve({ approvalId, decision, comment, appliedSuggestions })
			await approvalsConfirmTx(response.transactionId)
			return response
		},
	})

	return {
		resolveApproval,
	}
}
