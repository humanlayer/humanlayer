import type { DaemonInfo } from '@humanlayer/riptide-electron-rpc'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import type { ChildProcessSpawner } from 'effect/process'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'

export interface TerminableDaemonGeneration {
	readonly info: DaemonInfo
	readonly handle: ChildProcessSpawner.ChildProcessHandle
	readonly scope: Scope.Closeable
	readonly intentionalStop: Ref.Ref<boolean>
}

export const terminateDaemonGeneration = Effect.fn('daemon_supervisor.terminate_generation')(function* (input: {
	readonly generation: TerminableDaemonGeneration
	readonly gracePeriod: Duration.Input
}) {
	yield* Ref.set(input.generation.intentionalStop, true)
	const running = yield* input.generation.handle.isRunning
	if (running) {
		yield* input.generation.handle.kill({ killSignal: 'SIGTERM' }).pipe(
			Effect.timeout(input.gracePeriod),
			Effect.catchTag('TimeoutError', () =>
				Effect.logWarning('Daemon did not exit after graceful shutdown; sending SIGKILL').pipe(
					Effect.annotateLogs({
						user_id: input.generation.info.userId,
						organization_id: input.generation.info.organizationId,
					}),
					Effect.andThen(input.generation.handle.kill({ killSignal: 'SIGKILL' })),
				),
			),
		)
	}
	yield* Scope.close(input.generation.scope, Exit.void)
})
