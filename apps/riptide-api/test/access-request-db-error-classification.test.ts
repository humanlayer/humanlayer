import { describe, expect, test } from 'vitest'

import { AccessRequestDbError, isTransientDbCause } from '../src/effects/services/access-request/access-request-errors'
import { PostgresDbQueryError, PostgresDbTransactionError } from '../src/effects/services/postgres/postgres-db.errors'

// A PostgresError from postgres.js carries a 5-char SQLSTATE in `.code`; driver/socket
// errors carry a string `.code`. These fakes mimic just the `.code` shape we classify on.
const sqlstate = (code: string) => Object.assign(new Error(`sqlstate ${code}`), { code })
const driverError = (code: string) => Object.assign(new Error(`driver ${code}`), { code })

describe('isTransientDbCause', () => {
	test('treats serialization/deadlock SQLSTATE as transient', () => {
		expect(isTransientDbCause(sqlstate('40001'))).toBe(true) // serialization_failure
		expect(isTransientDbCause(sqlstate('40P01'))).toBe(true) // deadlock_detected
	})

	test('treats connection_exception class (08xxx) as transient', () => {
		expect(isTransientDbCause(sqlstate('08000'))).toBe(true)
		expect(isTransientDbCause(sqlstate('08006'))).toBe(true) // connection_failure
	})

	test('treats resource/shutdown/failover SQLSTATE as transient', () => {
		expect(isTransientDbCause(sqlstate('53300'))).toBe(true) // too_many_connections
		expect(isTransientDbCause(sqlstate('57P03'))).toBe(true) // cannot_connect_now
		expect(isTransientDbCause(sqlstate('25006'))).toBe(true) // read_only_sql_transaction
	})

	test('treats driver/socket connection codes as transient', () => {
		expect(isTransientDbCause(driverError('CONNECTION_ENDED'))).toBe(true)
		expect(isTransientDbCause(driverError('CONNECT_TIMEOUT'))).toBe(true)
		expect(isTransientDbCause(driverError('ECONNRESET'))).toBe(true)
	})

	test('treats constraint/data/syntax SQLSTATE as non-transient', () => {
		expect(isTransientDbCause(sqlstate('23505'))).toBe(false) // unique_violation
		expect(isTransientDbCause(sqlstate('23503'))).toBe(false) // foreign_key_violation
		expect(isTransientDbCause(sqlstate('22001'))).toBe(false) // string_data_right_truncation
		expect(isTransientDbCause(sqlstate('42703'))).toBe(false) // undefined_column
	})

	test('treats errors without a recognized code as non-transient', () => {
		expect(isTransientDbCause(new Error('Failed to update access request'))).toBe(false)
		expect(isTransientDbCause(sqlstate('99999'))).toBe(false)
		expect(isTransientDbCause(undefined)).toBe(false)
		expect(isTransientDbCause(null)).toBe(false)
		expect(isTransientDbCause('boom')).toBe(false)
		expect(isTransientDbCause({ code: 500 })).toBe(false)
	})
})

describe('AccessRequestDbError.fromCause', () => {
	test('derives retryable from the cause', () => {
		const transient = AccessRequestDbError.fromCause('lookupArtifactForAccessRequest', sqlstate('40001'))
		expect(transient.retryable).toBe(true)
		expect(transient.operation).toBe('lookupArtifactForAccessRequest')

		const permanent = AccessRequestDbError.fromCause('upsertAccessRequestInTransaction', sqlstate('23505'))
		expect(permanent.retryable).toBe(false)
		expect(permanent._tag).toBe('AccessRequestDbError')
	})
})

// The access-request DB helpers now run through the wrapped Postgres service, so the shared
// service classifies the cause and we translate its `PostgresDbQueryError` /
// `PostgresDbTransactionError` into an `AccessRequestDbError` at the helper boundary. This is
// the boundary `retryDbTransient` keys off of (it retries `AccessRequestDbError` where
// `retryable === true`), so these tests pin that the wrapped error's `retryable` flag carries
// straight through and stays consistent with the legacy `isTransientDbCause` classification.
describe('AccessRequestDbError.fromPostgresError', () => {
	test('carries through a retryable wrapped query error', () => {
		const wrapped = PostgresDbQueryError.fromCause(sqlstate('40001')) // serialization_failure
		expect(wrapped.retryable).toBe(true)

		const mapped = AccessRequestDbError.fromPostgresError('findPendingRequestsByOrgEmail', wrapped)
		expect(mapped._tag).toBe('AccessRequestDbError')
		expect(mapped.operation).toBe('findPendingRequestsByOrgEmail')
		expect(mapped.retryable).toBe(true)
		// The original driver/SQLSTATE cause is preserved for logging/Sentry, not the wrapper.
		expect(mapped.cause).toBe(wrapped.cause)
	})

	test('carries through a non-retryable wrapped query error', () => {
		const wrapped = PostgresDbQueryError.fromCause(sqlstate('23505')) // unique_violation
		expect(wrapped.retryable).toBe(false)

		const mapped = AccessRequestDbError.fromPostgresError('upsertAccessRequestInTransaction', wrapped)
		expect(mapped.retryable).toBe(false)
	})

	test('carries through a retryable wrapped transaction error', () => {
		const wrapped = PostgresDbTransactionError.fromCause(driverError('CONNECTION_ENDED'))
		expect(wrapped.retryable).toBe(true)

		const mapped = AccessRequestDbError.fromPostgresError('upsertAccessRequestInTransaction', wrapped)
		expect(mapped.retryable).toBe(true)
		expect(mapped.cause).toBe(wrapped.cause)
	})

	test('treats a driver error without a recognized code as non-retryable', () => {
		const wrapped = PostgresDbQueryError.fromCause(new Error('Failed to update access request'))
		expect(wrapped.retryable).toBe(false)

		const mapped = AccessRequestDbError.fromPostgresError('updateRequestToArchived', wrapped)
		expect(mapped.retryable).toBe(false)
	})
})
