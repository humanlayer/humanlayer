import { ChevronDown } from 'lucide-react'

import { useSessionDetail } from '@/components/session-detail/session-detail-context'

/**
 * Floating indicator bar that appears when pending approvals are out of view.
 *
 * Visibility comes from `useEventInViewport` (via useSessionNextStep) so the
 * indicator and the A/D hotkey state machine share one source of truth.
 *
 * Place this component inside a relatively-positioned container (e.g., the Card
 * that wraps the ConversationStream).
 */
export function PendingApprovalIndicator() {
	const { session, conversation, nextStep } = useSessionDetail()
	const pendingCount = conversation.pendingApprovalEventIds.length
	const visible = pendingCount > 0 && session.status === 'needs_approval' && !nextStep.oldestPendingApprovalInViewport

	return (
		<div
			className={`absolute bottom-0 left-0 right-0 p-2 cursor-pointer transition-[opacity,transform] duration-300 ease-in-out z-10 ${
				visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'
			}`}
			onClick={nextStep.handleScrollToPendingApproval}
		>
			{/* No backdrop-blur here: WKWebView re-samples the blurred region every frame while
			    the chevron animates, dropping whole-app FPS. Opaque-ish background instead. */}
			<div className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-wider text-muted-foreground bg-background/90 border-t border-border/50 py-1 shadow-sm hover:bg-background transition-colors">
				<span>{pendingCount > 1 ? `${pendingCount} Pending Approvals` : 'Pending Approval'}</span>
				<ChevronDown className="w-3 h-3 animate-bounce will-change-transform" />
			</div>
		</div>
	)
}
