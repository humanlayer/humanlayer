import { ContinueSessionInput } from '@/components/ContinueSessionInput'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { SessionQueuedMessages } from '@/components/session-detail/SessionQueuedMessages'
import { useSharedResponseOptions } from '@/hooks/session-detail/use-response-editor-collaboration'
import { useSessionQueuedMessages } from '@/hooks/useSessionQueuedMessages'
import { cn } from '@/lib/utils'

/**
 * The input area below the conversation stream: the queued-messages pane and
 * the continue-session editor, or the read-only notice for shared sessions.
 */
export function SessionPromptArea({ isConversationAbove = true }: { isConversationAbove?: boolean }) {
	const { accessLevel, sessionId, session, canSendPrompt, isRunning } = useSessionDetail()
	const collaborationOptions = useSharedResponseOptions(session, canSendPrompt)
	const canViewSession = accessLevel !== 'no_access'
	// A non-empty queue docks flush on top of the editor as one composer unit:
	// no gap between them, and the editor drops its top rounding.
	const { count } = useSessionQueuedMessages(canViewSession ? sessionId : undefined)
	const hasQueuedMessages = count > 0
	const isBelowStatusBar = isConversationAbove && isRunning

	// Session access levels describe prompt/task capability, not the shared
	// document's organization-reader policy. Never hide an eligible viewer just
	// because prompt access is absent (or was revoked).
	if (!canViewSession && !collaborationOptions) return null

	return (
		<>
			{canViewSession && <SessionQueuedMessages />}
			<div className={cn('shrink-0', !hasQueuedMessages && !isBelowStatusBar && 'pt-4')}>
				<ContinueSessionInput
					collaborationOptions={collaborationOptions}
					className={hasQueuedMessages ? 'rounded-t-none' : undefined}
				/>
			</div>
		</>
	)
}
