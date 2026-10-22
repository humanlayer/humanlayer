import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { useApprovalStore } from '@/hooks/stores/approvalStore'
import { useApprovalActions } from '@/hooks/useApprovalActions'

interface UseMobileApprovalFlowArgs {
	/** Conversation events — used to resolve the tool name when entering deny mode. */
	events: ConversationEvent[]
}

/**
 * Encapsulates per-approval in-flight state + resolve handlers so the wired
 * page doesn't need its own useState for `approvingApprovalId` and doesn't
 * need to reach into `createApprovalActions`/try-finally plumbing.
 *
 * Deny is a two-step flow matching desktop: tapping Deny enters "denying" mode
 * (via the shared `useApprovalStore`), the composer collects optional feedback,
 * then `handleDenySubmit` resolves the approval with that comment. Approve and
 * approve-with-suggestions forward the same params the desktop handlers use.
 */
export function useMobileApprovalFlow({ events }: UseMobileApprovalFlowArgs) {
	const [approvingApprovalId, setApprovingApprovalId] = useState<string | null>(null)
	const denyingApproval = useApprovalStore((s) => s.denyingApproval)
	const { approve, approveWithSuggestions, deny } = useApprovalActions()

	const handleApprove = useCallback(
		async (approvalId: string) => {
			setApprovingApprovalId(approvalId)
			try {
				await approve(approvalId)
			} catch {
				toast.error('Failed to approve')
			} finally {
				setApprovingApprovalId((current) => (current === approvalId ? null : current))
			}
		},
		[approve],
	)

	// Approve while persisting the selected permission suggestions ("don't ask
	// again"). Matches desktop: setMode suggestions are stripped before sending.
	const handleApproveWithSuggestions = useCallback(
		async (approvalId: string, appliedSuggestions: PermissionUpdate[]) => {
			setApprovingApprovalId(approvalId)
			try {
				await approveWithSuggestions(approvalId, appliedSuggestions)
			} catch {
				toast.error('Failed to approve')
			} finally {
				setApprovingApprovalId((current) => (current === approvalId ? null : current))
			}
		},
		[approveWithSuggestions],
	)

	// Enter deny mode — the composer picks this up (via useApprovalStore) and
	// collects optional feedback. Does not resolve the approval yet.
	const handleStartDeny = useCallback(
		(approvalId: string) => {
			const event = events.find((e) => e.approvalId === approvalId)
			useApprovalStore.getState().startDeny(approvalId, event?.toolName || 'Unknown')
		},
		[events],
	)

	const handleDenyCancel = useCallback(() => {
		useApprovalStore.getState().cancelDeny()
	}, [])

	// Resolve the approval with the composed feedback (empty allowed).
	const handleDenySubmit = useCallback(
		async (message: string) => {
			const current = useApprovalStore.getState().denyingApproval
			if (!current) return
			const approvalId = current.id
			useApprovalStore.getState().cancelDeny() // dismiss composer deny mode immediately
			try {
				await deny(approvalId, message)
			} catch {
				toast.error('Failed to deny')
			}
		},
		[deny],
	)

	return {
		approvingApprovalId,
		denyingApproval,
		handleApprove,
		// `handleDeny` starts the feedback flow (composer deny mode), matching desktop.
		handleDeny: handleStartDeny,
		handleApproveWithSuggestions,
		handleDenyCancel,
		handleDenySubmit,
	}
}
