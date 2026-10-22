import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'

import { isForkExcludedMessage } from './sidebar-transforms'

export function getLatestRealRootUserMessage(events: ConversationEvent[]): ConversationEvent | undefined {
	for (let index = events.length - 1; index >= 0; index--) {
		const event = events[index]
		if (
			event?.eventType === 'message' &&
			event.role === 'user' &&
			!event.parentToolUseId &&
			!isForkExcludedMessage(event.content)
		) {
			return event
		}
	}

	return undefined
}

export function getCurrentTurnEventIds(events: ConversationEvent[]): Set<string> {
	const currentTurnStartEvent = getLatestRealRootUserMessage(events)
	const currentTurnStart = currentTurnStartEvent
		? events.findIndex((event) => event.id === currentTurnStartEvent.id)
		: -1

	if (currentTurnStart === -1) return new Set()

	const currentTurnEventIds = new Set<string>()
	for (let index = currentTurnStart; index < events.length; index++) {
		const event = events[index]
		if (event === undefined) continue
		currentTurnEventIds.add(event.id)
	}
	return currentTurnEventIds
}
