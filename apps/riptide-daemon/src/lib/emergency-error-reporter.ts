import * as Sentry from '@sentry/bun'

type EmergencyErrorType = 'logger_transport_error' | 'unhandled_rejection'

export function reportEmergencyError(reason: unknown, errorType: EmergencyErrorType): void {
	try {
		Sentry.captureException(reason, { tags: { error_type: errorType } })
	} catch {
		// Emergency reporting must not create another process-level error.
	}

	try {
		const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
		process.stderr.write(`[${errorType}] ${detail}\n`)
	} catch {
		// stderr may be unavailable when the native parent disconnects.
	}
}
