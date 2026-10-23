import type { TaskStatus } from '@humanlayer/ui/components/sidebar/types'

/** Minimal session shape needed to aggregate a task-level status. */
export interface TaskStatusSessionInput {
	/** Raw session status string (schema value), or null. */
	status: string | null
	/** Session `last_activity_at`, used to resolve the most-recent "failed" case. */
	lastActivityAt: bigint | null
}

/**
 * Aggregate a task's status from its (non-archived) sessions, using the exact
 * precedence the left-nav sidebar task tree uses (`getSidebarTaskStatus`):
 *
 *   needs_approval > failed (most-recent session) > lost > running > pending > interrupt_requested
 *
 * Returns `undefined` (no indicator) when none apply. Shared by the sidebar task
 * tree and the Kanban board so the two stay in lockstep.
 */
export function aggregateTaskStatus(sessions: ReadonlyArray<TaskStatusSessionInput>): TaskStatus | undefined {
	let needsApprovalCount = 0
	let lostCount = 0
	let runningCount = 0
	let pendingCount = 0
	let interruptRequestedCount = 0
	let mostRecentStatus: string | null = null
	let mostRecentLastActivityAt = Number.NEGATIVE_INFINITY

	for (const session of sessions) {
		switch (session.status) {
			case 'needs_approval':
				needsApprovalCount += 1
				break
			case 'running':
			case 'waiting_for_usage_limit':
				runningCount += 1
				break
			case 'lost':
				lostCount += 1
				break
			case 'ready_for_launch':
			case 'launching':
			case 'resuming':
				pendingCount += 1
				break
			case 'interrupt_requested':
				interruptRequestedCount += 1
				break
		}

		const lastActivityAt =
			session.lastActivityAt == null ? Number.NEGATIVE_INFINITY : Number(session.lastActivityAt)

		if (lastActivityAt > mostRecentLastActivityAt) {
			mostRecentLastActivityAt = lastActivityAt
			mostRecentStatus = session.status
		}
	}

	if (needsApprovalCount > 0) return 'needs_approval'
	if (mostRecentStatus === 'failed') return 'failed'
	if (lostCount > 0) return 'lost'
	if (runningCount > 0) return 'running'
	if (pendingCount > 0) return 'pending'
	if (interruptRequestedCount > 0) return 'interrupt_requested'

	return undefined
}
