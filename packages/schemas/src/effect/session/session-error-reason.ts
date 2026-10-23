import * as Schema from 'effect/Schema'

/**
 * Why a session failed, when the daemon can classify it. Drives client affordances (e.g. showing an
 * in-app sign-in prompt) so the UI never greps the free-text error message. A `null` column means the
 * failure is uncategorized; show `error_message` verbatim. This is the single source of truth; the Zod
 * twin in `zod/session/session-error-reason.ts` mirrors it for oRPC contracts and Drizzle schemas.
 */
export const SESSION_ERROR_REASONS = ['auth_required', 'start_failed'] as const
export const SessionErrorReason = Schema.Literals(SESSION_ERROR_REASONS)
export type SessionErrorReason = typeof SessionErrorReason.Type
