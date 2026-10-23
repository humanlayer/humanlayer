import {
	type DaemonAuthenticationFailed,
	type DaemonLaunchResult,
	decodeDaemonProcessEventLine,
} from '@humanlayer/schemas/effect/daemon/process-event'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'

import { Sentry } from '../instrument'
import { DaemonGenerationError } from './daemon.errors'

const safeFilePart = (value: string): string => value.replaceAll(/[^a-zA-Z0-9-]/g, '_')

export const startDaemonOutputConsumers = Effect.fn('daemon_supervisor.consume_output')(function* (input: {
	readonly userId: string
	readonly organizationId: string
	readonly generationId: string
	readonly stdout: Stream.Stream<Uint8Array, unknown>
	readonly stderr: Stream.Stream<Uint8Array, unknown>
	readonly logDirectory: string
	readonly onAuthenticationFailure: (failure: DaemonAuthenticationFailed) => Effect.Effect<void>
	readonly onLaunchResult: (result: DaemonLaunchResult) => Effect.Effect<void>
}) {
	const fileSystem = yield* FileSystem.FileSystem
	const pathService = yield* Path.Path
	const writeSemaphore = yield* Semaphore.make(1)
	const logPath = pathService.join(
		input.logDirectory,
		`riptide-daemon-${safeFilePart(input.userId)}-${safeFilePart(input.organizationId)}-${safeFilePart(input.generationId)}.log`,
	)
	yield* fileSystem.makeDirectory(input.logDirectory, { recursive: true })
	const file = yield* fileSystem.open(logPath, { flag: 'a', mode: 0o600 })

	const writeLine = (source: 'stdout' | 'stderr', line: string) =>
		writeSemaphore.withPermit(
			Clock.currentTimeMillis.pipe(
				Effect.flatMap((now) =>
					file.writeAll(new TextEncoder().encode(`[${new Date(now).toISOString()}] [${source}] ${line}\n`)),
				),
			),
		)

	const consume = (source: 'stdout' | 'stderr', stream: Stream.Stream<Uint8Array, unknown>) =>
		stream.pipe(
			Stream.decodeText(),
			Stream.splitLines,
			Stream.runForEach((line) =>
				writeLine(source, line).pipe(
					Effect.andThen(
						decodeDaemonProcessEventLine({ line }).pipe(
							Effect.flatMap((event) => {
								if (event.type === 'auth_failure') return input.onAuthenticationFailure(event)
								return input.onLaunchResult(event)
							}),
							Effect.catchTag('DaemonProcessEventDecodeError', () => Effect.void),
						),
					),
					Effect.andThen(
						Effect.logDebug(`Daemon ${source}`).pipe(
							Effect.annotateLogs({
								user_id: input.userId,
								organization_id: input.organizationId,
								generation_id: input.generationId,
							}),
						),
					),
				),
			),
			Effect.mapError(
				(cause) => new DaemonGenerationError({ cause, message: `Failed to consume daemon ${source}` }),
			),
			Effect.tapError((error) =>
				Effect.logError(error).pipe(Effect.andThen(Effect.sync(() => Sentry.captureException(error)))),
			),
			Effect.catchTag('DaemonGenerationError', () => Effect.void),
		)

	yield* Effect.all([consume('stdout', input.stdout), consume('stderr', input.stderr)], {
		concurrency: 2,
		discard: true,
	})
})
