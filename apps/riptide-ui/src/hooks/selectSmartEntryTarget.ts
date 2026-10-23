import type { ConversationEvent } from '@humanlayer/ui/components/conversation-stream'

export type SmartEntryTarget =
	| { kind: 'pending-approval'; eventId: string; parentToolUseId: string | undefined }
	| { kind: 'bottom' }

/**
 * Pure target-selection logic for the one-shot session-entry scroll.
 * Returns {kind:'pending-approval'} when a pending-approval event is present and
 * resolvable in the events array; otherwise {kind:'bottom'}.
 *
 * A non-null id that does not appear in events falls through to 'bottom' (defensive —
 * the live-query join can lag the events array by one render).
 */
export function selectSmartEntryTarget(
	oldestPendingApprovalEventId: string | null,
	events: Pick<ConversationEvent, 'id' | 'parentToolUseId'>[],
): SmartEntryTarget {
	if (oldestPendingApprovalEventId === null) return { kind: 'bottom' }
	const target = events.find((e) => e.id === oldestPendingApprovalEventId)
	if (!target) return { kind: 'bottom' }
	return {
		kind: 'pending-approval',
		eventId: target.id,
		parentToolUseId: target.parentToolUseId,
	}
}
