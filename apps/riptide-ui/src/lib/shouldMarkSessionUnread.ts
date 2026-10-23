import type { Session } from '@humanlayer/db/tables/sessions'

export type SessionChangeMessage = {
	type: 'insert' | 'update' | 'delete'
	value: Session
	previousValue?: Session
}

/**
 * Returns true when this change should mark the session as unread.
 * Pure predicate — tested directly in Phase 4.
 *
 * Qualifying trigger: ready_for_input only. needs_approval is excluded
 * because its existing pulsing icon already covers the slot, and the
 * status-icon-precedence rule would hide the bullet anyway.
 */
export function shouldMarkSessionUnread(
	change: SessionChangeMessage,
	currentSessionId: string | null,
	userId: string | undefined,
): boolean {
	if (change.type !== 'update') return false

	const prev = change.previousValue?.status
	const next = change.value.status
	if (next !== 'ready_for_input') return false
	if (prev === 'ready_for_input') return false

	if (userId && change.value.created_by !== userId) return false

	if (currentSessionId === change.value.id) return false

	return true
}
