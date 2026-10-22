import { ORPCError } from '@orpc/server'

import { Sentry } from '../../../instrument'
import logger from '../../../logger'

export function summarizeError(error: unknown): {
	name?: string
	message: string
	stack?: string
	cause?: unknown
} {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			cause: error.cause,
		}
	}

	return {
		message: String(error),
	}
}

export function logAndCaptureBillingProcedureError(input: {
	error: unknown
	organizationId: string
	operation: string
	message: string
}): void {
	if (input.error instanceof ORPCError) return

	const summary = summarizeError(input.error)
	const sentryError = input.error instanceof Error ? input.error : new Error(summary.message)

	logger.error(
		{
			organizationId: input.organizationId,
			operation: input.operation,
			errorName: summary.name ?? null,
			errorMessage: summary.message,
			errorStack: summary.stack ?? null,
			errorCause: summary.cause ?? null,
		},
		input.message,
	)

	Sentry.captureException(sentryError, {
		tags: {
			error_type: 'billing_procedure_error',
			operation: input.operation,
		},
		extra: {
			organizationId: input.organizationId,
			errorName: summary.name ?? null,
			errorMessage: summary.message,
			errorStack: summary.stack ?? null,
			errorCause: summary.cause ?? null,
		},
	})
}
