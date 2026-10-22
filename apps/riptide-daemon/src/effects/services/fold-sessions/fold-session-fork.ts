import { EventId, LogEntry, LogSeq, SessionId, type SessionStartedLogEntry } from '@humanlayer/fold-core'
import { Data, Effect, Predicate, Schema } from 'effect'

export const FoldSessionForkMetadata = Schema.Struct({
	agent: Schema.Literal('fold'),
	sourceSessionId: Schema.String,
	forkAtEventId: Schema.String,
	sourceFoldEventId: EventId,
	sourceFoldSeq: LogSeq,
	childFoldSessionId: SessionId,
})
export interface FoldSessionForkMetadata extends Schema.Schema.Type<typeof FoldSessionForkMetadata> {}

export const ValidateFoldForkedSessionLogInput = Schema.Struct({
	riptideSessionId: Schema.String,
	sourceSessionId: Schema.NullOr(Schema.String),
	codingAgentSessionId: SessionId,
	forkMetadata: Schema.Unknown,
	entries: Schema.Array(LogEntry),
})
export interface ValidateFoldForkedSessionLogInput extends Schema.Schema.Type<
	typeof ValidateFoldForkedSessionLogInput
> {}

export class FoldSessionForkValidationError extends Data.TaggedError('FoldSessionForkValidationError')<{
	readonly sessionId: string
	readonly message: string
	readonly cause: unknown
}> {}

const isSessionStartedEntry = Predicate.isTagged('session_started')

const failForkValidation = (sessionId: string, message: string, cause: unknown = null) =>
	new FoldSessionForkValidationError({ sessionId, message, cause })

export const validateFoldForkedSessionLog = Effect.fn('fold.validate_forked_session_log')(function* (
	input: ValidateFoldForkedSessionLogInput,
) {
	const metadata = yield* Schema.decodeUnknownEffect(FoldSessionForkMetadata)(input.forkMetadata).pipe(
		Effect.mapError((cause) =>
			failForkValidation(input.riptideSessionId, 'The Fold fork metadata is invalid.', cause),
		),
	)
	if (input.sourceSessionId !== null && metadata.sourceSessionId !== input.sourceSessionId) {
		return yield* failForkValidation(
			input.riptideSessionId,
			'The Fold fork metadata does not identify the source session.',
		)
	}
	if (metadata.childFoldSessionId !== input.codingAgentSessionId) {
		return yield* failForkValidation(
			input.riptideSessionId,
			'The copied Fold log does not match the child session identity or fork sequence.',
		)
	}

	const sessionStartedEntries = input.entries.filter((entry): entry is SessionStartedLogEntry =>
		isSessionStartedEntry(entry),
	)
	const sessionStarted: SessionStartedLogEntry | undefined = sessionStartedEntries[0]
	if (
		sessionStartedEntries.length !== 1 ||
		sessionStarted?.seq !== 0 ||
		sessionStarted.sessionId !== metadata.childFoldSessionId
	) {
		return yield* failForkValidation(input.riptideSessionId, 'The copied Fold log has an invalid session boundary.')
	}

	const cutoff = input.entries.find((entry) => entry.seq === metadata.sourceFoldSeq)
	if (cutoff?.eventId !== metadata.sourceFoldEventId) {
		return yield* failForkValidation(
			input.riptideSessionId,
			'The copied Fold log does not contain the recorded fork event at the expected sequence.',
		)
	}

	return metadata
})
