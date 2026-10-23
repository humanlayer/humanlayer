import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

const MAX_CAUSE_DEPTH = 4

const ErrorCause = Schema.instanceOf(Error)

const SdkDiagnosticCause = Schema.Struct({
	message: Schema.optionalKey(Schema.String),
	name: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
	stderr: Schema.optionalKey(Schema.String),
	stdout: Schema.optionalKey(Schema.String),
	exitCode: Schema.optionalKey(Schema.Finite),
	status: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
	cause: Schema.optionalKey(Schema.Unknown),
})

const nonBlank = (value: string | undefined): string | undefined => {
	const trimmed = value?.trim()
	return trimmed || undefined
}

const joinCause = (message: string, cause: unknown, depth: number): string => {
	if (depth >= MAX_CAUSE_DEPTH || cause === undefined || cause === null) return message
	const nested = describeUnknownError(cause, depth + 1)
	return nested !== 'Unknown error' && !message.includes(nested) ? `${message}: ${nested}` : message
}

const describeSdkDiagnostic = (diagnostic: Schema.Schema.Type<typeof SdkDiagnosticCause>, depth: number): string => {
	const stderr = nonBlank(diagnostic.stderr)
	const stdout = nonBlank(diagnostic.stdout)
	const parts = [
		nonBlank(diagnostic.message),
		nonBlank(diagnostic.name),
		diagnostic.code === undefined ? undefined : `code: ${diagnostic.code.toString()}`,
		stderr && `stderr: ${stderr}`,
		stdout && `stdout: ${stdout}`,
		diagnostic.exitCode === undefined ? undefined : `exit code: ${diagnostic.exitCode.toString()}`,
		diagnostic.status === undefined ? undefined : `status: ${diagnostic.status.toString()}`,
	].filter((part): part is string => part !== undefined)
	const message = parts.join('; ') || 'Unknown error'
	return joinCause(message, diagnostic.cause, depth)
}

/** Safely render Error instances and documented SDK diagnostic records. */
export function describeUnknownError(cause: unknown, depth = 0): string {
	const error = Option.getOrUndefined(Schema.decodeUnknownOption(ErrorCause)(cause))
	if (error) return joinCause(nonBlank(error.message) || error.name, error.cause, depth)

	const diagnostic = Option.getOrUndefined(Schema.decodeUnknownOption(SdkDiagnosticCause)(cause))
	if (diagnostic) return describeSdkDiagnostic(diagnostic, depth)

	return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(cause))?.trim() || 'Unknown error'
}
