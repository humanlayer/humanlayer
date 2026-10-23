import { Effect } from 'effect'

import type { PostgresDbQueryError, PostgresDbTransactionError } from './postgres-db.errors'

type PostgresDbError = PostgresDbQueryError | PostgresDbTransactionError

/**
 * Maps Postgres errors to oRPC errors based on retryability.
 * Retryable errors (connection issues, deadlocks) → SERVICE_UNAVAILABLE
 * Non-retryable errors (constraint violations, etc.) → INTERNAL_SERVER_ERROR
 *
 * Note: Sentry capture and span annotation are handled automatically by the procedure middleware.
 */
export function mapPostgresErrorToResponse<TServiceUnavailable, TInternalError>(
	error: PostgresDbError,
	errors: {
		SERVICE_UNAVAILABLE: () => TServiceUnavailable
		INTERNAL_SERVER_ERROR: () => TInternalError
	},
): Effect.Effect<never, TServiceUnavailable | TInternalError> {
	return Effect.fail(error.retryable ? errors.SERVICE_UNAVAILABLE() : errors.INTERNAL_SERVER_ERROR())
}
