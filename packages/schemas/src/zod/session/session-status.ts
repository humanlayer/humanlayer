import type { SessionStatus, SessionStatusAwaitingLaunch } from '@humanlayer/schemas/effect/session/session-status'
import z from 'zod/v4'

/** Mirror of the Effect `SESSION_STATUSES`; `test/session-status-parity.test.ts` keeps them equal. */
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
export const SessionStatusSchema = z.enum(SESSION_STATUSES)

export const SESSION_STATUSES_AWAITING_LAUNCH = ['ready_for_launch', 'waiting_for_workspace'] as const
export const SessionStatusAwaitingLaunchSchema = z.enum(SESSION_STATUSES_AWAITING_LAUNCH)

export type { SessionStatus, SessionStatusAwaitingLaunch }
