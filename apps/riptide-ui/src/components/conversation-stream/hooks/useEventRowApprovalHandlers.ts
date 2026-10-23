import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useCallback } from 'react'
import { toast } from 'sonner'

import { useApprovalStore } from '@/hooks/stores/approvalStore'
import { useApprovalActions } from '@/hooks/useApprovalActions'

/** Approval state and handlers for one conversation event row. */
export function useEventRowApprovalHandlers(event: ConversationEvent | null) {
	const { approve, approveWithSuggestions, deny } = useApprovalActions()

	const approvingApprovalId = useApprovalStore((state) => state.approvingApprovalId)
	const denyingApproval = useApprovalStore((state) => state.denyingApproval)
	const denyFeedbackText = useApprovalStore((state) => state.denyFeedbackText)
	const setApprovingApprovalId = useApprovalStore((state) => state.setApprovingApprovalId)
	const startDeny = useApprovalStore((state) => state.startDeny)
	const cancelDeny = useApprovalStore((state) => state.cancelDeny)

	const handleApprove = useCallback(
		async (approvalId: string) => {
			setApprovingApprovalId(approvalId)
			try {
				await approve(approvalId)
			} catch {
				toast.error('Failed to approve')
			} finally {
				setApprovingApprovalId(null)
			}
		},
		[approve, setApprovingApprovalId],
	)

	const handleApproveWithSuggestions = useCallback(
		async (approvalId: string, applied: PermissionUpdate[]) => {
			setApprovingApprovalId(approvalId)
			try {
				await approveWithSuggestions(approvalId, applied)
			} catch {
				toast.error('Failed to approve')
			} finally {
				setApprovingApprovalId(null)
			}
		},
		[approveWithSuggestions, setApprovingApprovalId],
	)

	const handleDeny = useCallback(
		async (approvalId: string, reason: string) => {
			try {
				await deny(approvalId, reason)
			} catch {
				toast.error('Failed to deny')
			} finally {
				cancelDeny()
			}
		},
		[cancelDeny, deny],
	)

	const handleStartDeny = useCallback(() => {
		if (!event?.approvalId) return
		startDeny(event.approvalId, event.toolName || 'Unknown')
	}, [event, startDeny])

	const handleSubmitDeny = useCallback(async () => {
		if (!denyingApproval || !denyFeedbackText?.trim()) return
		await handleDeny(denyingApproval.id, denyFeedbackText.trim())
	}, [denyingApproval, denyFeedbackText, handleDeny])

	return {
		approvingApprovalId,
		denyingApproval,
		denyFeedbackText,
		cancelDeny,
		handleApprove,
		handleApproveWithSuggestions,
		handleDeny,
		handleStartDeny,
		handleSubmitDeny,
	}
}
