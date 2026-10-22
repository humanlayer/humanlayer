import type { Virtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import type { MutableRefObject } from 'react'

import { useNextStepIndicatorVisible } from '@/hooks/useNextStepIndicatorVisible'

/**
 * Trailing clearance (in pixels) applied to the conversation virtualizer's
 * paddingEnd when this indicator is visible, so the floating bar does not
 * cover the bottom-most message. Sized for the indicator's ~24-28px visual
 * height with ~12px of breathing room.
 */
export const NEXT_STEP_INDICATOR_CLEARANCE_PX = 40

interface NextStepIndicatorProps {
	/** Array of event IDs that have next step suggestions. */
	nextStepEventIds: string[]
	/** Most-recent dismissed event ID (or null). Hide indicator when matches the latest next-step event. */
	dismissedEventId: string | null
	/** Whether the session is currently running. Offsets the bar to avoid LoadingStatusBar. */
	isRunning: boolean
	/** Whether the session is in 'ready_for_input' state. Indicator is hidden otherwise. */
	isReadyForInput: boolean
	/** Optional label suffix; rendered as `Next: <label>`. */
	nextStepLabel?: string
	/** Override the display label (e.g., "View: research"). */
	labelOverride?: string
	/** Click handler — should scroll to the most-recent next-step row and dismiss. */
	onScrollToNextStep: () => void
	/** Virtualizer ref forwarded from WiredConversationStream. */
	virtualizerRef: MutableRefObject<Virtualizer<HTMLDivElement, Element> | null>
	/** Scroll container ref forwarded from WiredConversationStream. */
	parentRef: MutableRefObject<HTMLDivElement | null>
}

/**
 * Floating indicator bar that appears when next step buttons are out of view.
 *
 * Visibility is computed from the virtualizer's virtual items and the scroll
 * container geometry — no DOM querying. This survives row virtualization where
 * the row's DOM element is unmounted once it scrolls outside the overscan window.
 *
 * Place this component inside a relatively-positioned container (e.g., the Card
 * that wraps the ConversationStream).
 */
export function NextStepIndicator({
	nextStepEventIds,
	dismissedEventId,
	isRunning,
	isReadyForInput,
	nextStepLabel,
	labelOverride,
	onScrollToNextStep,
	virtualizerRef,
	parentRef,
}: NextStepIndicatorProps) {
	const { visible } = useNextStepIndicatorVisible({
		nextStepEventIds,
		dismissedEventId,
		isReadyForInput,
		virtualizerRef,
		parentRef,
	})

	const label = labelOverride ?? (nextStepLabel ? `Next: ${nextStepLabel}` : 'Next Step Available')

	return (
		<div
			className={`absolute ${isRunning ? 'bottom-8' : 'bottom-0'} left-0 right-0 p-2 cursor-pointer transition-[bottom,opacity,transform] duration-300 ease-in-out z-10 ${
				visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'
			}`}
			onClick={onScrollToNextStep}
		>
			{/* No backdrop-blur here: WKWebView re-samples the blurred region every frame while
			    the chevron animates, dropping whole-app FPS. Opaque-ish background instead. */}
			<div className="flex items-center justify-center gap-1 font-mono text-xs uppercase tracking-wider text-[var(--terminal-success)] bg-background/90 py-1 shadow-sm hover:bg-background transition-colors cursor-pointer">
				<span>{label}</span>
				<ChevronDown className="w-3 h-3 animate-bounce will-change-transform" />
			</div>
		</div>
	)
}
