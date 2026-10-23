import { Context, Effect, Layer, type Scope } from 'effect'

export interface SessionRunRegistryInput {
	readonly sessionId: string
}

export interface ForkExclusiveSessionRunInput<E> extends SessionRunRegistryInput {
	/** The complete run for the session, already handling its own failures. */
	readonly run: Effect.Effect<void, E>
}

export interface SessionRunRegistryService {
	/**
	 * Fork `run` into the ambient scope unless a run for the session is already in flight. The
	 * session stays registered until the forked run ends, however it ends. Returns whether the run
	 * was forked; `false` means another run owns the session and nothing was started.
	 */
	readonly forkExclusiveSessionRun: <E>(
		input: ForkExclusiveSessionRunInput<E>,
	) => Effect.Effect<boolean, never, Scope.Scope>
	readonly isSessionRunInFlight: (input: SessionRunRegistryInput) => Effect.Effect<boolean>
	readonly inFlightSessionIds: Effect.Effect<ReadonlyArray<string>>
}

/**
 * Ids of sessions whose runner fiber is active in this daemon. Legacy launches and V2 handoffs
 * share one registry so a session never runs twice, whichever path notices it first.
 */
export class SessionRunRegistry extends Context.Service<SessionRunRegistry, SessionRunRegistryService>()(
	'SessionRunRegistry',
) {}

export const SessionRunRegistryLive = Layer.effect(
	SessionRunRegistry,
	Effect.sync(() => {
		const inFlight = new Set<string>()
		return SessionRunRegistry.of({
			forkExclusiveSessionRun: ({ sessionId, run }) =>
				Effect.gen(function* () {
					if (inFlight.has(sessionId)) return false
					inFlight.add(sessionId)
					yield* run.pipe(Effect.ensuring(Effect.sync(() => inFlight.delete(sessionId))), Effect.forkScoped)
					return true
				}),
			isSessionRunInFlight: ({ sessionId }) => Effect.sync(() => inFlight.has(sessionId)),
			inFlightSessionIds: Effect.sync(() => [...inFlight]),
		})
	}),
)
