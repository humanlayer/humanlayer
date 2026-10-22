import type { AccessRequestStatus } from '@humanlayer/db/tables/access-requests'
import { Data } from 'effect'

import type { PostgresDbError } from '../postgres/postgres-db.errors'

export class AlreadyRequestedAccessError extends Data.TaggedError('AlreadyRequestedAccessError')<{
	retryAfter: Date
	existingRequestStatus: AccessRequestStatus
}> {}

export class FeatureDisabledError extends Data.TaggedError('FeatureDisabledError')<{ message: string }> {}

/**
 * Procedure-facing validation error for the access-request service boundary.
 *
 * Raised when the public-create flow cannot determine a requester email — i.e. an
 * anonymous caller did not supply one. The public-create procedure maps this to a
 * `BAD_REQUEST` contract error. `message` carries the client-facing reason.
 */
export class AccessRequestValidationError extends Data.TaggedError('AccessRequestValidationError')<{
	message: string
}> {}

/**
 * Postgres SQLSTATE codes (from `PostgresError.code`) that we treat as transient.
 *
 * A transient error is one where the *exact same statement with the same inputs* has a
 * reasonable chance of succeeding on retry, because the failure came from the connection
 * or the database's momentary state — not from the data or the query itself. Anything not
 * listed here (constraint violations `23xxx`, data exceptions `22xxx`, syntax/privilege
 * errors `42xxx`, etc.) is non-transient: retrying it fails identically and can mask a bug.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const TRANSIENT_SQLSTATE_CODES = new Set<string>([
	'40001', // serialization_failure — tx conflict, Postgres explicitly wants a retry
	'40P01', // deadlock_detected — this tx was the victim, retry resolves
	'53300', // too_many_connections — momentary resource exhaustion
	'53400', // configuration_limit_exceeded
	'57P01', // admin_shutdown — server is restarting
	'57P02', // crash_shutdown
	'57P03', // cannot_connect_now — server is still starting up
	'25006', // read_only_sql_transaction — hit a replica / just-failed-over primary
])

/**
 * Driver/socket error codes (from `error.code` on non-`PostgresError` errors thrown by
 * postgres.js or the underlying socket) that we treat as transient — the connection broke
 * or could not be established (RDS failover/reboot, network blip, pool churn).
 */
const TRANSIENT_CONNECTION_CODES = new Set<string>([
	// postgres.js connection codes
	'CONNECTION_ENDED',
	'CONNECTION_CLOSED',
	'CONNECTION_DESTROYED',
	'CONNECT_TIMEOUT',
	// node socket codes
	'ECONNRESET',
	'ETIMEDOUT',
	'EPIPE',
	'ECONNREFUSED',
])

/**
 * Decide whether a thrown DB `cause` is transient (safe to retry) in our context.
 *
 * Our DB stack is drizzle `postgres-js` over the `postgres` (postgres.js) driver, so a
 * `cause` is either a `PostgresError` carrying a 5-char SQLSTATE in `.code`, or a
 * driver/socket error carrying a string `.code`. We classify by that code and default to
 * **non-transient** when there is no positive evidence the error is connection- or
 * concurrency-related (e.g. a plain `throw new Error(...)` from our transaction bodies).
 */
export function isTransientDbCause(cause: unknown): boolean {
	if (typeof cause !== 'object' || cause === null) return false
	const code = (cause as { code?: unknown }).code
	if (typeof code !== 'string') return false
	// SQLSTATE class 08 (connection_exception) — connection broke mid-statement
	if (code.startsWith('08')) return true
	return TRANSIENT_SQLSTATE_CODES.has(code) || TRANSIENT_CONNECTION_CODES.has(code)
}

export class AccessRequestDbError extends Data.TaggedError('AccessRequestDbError')<{
	operation: string
	cause: unknown
	retryable: boolean
}> {
	/**
	 * Build an `AccessRequestDbError` from a thrown `cause`, deriving `retryable` from the
	 * underlying SQLSTATE/connection code via {@link isTransientDbCause}. Prefer this over the
	 * raw constructor so retryability stays consistent across every DB operation.
	 */
	static fromCause(operation: string, cause: unknown): AccessRequestDbError {
		return new AccessRequestDbError({ operation, cause, retryable: isTransientDbCause(cause) })
	}

	/**
	 * Translate a wrapped Postgres service error (`PostgresDbQueryError` /
	 * `PostgresDbTransactionError`) into an access-request DB error at the helper
	 * boundary. The access-request DB helpers now execute through `postgres.query` /
	 * `postgres.transaction`, so the shared service has already classified the cause and
	 * set its own `retryable` flag (via `classifyPostgresDbCause`). We carry that flag
	 * straight through so `retryDbTransient` keeps retrying exactly the same transient
	 * failures it did when these helpers classified causes themselves with
	 * {@link isTransientDbCause}. The shared error's `cause` is preserved so logs/Sentry
	 * still see the original driver/SQLSTATE error.
	 */
	static fromPostgresError(operation: string, error: PostgresDbError): AccessRequestDbError {
		return new AccessRequestDbError({ operation, cause: error.cause, retryable: error.retryable })
	}
}

/**
 * Procedure-facing error for the access-request service boundary.
 *
 * `AccessRequestService` is a deep module: callers (the access-request adapter and,
 * after conversion, the access-request Effect procedures) should only ever see
 * access-request domain semantics, never the lower-level `AccessRequestDbError`,
 * `PostgresDbQueryError`, or `PostgresDbTransactionError`. `operation` names the
 * access-request step that failed, and `cause` preserves the original internal error
 * for logging/Sentry.
 */
export class AccessRequestUnavailableError extends Data.TaggedError('AccessRequestUnavailableError')<{
	operation: string
	cause: unknown
}> {}

export class NotImplementedError extends Data.TaggedError('NotImplementedError')<{ feature: string }> {}
