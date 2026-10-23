import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useMemo, useState } from 'react'

import { useSessionOnboardingStore } from '@/hooks/stores/sessionOnboardingStore'
import { DISMISSED_TIP_TYPES_KEY, TIP_MODAL_SHOWN_SESSIONS_KEY, TIPS_SILENCED_KEY } from '@/lib/preferences'
import { getLatestInvokedRpiPhase } from '@/utils/phase-tips'

import { PhaseTipModal } from './PhaseTipModal'

interface WiredPhaseTipModalProps {
	session: {
		id?: string
		labels?: unknown
	}
	events: readonly ConversationEvent[]
}

export function WiredPhaseTipModal({ session, events }: WiredPhaseTipModalProps) {
	const [dismissedTipTypes, setDismissedTipTypes] = useLocalStorage<string[]>(DISMISSED_TIP_TYPES_KEY, [])
	const [tipsSilenced, setTipsSilenced] = useLocalStorage<boolean>(TIPS_SILENCED_KEY, false)
	const [shownSessions, setShownSessions] = useLocalStorage<string[]>(TIP_MODAL_SHOWN_SESSIONS_KEY, [])
	const [dismissed, setDismissed] = useState(false)
	const phaseTipSuppressedForMount = useSessionOnboardingStore((state) => state.phaseTipSuppressedForMount)

	const currentPhase = useMemo(() => getLatestInvokedRpiPhase(events), [events])

	// "Adjust state during render" pattern: use state (not a ref) to track the
	// previous phase so React can safely replay renders in concurrent mode.
	const [prevPhase, setPrevPhase] = useState<string | null>(null)
	if (currentPhase !== prevPhase) {
		setPrevPhase(currentPhase)
		setDismissed(false)
	}

	const open =
		currentPhase != null &&
		!dismissed &&
		!tipsSilenced &&
		!dismissedTipTypes.includes(currentPhase) &&
		!(session?.id && shownSessions.includes(session.id)) &&
		!phaseTipSuppressedForMount

	const markSessionShown = () => {
		if (session?.id && !shownSessions.includes(session.id)) {
			const sessionId = session.id
			setShownSessions((prev) => {
				const previousShownSessions = prev ?? []
				return [...previousShownSessions, sessionId]
			})
		}
	}

	const handleClose = () => {
		markSessionShown()
		setDismissed(true)
	}

	const handleDontShowPhase = () => {
		if (currentPhase) {
			setDismissedTipTypes((prev) => {
				const previousDismissedTipTypes = prev ?? []
				return [...previousDismissedTipTypes, currentPhase]
			})
		}
		markSessionShown()
		setDismissed(true)
	}

	const handleNeverShowTips = () => {
		setTipsSilenced(true)
		markSessionShown()
		setDismissed(true)
	}

	if (!currentPhase) return null

	return (
		<PhaseTipModal
			open={open}
			onOpenChange={(value) => {
				if (!value) handleClose()
			}}
			phase={currentPhase}
			onClose={handleClose}
			onDontShowPhase={handleDontShowPhase}
			onNeverShowTips={handleNeverShowTips}
		/>
	)
}
