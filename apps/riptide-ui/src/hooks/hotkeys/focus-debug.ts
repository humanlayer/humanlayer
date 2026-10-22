import type { Keys } from '@humanlayer/react-hotkeys-hook'

import { type FocusHotkeyDebugEvent, useFocusStore } from '@/hooks/stores/focusStore'

export type HotkeyDebugOutcome = 'fired' | 'rejected'

export function hotkeyDebugLabel(keys: Keys): string {
	return typeof keys === 'string' ? keys : keys.join(', ')
}

function eventTargetLabel(event?: KeyboardEvent): string {
	const target = event?.target
	if (!(target instanceof HTMLElement)) return 'unknown'
	const className = typeof target.className === 'string' ? target.className.trim().replace(/\s+/g, '.') : ''
	return `${target.tagName.toLowerCase()}${className ? `.${className.slice(0, 48)}` : ''}`
}

export function recordHotkeyDebugEvent({
	key,
	outcome,
	reason,
	event,
}: {
	key: string
	outcome: HotkeyDebugOutcome
	reason: string
	event?: KeyboardEvent
}): void {
	if (import.meta.env.PROD) return
	const eventTimeStamp = event?.timeStamp ?? null
	const nextEvent = { key, outcome, reason, target: eventTargetLabel(event), eventTimeStamp }
	const previous = useFocusStore.getState().lastHotkeyDebug
	if (
		outcome === 'rejected' &&
		previous?.outcome === 'fired' &&
		eventTimeStamp !== null &&
		previous.eventTimeStamp === eventTimeStamp
	) {
		return
	}
	useFocusStore.getState().setLastHotkeyDebug(nextEvent satisfies FocusHotkeyDebugEvent)
}
