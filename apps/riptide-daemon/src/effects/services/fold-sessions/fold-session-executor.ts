import * as Sentry from '@sentry/bun'
import { Cause, Effect, Exit, Schema } from 'effect'

import type { SessionContinuationKind, SessionExecutor } from '@/agents/shared/run-session'
import type { DaemonRuntime } from '@/effects/runtime'

import { FoldSessionRunner } from './fold-session-runner.service'
import { type FoldPromptAdmissionPolicy, RunFoldPromptInput } from './fold-sessions.schemas'

export const foldAdmissionPolicyFor = (kind: SessionContinuationKind | undefined): FoldPromptAdmissionPolicy =>
	kind === 'lost-resume' ? 'recover-lost' : 'serialize'

/** Adapt the process-scoped Fold runner to the shared executor boundary. */
export function createFoldSessionExecutor(daemonRuntime: DaemonRuntime): SessionExecutor {
	return async (context) => {
		const input = await Schema.decodeUnknownPromise(RunFoldPromptInput)({
			sessionId: context.session.id,
			prompt: context.session.prompt,
			admissionPolicy: foldAdmissionPolicyFor(context.continuationKind),
		})
		const program = Effect.gen(function* () {
			const runner = yield* FoldSessionRunner
			yield* runner.runPrompt(input)
		}).pipe(
			Effect.annotateLogs({ 'fold.executor': 'effect', sessionId: context.session.id }),
			Effect.withSpan('fold.session_execution', { attributes: { session_id: context.session.id } }),
		)
		const exit = await Sentry.startNewTrace(() => daemonRuntime.runPromiseExit(program))
		if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return
		throw Cause.squash(exit.cause)
	}
}
