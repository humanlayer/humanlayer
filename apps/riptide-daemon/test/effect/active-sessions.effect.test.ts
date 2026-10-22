import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { ClaudeSessions } from '@/effects/services/claude-sessions/claude-sessions.service'
import { FoldSessionRunner } from '@/effects/services/fold-sessions/fold-session-runner.service'
import { ActiveSessions, ActiveSessionsLive } from '@/effects/services/session-runs/active-sessions'
import { SessionRunRegistry, SessionRunRegistryLive } from '@/effects/services/session-runs/session-run-registry'

const claudeSessions = Layer.succeed(ClaudeSessions, {
	executeClaudeSession: () => Effect.die('unused'),
	deliverFollowUpMessage: () => Effect.die('unused'),
	stopClaudeSession: () => Effect.die('unused'),
	shutdownActiveClaudeSessions: Effect.void,
	activeSessionIds: Effect.succeed(['claude-session', 'shared-session']),
})

const foldSessions = Layer.succeed(FoldSessionRunner, {
	runPrompt: () => Effect.die('unused'),
	interruptSession: () => Effect.die('unused'),
	shutdownActiveSessions: Effect.void,
	activeSessionIds: Effect.succeed(['fold-session']),
})

describe('ActiveSessionsLive', () => {
	it.effect('lists Claude, Fold and in-flight session runs once each', () =>
		Effect.gen(function* () {
			const registry = yield* SessionRunRegistry
			yield* registry.forkExclusiveSessionRun({ sessionId: 'codelayer-session', run: Effect.never })
			yield* registry.forkExclusiveSessionRun({ sessionId: 'shared-session', run: Effect.never })

			const activeSessions = yield* ActiveSessions
			expect(yield* activeSessions.ids).toEqual([
				'claude-session',
				'shared-session',
				'fold-session',
				'codelayer-session',
			])
		}).pipe(
			Effect.scoped,
			Effect.provide(
				ActiveSessionsLive.pipe(
					Layer.provideMerge(Layer.mergeAll(claudeSessions, foldSessions, SessionRunRegistryLive)),
				),
			),
		),
	)
})
