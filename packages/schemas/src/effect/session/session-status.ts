import * as Schema from 'effect/Schema'

/**
 * Every lifecycle status a session row can carry. This is the single source of truth; the Zod
 * twin in `zod/session/session-status.ts` mirrors it for oRPC contracts and Drizzle schemas.
 */
export const SESSION_STATUSES = [
	'ready_for_launch',
	'waiting_for_workspace',
	'draft',
	'launching',
	'running',
	'failed',
	'ready_for_input',
	'needs_approval',
	'waiting_for_usage_limit',
	'interrupt_requested',
	'interrupted',
	'resuming',
	'lost',
] as const
export const SessionStatus = Schema.Literals(SESSION_STATUSES)
export type SessionStatus = typeof SessionStatus.Type

/**
 * Statuses of a session that the daemon still owes a launch: it was queued by the API and no
 * runner has taken it yet. `waiting_for_workspace` is the same queue position after the daemon
 * has told the user that workspace setup is holding the launch.
 */
export const SESSION_STATUSES_AWAITING_LAUNCH = [
	'ready_for_launch',
	'waiting_for_workspace',
] as const satisfies readonly SessionStatus[]
export const SessionStatusAwaitingLaunch = Schema.Literals(SESSION_STATUSES_AWAITING_LAUNCH)
export type SessionStatusAwaitingLaunch = typeof SessionStatusAwaitingLaunch.Type

export const isSessionStatusAwaitingLaunch: (status: SessionStatus) => status is SessionStatusAwaitingLaunch =
	Schema.is(SessionStatusAwaitingLaunch)
