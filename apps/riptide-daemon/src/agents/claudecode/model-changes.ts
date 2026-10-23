import type { SessionChangeMessage } from '@/collections/types'
/**
 * Check if a change message represents a model change for a specific session.
 */
export function isModelChangeEvent(change: SessionChangeMessage, sessionId: string): boolean {
	return (
		change.type === 'update' && change.value.id === sessionId && change.previousValue?.model !== change.value.model
	)
}

/**
 * Subscribe to model changes for a specific session.
 * Calls the provided callback when model changes.
 * Returns unsubscribe function for cleanup.
 */
