import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useCallback } from 'react'

import { useApprovalStore } from '@/hooks/stores/approvalStore'
import type { ModelType } from '@/hooks/stores/settingsStore'
import type { ResponseEditorSubmission } from '@/hooks/use-response-editor-content-port'

export interface SessionSubmitParams {
	text: string
	sharedSubmission?: ResponseEditorSubmission
	model: ModelType
	permissionsMode: 'default' | 'accept_edits' | 'bypass' | 'auto'
}

/** Shared composer/button/submit-shortcut command, with no keyboard registrations. */
export function useSessionSubmitWithApprovalCheck({
	events,
	hasPendingApprovals,
	setFocusedEventId,
	handleContinueSubmit,
}: {
	events: ConversationEvent[]
	hasPendingApprovals: boolean
	setFocusedEventId: (id: string, source: 'mouse' | 'keyboard') => void
	handleContinueSubmit: (params: SessionSubmitParams) => Promise<void>
}) {
	return useCallback(
		(params: SessionSubmitParams) => {
			// Pending approvals enter denying mode instead of submitting a new prompt.
			if (hasPendingApprovals) {
				const oldestApproval = events.find((event) => event.approvalStatus === 'pending' && event.approvalId)
				if (oldestApproval?.approvalId) {
					useApprovalStore
						.getState()
						.startDeny(oldestApproval.approvalId, oldestApproval.toolName || 'Unknown')
					setFocusedEventId(oldestApproval.id, 'keyboard')
				}
				if (params.sharedSubmission)
					useApprovalStore.getState().setDenyContent({
						type: 'doc',
						content: params.text.split('\n').map((line) => ({
							type: 'paragraph',
							content: line ? [{ type: 'text', text: line }] : [],
						})),
					})
				return
			}
			void handleContinueSubmit(params)
		},
		[events, hasPendingApprovals, setFocusedEventId, handleContinueSubmit],
	)
}
