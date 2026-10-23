import type { SessionErrorReason } from '@humanlayer/schemas/effect/session/session-error-reason'
import z from 'zod/v4'

/** Mirror of the Effect `SESSION_ERROR_REASONS`; `test/session-error-reason-parity.test.ts` keeps them equal. */
export const SESSION_ERROR_REASONS = ['auth_required', 'start_failed'] as const
export const SessionErrorReasonSchema = z.enum(SESSION_ERROR_REASONS)

export type { SessionErrorReason }
