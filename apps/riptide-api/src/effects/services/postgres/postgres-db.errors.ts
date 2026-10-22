import { Data } from 'effect'

export type PostgresDbErrorKind =
	| 'connection'
	| 'serialization_failure'
	| 'deadlock'
	| 'timeout'
	| 'read_only'
	| 'resource_exhaustion'
	| 'unique_violation'
	| 'foreign_key_violation'
	| 'constraint_violation'
	| 'data_exception'
	| 'syntax_or_access_rule'
	| 'driver_connection'
	| 'transaction_rollback'
	| 'unknown'

export interface PostgresDbCauseClassification {
	readonly code?: string
	readonly constraint?: string
	readonly retryable: boolean
	readonly kind: PostgresDbErrorKind
}

export class PostgresDbQueryError extends Data.TaggedError('PostgresDbQueryError')<{
	cause: unknown
	code?: string
	constraint?: string
	retryable: boolean
	kind: PostgresDbErrorKind
}> {
	static fromCause(cause: unknown): PostgresDbQueryError {
		return new PostgresDbQueryError({ cause, ...classifyPostgresDbCause(cause) })
	}
}

export class PostgresDbTransactionError extends Data.TaggedError('PostgresDbTransactionError')<{
	cause: unknown
	code?: string
	constraint?: string
	retryable: boolean
	kind: PostgresDbErrorKind
}> {
	static fromCause(cause: unknown): PostgresDbTransactionError {
		return new PostgresDbTransactionError({ cause, ...classifyPostgresDbCause(cause) })
	}
}

export type PostgresDbError = PostgresDbQueryError | PostgresDbTransactionError

const TRANSIENT_CONNECTION_CODES = new Set([
	'CONNECTION_ENDED',
	'CONNECTION_CLOSED',
	'CONNECTION_DESTROYED',
	'CONNECT_TIMEOUT',
	'ECONNRESET',
	'ETIMEDOUT',
	'EPIPE',
	'ECONNREFUSED',
])

export function classifyPostgresDbCause(cause: unknown): PostgresDbCauseClassification {
	const error = findClassifiableCause(cause)
	const code = getStringProp(error, 'code')
	const constraint = getStringProp(error, 'constraint_name') ?? getStringProp(error, 'constraint')
	const tag = getStringProp(cause, '_tag') ?? getStringProp(error, '_tag')
	const name = getStringProp(cause, 'name') ?? getStringProp(error, 'name')

	if (tag === 'TransactionRollbackError' || name === 'TransactionRollbackError') {
		return { code, constraint, retryable: false, kind: 'transaction_rollback' }
	}

	if (!code) return { retryable: false, kind: 'unknown' }

	if (code.startsWith('08')) return { code, constraint, retryable: true, kind: 'connection' }
	if (code === '40001') return { code, constraint, retryable: true, kind: 'serialization_failure' }
	if (code === '40P01') return { code, constraint, retryable: true, kind: 'deadlock' }
	if (code === '57014' || code === '55P03') return { code, constraint, retryable: true, kind: 'timeout' }
	if (code === '25006') return { code, constraint, retryable: true, kind: 'read_only' }
	if (code === '53300' || code === '53400') return { code, constraint, retryable: true, kind: 'resource_exhaustion' }
	if (code === '23505') return { code, constraint, retryable: false, kind: 'unique_violation' }
	if (code === '23503') return { code, constraint, retryable: false, kind: 'foreign_key_violation' }
	if (code.startsWith('23')) return { code, constraint, retryable: false, kind: 'constraint_violation' }
	if (code.startsWith('22')) return { code, constraint, retryable: false, kind: 'data_exception' }
	if (code.startsWith('42')) return { code, constraint, retryable: false, kind: 'syntax_or_access_rule' }

	if (TRANSIENT_CONNECTION_CODES.has(code)) {
		return { code, constraint, retryable: true, kind: 'driver_connection' }
	}

	return { code, constraint, retryable: false, kind: 'unknown' }
}

function findClassifiableCause(cause: unknown): unknown {
	let current = cause
	for (let depth = 0; depth < 4; depth++) {
		if (getStringProp(current, 'code')) return current
		const next = getUnknownProp(current, 'cause')
		if (!next || next === current) return current
		current = next
	}
	return current
}

function getUnknownProp(value: unknown, prop: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined
	return (value as Record<string, unknown>)[prop]
}

function getStringProp(value: unknown, prop: string): string | undefined {
	const propValue = getUnknownProp(value, prop)
	return typeof propValue === 'string' ? propValue : undefined
}
