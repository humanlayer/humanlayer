import { Card, CardContent } from '@humanlayer/ui/components/card'
import { LoadingStatusBar } from '@humanlayer/ui/components/loading-status-bar'
import { DEFAULT_VERBS, OmniSpinner, PLAIN_VERBS } from '@humanlayer/ui/components/omni-spinner'
import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'

import { WiredConversationStream } from '@/components/conversation-stream/WiredConversationStream'
import { PendingApprovalIndicator } from '@/components/PendingApprovalIndicator'
import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { SessionNextStepIndicator } from '@/components/session-detail/SessionNextStepIndicator'
import { SessionInfoBar } from '@/components/SessionInfoBar'
import { FOCUSED_AREAS } from '@/hooks/stores/focus-areas'
import { useFocusStore } from '@/hooks/stores/focusStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

/**
 * The conversation card on the session detail page: info bar, the virtualized
 * conversation stream (or syncing placeholder), the floating pending-approval
 * and next-step indicators, and the running status bar.
 */
export function SessionConversationPanel() {
	const { conversation, session, isRunning } = useSessionDetail()
	const thinkingVerbsDisabled = useSettingsStore((s) => s.thinkingVerbsDisabled)
	// Same rule as SessionInfoBar: the bar only lights up while the main
	// (conversation) area owns keyboard focus.
	const isMainAreaFocused = useFocusStore((s) => s.focusedArea === FOCUSED_AREAS.MAIN)

	return (
		<Card
			className={`Conversation-Card flex-1 min-h-0 min-w-0 relative ${isRunning ? 'pb-8' : ''} flex flex-col gap-0! border-0 bg-transparent`}
		>
			<SessionInfoBar />
			<CardContent className="px-0 flex flex-col flex-1 grow min-h-0 h-auto">
				{conversation.events.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-3">
						<SyncGridAnimation variant="snake" size="lg" speed={120} className="text-accent" />
						<p className="text-sm text-muted-foreground">Syncing…</p>
					</div>
				) : (
					<WiredConversationStream />
				)}
			</CardContent>
			<PendingApprovalIndicator />
			<SessionNextStepIndicator />
			<LoadingStatusBar isLoading={isRunning} className={isMainAreaFocused ? undefined : 'bg-transparent'}>
				<OmniSpinner
					verbs={thinkingVerbsDisabled ? PLAIN_VERBS : DEFAULT_VERBS}
					label={session.is_compacting ? 'Compacting…' : undefined}
				/>
			</LoadingStatusBar>
		</Card>
	)
}
