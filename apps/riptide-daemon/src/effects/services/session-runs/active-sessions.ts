import { Context, Effect, Layer } from 'effect'

import { ClaudeSessions } from '../claude-sessions/claude-sessions.service'
import { FoldSessionRunner } from '../fold-sessions/fold-session-runner.service'
import { SessionRunRegistry } from './session-run-registry'

/**
 * Sessions this daemon is running: open Claude processes, Fold prompts in flight, and any session
 * run in flight, which is how codelayer turns are counted.
 */
export class ActiveSessions extends Context.Service<
	ActiveSessions,
	{ readonly ids: Effect.Effect<ReadonlyArray<string>> }
>()('ActiveSessions') {}

export const ActiveSessionsLive = Layer.effect(
	ActiveSessions,
	Effect.gen(function* () {
		const claudeSessions = yield* ClaudeSessions
		const foldSessions = yield* FoldSessionRunner
		const sessionRuns = yield* SessionRunRegistry
		return ActiveSessions.of({
			ids: Effect.all([
				claudeSessions.activeSessionIds,
				foldSessions.activeSessionIds,
				sessionRuns.inFlightSessionIds,
			]).pipe(Effect.map((idsByRuntime) => [...new Set(idsByRuntime.flat())])),
		})
	}),
)
