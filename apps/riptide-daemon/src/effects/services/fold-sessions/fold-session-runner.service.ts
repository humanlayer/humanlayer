import { Context, type Effect } from 'effect'

import type { FoldPromptRunError, FoldPromptTakeoverError, FoldSessionsShuttingDownError } from './fold-sessions.errors'
import type {
	FoldSessionInterruptOutcome,
	InterruptFoldSessionInput,
	RunFoldPromptInput,
} from './fold-sessions.schemas'

export class FoldSessionRunner extends Context.Service<
	FoldSessionRunner,
	{
		/**
		 * Run one prompt once it owns the session. With `recover-lost`, a prompt that finds a stale
		 * owner stops it first and fails with `FoldPromptTakeoverError` if that owner will not release.
		 */
		readonly runPrompt: (
			input: RunFoldPromptInput,
		) => Effect.Effect<void, FoldPromptRunError | FoldSessionsShuttingDownError | FoldPromptTakeoverError>
		readonly interruptSession: (input: InterruptFoldSessionInput) => Effect.Effect<FoldSessionInterruptOutcome>
		readonly shutdownActiveSessions: Effect.Effect<void>
		/** Sessions with a prompt in flight. */
		readonly activeSessionIds: Effect.Effect<ReadonlyArray<string>>
	}
>()('FoldSessionRunner') {}
